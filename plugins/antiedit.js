const fs = require('fs');
const path = require('path');
const { cmd } = require('../arslan');

/**
 * ANTI-EDIT
 * Shows what a message said BEFORE and AFTER someone edits it.
 *
 * Self-contained: it attaches its own listeners to the WhatsApp socket the first
 * time the bot handles a message (and again after every reconnect), so no change
 * to index.js is required. See the bottom of the file for the optional 1-line
 * hook that makes it start the very instant the bot connects.
 */

// ───────────── settings ─────────────
const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'antiedit.json');
const MODES = ['off', 'inchat', 'indm'];

const STORE_LIMIT = 10000;                 // max remembered messages
const STORE_TTL = 24 * 60 * 60 * 1000;     // remember messages for 24 hours
const TEXT_LIMIT = 1500;                   // longest text shown per before/after
const SEEN_TTL = 10 * 60 * 1000;           // duplicate-event memory
const TIMEZONE = 'Africa/Nairobi';

let settings = { mode: 'off' };

function loadSettings() {
    try {
        if (!fs.existsSync(DATA_FILE)) return;
        const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (MODES.includes(saved.mode)) settings.mode = saved.mode;
    } catch (err) {
        console.error('[ANTIEDIT] Could not read settings:', err.message);
    }
}

function saveSettings() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(settings, null, 2));
    } catch (err) {
        console.error('[ANTIEDIT] Could not save settings:', err.message);
    }
}

loadSettings();
global.antiedit = settings.mode;   // handy for other plugins / status pages

// ───────────── message helpers ─────────────
const WRAPPERS = [
    'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension',
    'documentWithCaptionMessage', 'editedMessage', 'deviceSentMessage'
];

// Peel off WhatsApp's "wrapper" layers to reach the real content
function unwrap(message) {
    let cur = message;
    for (let i = 0; i < 6 && cur; i++) {
        let next = null;
        for (const key of WRAPPERS) {
            if (cur[key]?.message) { next = cur[key].message; break; }
        }
        if (!next) break;
        cur = next;
    }
    return cur || null;
}

function getText(message) {
    const m = unwrap(message);
    if (!m) return '';
    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        ''
    );
}

const digits = (jid) => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
const trim = (t) => {
    const s = String(t || '');
    return s.length > TEXT_LIMIT ? `${s.slice(0, TEXT_LIMIT)}…` : s;
};
const ignoredChat = (jid) => !jid || jid === 'status@broadcast' || /@(newsletter|broadcast)$/.test(jid);

// ───────────── message memory ─────────────
const store = new Map();   // messageId -> { text, sender, pushName, chat, ts }

function remember(id, entry) {
    if (!id) return;
    store.delete(id);                       // refresh insertion order
    store.set(id, entry);
    while (store.size > STORE_LIMIT) store.delete(store.keys().next().value);
}

function recall(id) {
    const hit = store.get(id);
    if (hit && Date.now() - hit.ts < STORE_TTL) return hit;
    if (hit) store.delete(id);

    // Fallback: the anti-delete cache already keeps recent raw messages
    try {
        const old = global.msgCache?.get(id);
        const text = old ? getText(old.msg?.message) : '';
        if (text) return { text, sender: old.sender, pushName: old.pushName, chat: old.from, ts: old.timestamp || Date.now() };
    } catch (_) { /* ignore */ }
    return null;
}

// ───────────── edit detection ─────────────
// Edits can reach us two ways; both are understood and de-duplicated.

// 1) A "protocol message" arriving through messages.upsert
function parseUpsertEdit(raw) {
    const msg = unwrap(raw?.message);
    const pm = msg?.protocolMessage;
    if (!pm) return null;

    const isEdit = pm.type === 14 || pm.type === 'MESSAGE_EDIT' || !!pm.editedMessage;
    if (!isEdit || !pm.key?.id) return null;

    return {
        id: pm.key.id,
        chat: raw.key?.remoteJid,
        sender: raw.key?.participant || pm.key?.participant || raw.key?.remoteJid,
        fromMe: !!raw.key?.fromMe,
        pushName: raw.pushName,
        newText: getText(pm.editedMessage)
    };
}

// 2) A messages.update event carrying the edited content
function parseUpdateEdit(u) {
    const msg = u?.update?.message;
    if (!msg || !u.key?.id) return null;

    const edited = msg.editedMessage?.message || msg.protocolMessage?.editedMessage;
    if (!edited) return null;

    return {
        id: u.key.id,
        chat: u.key.remoteJid,
        sender: u.key.participant || u.key.remoteJid,
        fromMe: !!u.key.fromMe,
        pushName: undefined,
        newText: getText(edited)
    };
}

// ───────────── sending (never throws) ─────────────
async function safeSend(sock, jid, content, quoted) {
    const attempts = [];
    if (quoted) attempts.push(() => sock.sendMessage(jid, content, { quoted }));
    attempts.push(() => sock.sendMessage(jid, content));
    attempts.push(() => sock.sendMessage(jid, { text: content.text }));   // no mentions

    for (const attempt of attempts) {
        try {
            await attempt();
            return true;
        } catch (err) {
            console.error('[ANTIEDIT] Send attempt failed:', err.message);
        }
    }
    return false;
}

const groupNames = new Map();
async function chatLabel(sock, chat) {
    if (!chat.endsWith('@g.us')) return 'Private chat';
    if (!groupNames.has(chat)) {
        try {
            const meta = await sock.groupMetadata(chat);
            groupNames.set(chat, meta?.subject || '');
        } catch (_) {
            groupNames.set(chat, '');
        }
    }
    const name = groupNames.get(chat);
    return name ? `Group · ${name}` : 'Group chat';
}

// ───────────── handling an edit ─────────────
const seen = new Map();   // "chat|id|text" -> timestamp
const stats = { edits: 0, reported: 0 };

function isDuplicate(key) {
    const now = Date.now();
    if (seen.size > 2000) {
        for (const [k, t] of seen) if (now - t > SEEN_TTL) seen.delete(k);
    }
    if (seen.has(key) && now - seen.get(key) < SEEN_TTL) return true;
    seen.set(key, now);
    return false;
}

async function handleEdit(sock, ev) {
    if (!ev || !ev.id || ignoredChat(ev.chat)) return;
    if (!ev.newText) return;                                  // nothing readable to compare

    const dupKey = `${ev.chat}|${ev.id}|${ev.newText}`;
    if (isDuplicate(dupKey)) return;                          // same edit seen via the other path

    const before = recall(ev.id);
    const beforeText = before?.text || '';

    // Always keep our memory current, so the NEXT edit compares against this one
    remember(ev.id, {
        text: ev.newText,
        sender: before?.sender || ev.sender,
        pushName: before?.pushName || ev.pushName,
        chat: ev.chat,
        ts: Date.now()
    });

    if (beforeText === ev.newText) return;                    // not a real change
    stats.edits++;

    if (settings.mode === 'off') return;
    if (ev.fromMe) return;                                    // your own edits are not reported

    const sender = before?.sender || ev.sender;
    const senderJid = String(sender || '').includes('@') ? sender : `${digits(sender)}@s.whatsapp.net`;
    const targetJid = settings.mode === 'indm'
        ? `${digits(sock.user?.id)}@s.whatsapp.net`
        : ev.chat;

    const label = await chatLabel(sock, ev.chat);
    const time = new Date().toLocaleString('en-KE', { timeZone: TIMEZONE });

    const text =
        `✏️ *𝗣𝗢𝗣𝗞𝗜𝗗-𝗠𝗗 𝗔𝗡𝗧𝗜-𝗘𝗗𝗜𝗧*\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `👤 *Sender:* @${digits(senderJid)}${before?.pushName || ev.pushName ? ` (${before?.pushName || ev.pushName})` : ''}\n` +
        `💬 *Chat:* ${label}\n` +
        `🕑 *Time:* ${time}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `❌ *Before:*\n${beforeText ? trim(beforeText) : '_not available (sent before the bot saw it)_'}\n\n` +
        `✅ *After:*\n${trim(ev.newText)}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`;

    const quoted = settings.mode === 'inchat'
        ? { key: { remoteJid: ev.chat, id: ev.id, fromMe: false, participant: ev.chat.endsWith('@g.us') ? senderJid : undefined }, message: { conversation: ev.newText } }
        : undefined;

    const ok = await safeSend(sock, targetJid, { text, mentions: [senderJid] }, quoted);

    if (ok) stats.reported++;
    else seen.delete(dupKey);   // allow the other event path to retry
}

// ───────────── listeners ─────────────
const attached = new WeakSet();

function attach(sock) {
    if (!sock?.ev || attached.has(sock)) return;
    attached.add(sock);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const raw of messages || []) {
            try {
                if (!raw?.message || ignoredChat(raw.key?.remoteJid)) continue;

                const edit = parseUpsertEdit(raw);
                if (edit) { await handleEdit(sock, edit); continue; }

                // Ordinary message: remember its text so we can compare later
                if (raw.message.protocolMessage) continue;
                const text = getText(raw.message);
                if (text && raw.key?.id) {
                    remember(raw.key.id, {
                        text,
                        sender: raw.key.participant || raw.key.remoteJid,
                        pushName: raw.pushName,
                        chat: raw.key.remoteJid,
                        ts: Date.now()
                    });
                }
            } catch (err) {
                console.error('[ANTIEDIT] upsert error:', err.message);
            }
        }
    });

    sock.ev.on('messages.update', async (updates) => {
        for (const u of updates || []) {
            try {
                const edit = parseUpdateEdit(u);
                if (edit) await handleEdit(sock, edit);
            } catch (err) {
                console.error('[ANTIEDIT] update error:', err.message);
            }
        }
    });
}

// ───────────── command ─────────────
const box = (...lines) =>
    `┏▣ ◈ *𝗔𝗡𝗧𝗜-𝗘𝗗𝗜𝗧* ◈\n┃\n${lines.filter(l => l !== null && l !== undefined).map(l => `┃${l}`).join('\n')}\n┃\n┗▣\n> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`;

const describe = (mode) => ({
    off: '🔴 OFF',
    inchat: '🟢 ON — reports in the same chat',
    indm: '🟢 ON — reports to your DM'
}[mode]);

const registered = cmd({
    pattern: 'antiedit',
    name: 'antiedit',
    category: 'Admin',
    aliases: ['antiedits'],
    description: 'Show the original text when someone edits a message',
    filename: __filename
}, async (sock, m, args) => {
    attach(sock);

    if (!m.isOwner && !m.isDev) {
        return m.reply(box('🔒 *𝗢𝗪𝗡𝗘𝗥 𝗢𝗡𝗟𝗬*', '➽ Only the bot owner can use this.'));
    }

    const prefix = global.BOT_PREFIX || '.';
    const input = (args[0] || '').toLowerCase();
    const map = { on: 'inchat', inchat: 'inchat', chat: 'inchat', indm: 'indm', dm: 'indm', off: 'off', false: 'off', disable: 'off' };

    if (!map[input]) {
        return m.reply(box(
            `📊 *Status:* ${describe(settings.mode)}`,
            `📦 Messages remembered: ${store.size}`,
            `✏️ Edits caught: ${stats.edits}  (reported: ${stats.reported})`,
            '',
            '📌 *𝗦𝗘𝗧𝗧𝗜𝗡𝗚𝗦*',
            `➽ ${prefix}antiedit inchat  (show in the chat)`,
            `➽ ${prefix}antiedit indm  (send to your DM)`,
            `➽ ${prefix}antiedit off`
        ));
    }

    settings.mode = map[input];
    global.antiedit = settings.mode;
    saveSettings();

    await m.react(settings.mode === 'off' ? '❌' : '✏️').catch(() => {});
    return m.reply(box(
        '✅ *𝗦𝗘𝗧𝗧𝗜𝗡𝗚 𝗦𝗔𝗩𝗘𝗗*',
        `📊 *Status:* ${describe(settings.mode)}`,
        settings.mode === 'off' ? null : '➽ Edited messages will be exposed from now on.'
    ));
});

// Start listening as soon as the bot handles any message (also after a reconnect)
registered.onMessage = async (sock) => {
    attach(sock);
    return false;
};

// Optional: lets index.js attach immediately on connect (see notes)
module.exports = { attach, _internals: { handleEdit, parseUpsertEdit, parseUpdateEdit, store, stats, settings } };
