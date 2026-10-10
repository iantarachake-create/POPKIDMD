const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { cmd } = require('../arslan');

const AI_API = 'https://api.delirius.online/ia/chatgpt';
const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'popkid-chatbot.json');
const MODE_FILE = path.join(DATA_DIR, 'bot-mode.json');

const BOT_NAME = 'Popkid MD';
const HISTORY_LIMIT = 8;       // last 8 lines of conversation kept per chat
const MAX_INPUT = 500;         // longest user message sent to the AI
const MAX_REPLY = 700;         // longest reply sent back
const MAX_QUEUE = 2;           // max messages waiting per chat (anti-spam)
const QUOTE_IN_DM = false;     // true = also quote-reply inside private chats

// Menu answers ("1", "audio", "doc"...) that belong to .play/.video/.x, not to the chatbot
const MENU_WORDS = /^(?:\d{1,2}|audio|mp3|doc|document|file|video|vid|mp4|voice|voicenote|vn|ptt|low|small)$/i;

const TITLE = '┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗗 𝗔𝗜* ◈';
const FOOTER = '> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗';
const box = (...lines) =>
    `${TITLE}\n┃\n${lines.filter(l => l !== null && l !== undefined).map(l => `┃${l}`).join('\n')}\n┃\n┗▣\n${FOOTER}`;

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const digits = (jid) => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');

// ───────────── storage ─────────────
let state = { all: false, chats: {} };

function loadState() {
    try {
        if (!fs.existsSync(DATA_FILE)) return;
        const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        state = { all: !!saved.all, chats: saved.chats && typeof saved.chats === 'object' ? saved.chats : {} };
    } catch (err) {
        console.error('[CHATBOT] Could not read saved settings:', err.message);
    }
}

function saveState() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
        console.error('[CHATBOT] Could not save settings:', err.message);
    }
}

loadState();

// Respect the bot's private mode (set by plugins/mode.js)
function isPrivateMode() {
    try {
        return JSON.parse(fs.readFileSync(MODE_FILE, 'utf8')).mode === 'private';
    } catch (_) {
        return false;
    }
}

// Is the chatbot active for this chat?
function isEnabled(m) {
    const setting = state.chats[m.from];
    if (setting === true) return true;
    if (setting === false) return false;
    return !m.isGroup && state.all;   // "all" only covers private chats
}

// ───────────── memory ─────────────
const memory = new Map();   // chatId -> [{ who, text }]

function remember(chatId, who, text) {
    const list = memory.get(chatId) || [];
    list.push({ who, text: String(text).slice(0, 200) });
    while (list.length > HISTORY_LIMIT) list.shift();
    memory.set(chatId, list);
}

// ───────────── AI ─────────────
function buildPrompt(chatId, label, text) {
    const history = (memory.get(chatId) || []).map(h => `${h.who}: ${h.text}`).join('\n');

    return [
        `You are ${BOT_NAME}, a chill, funny guy chatting on WhatsApp.`,
        '',
        'How you write:',
        '- Reply in the same language the person writes in (English, Swahili, Spanish, anything).',
        '- Keep it short, like a real text message: 1-2 sentences, under 40 words.',
        '- Casual and natural, light slang, an occasional emoji. No markdown, lists, headings or signatures.',
        '- Match their mood: joke around when they joke, be kind when they are sad, stay calm if they are rude.',
        '- Do not open every message with a greeting and do not repeat their question back.',
        `- Never say "As an AI language model". Your name is ${BOT_NAME}. If someone sincerely asks whether you are a bot or an AI, be honest: you are ${BOT_NAME}, a WhatsApp bot.`,
        '- If you are not sure about something, say so casually instead of making it up.',
        '',
        history ? `Conversation so far:\n${history}\n` : '',
        `${label}: ${text}`,
        `${BOT_NAME}:`
    ].filter(l => l !== '').join('\n');
}

function cleanReply(raw) {
    if (typeof raw !== 'string') return '';

    let t = raw
        .split('\n')
        .filter(line => !/googleusercontent\.com\/card_content/i.test(line))   // junk line the API prepends
        .join('\n')
        .replace(/^\s*(?:popkid md|assistant|bot)\s*:\s*/i, '')
        .replace(/\*\*(.+?)\*\*/g, '*$1*')       // markdown bold -> WhatsApp bold
        .replace(/^#{1,6}\s*/gm, '')             // headings
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    if (t.length > MAX_REPLY) {
        const cut = t.slice(0, MAX_REPLY);
        const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'));
        t = end > MAX_REPLY * 0.5 ? cut.slice(0, end + 1) : `${cut.trim()}…`;
    }
    return t;
}

async function askAI(prompt, retries = 2) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const { data } = await axios.get(AI_API, { params: { q: prompt }, timeout: 30000 });
            const reply = cleanReply(data?.data);
            if (!data?.status || !reply) throw new Error('Empty reply from AI');
            return reply;
        } catch (err) {
            lastErr = err;
            if (i < retries) await wait(1500);
        }
    }
    console.error('[CHATBOT] AI request failed:', lastErr?.message);
    return null;
}

// ───────────── replying ─────────────
const queues = new Map();   // chatId -> promise chain
const waiting = new Map();  // chatId -> number of queued messages

async function typing(sock, chatId, state_) {
    try { await sock.sendPresenceUpdate(state_, chatId); } catch (_) {}
}

async function respond(sock, m, text) {
    const chatId = m.from;
    const label = m.isGroup ? (m.pushName || 'User') : 'User';

    const started = Date.now();
    try { await sock.presenceSubscribe(chatId); } catch (_) {}
    await typing(sock, chatId, 'composing');

    const reply = await askAI(buildPrompt(chatId, label, text));

    if (!reply) {
        await typing(sock, chatId, 'paused');
        // Only apologise in private chats, stay quiet in groups
        if (!m.isGroup) await sock.sendMessage(chatId, { text: 'my brain lagged for a sec 😅 try again in a bit' });
        return;
    }

    // Human-like pause: longer replies "take longer to type"
    const target = Math.min(6000, Math.max(1500, 1200 + reply.length * 30));
    const elapsed = Date.now() - started;
    if (elapsed < target) await wait(target - elapsed);

    if (m.isGroup || QUOTE_IN_DM) await m.reply(reply);
    else await sock.sendMessage(chatId, { text: reply });

    await typing(sock, chatId, 'paused');

    remember(chatId, label, text);
    remember(chatId, BOT_NAME, reply);
}

function enqueue(sock, m, text) {
    const chatId = m.from;
    const count = waiting.get(chatId) || 0;
    if (count >= MAX_QUEUE) return;                 // too many pending, drop it
    waiting.set(chatId, count + 1);

    const prev = queues.get(chatId) || Promise.resolve();
    const next = prev
        .then(() => respond(sock, m, text))
        .catch(err => console.error('[CHATBOT] Error:', err.message))
        .finally(() => {
            const left = (waiting.get(chatId) || 1) - 1;
            if (left <= 0) { waiting.delete(chatId); queues.delete(chatId); }
            else waiting.set(chatId, left);
        });
    queues.set(chatId, next);
}

// Groups: only answer when called ("popkid", @mention, or a reply to the bot)
function isAddressed(sock, m, text) {
    const mine = [digits(sock.user?.id), digits(sock.user?.lid)].filter(Boolean);

    if (/\bpopkid\b/i.test(text)) return true;
    if (mine.some(n => text.includes(`@${n}`))) return true;

    const quotedFrom = digits(m.quoted?.key?.participant);
    return !!quotedFrom && mine.includes(quotedFrom);
}

const seen = new Set();   // message ids already handled (the hook runs once per alias)

// ───────────── command ─────────────
const registered = cmd({
    pattern: 'chatbot',
    name: 'chatbot',
    category: 'AI',
    aliases: ['ai', 'popkidai'],
    description: 'Turn the Popkid MD chatbot on or off',
    filename: __filename
}, async (sock, m, args) => {
    const prefix = global.BOT_PREFIX || '.';
    const sub = (args[0] || '').toLowerCase();
    const canToggle = !m.isGroup || m.isAdmin || m.isOwner || m.isDev;
    const where = m.isGroup ? 'this group' : 'this chat';

    if (['on', 'enable', 'start'].includes(sub)) {
        if (!canToggle) return m.reply(box('🔒 *𝗔𝗗𝗠𝗜𝗡𝗦 𝗢𝗡𝗟𝗬*', '➽ Only group admins can change this.'));
        state.chats[m.from] = true;
        saveState();
        return m.reply(box(
            '✅ *𝗖𝗛𝗔𝗧𝗕𝗢𝗧 𝗢𝗡*',
            `➽ ${BOT_NAME} will now reply in ${where}.`,
            m.isGroup ? '➽ In groups, say "popkid", @mention me, or reply to my messages.' : null
        ));
    }

    if (['off', 'disable', 'stop'].includes(sub)) {
        if (!canToggle) return m.reply(box('🔒 *𝗔𝗗𝗠𝗜𝗡𝗦 𝗢𝗡𝗟𝗬*', '➽ Only group admins can change this.'));
        state.chats[m.from] = false;
        saveState();
        memory.delete(m.from);
        return m.reply(box('🔕 *𝗖𝗛𝗔𝗧𝗕𝗢𝗧 𝗢𝗙𝗙*', `➽ ${BOT_NAME} will stay quiet in ${where}.`));
    }

    if (sub === 'all') {
        if (!m.isOwner && !m.isDev) return m.reply(box('🔒 *𝗢𝗪𝗡𝗘𝗥 𝗢𝗡𝗟𝗬*', '➽ Only the bot owner can use this.'));
        const value = (args[1] || '').toLowerCase();
        if (!['on', 'off'].includes(value)) {
            return m.reply(box('➽ Usage:', `➽ ${prefix}chatbot all on`, `➽ ${prefix}chatbot all off`));
        }
        state.all = value === 'on';
        saveState();
        return m.reply(box(
            state.all ? '✅ *𝗔𝗟𝗟 𝗣𝗥𝗜𝗩𝗔𝗧𝗘 𝗖𝗛𝗔𝗧𝗦: 𝗢𝗡*' : '🔕 *𝗔𝗟𝗟 𝗣𝗥𝗜𝗩𝗔𝗧𝗘 𝗖𝗛𝗔𝗧𝗦: 𝗢𝗙𝗙*',
            state.all
                ? `➽ ${BOT_NAME} replies to everyone who messages the bot privately.`
                : '➽ Private chats now follow their own on/off setting.',
            `➽ Groups still need ${prefix}chatbot on.`
        ));
    }

    if (['clear', 'reset', 'forget'].includes(sub)) {
        memory.delete(m.from);
        return m.reply(box('🧹 *𝗠𝗘𝗠𝗢𝗥𝗬 𝗖𝗟𝗘𝗔𝗥𝗘𝗗*', `➽ ${BOT_NAME} forgot this conversation.`));
    }

    // status / no argument
    const on = isEnabled(m);
    return m.reply(box(
        `🤖 *${BOT_NAME.toUpperCase()}*`,
        `➽ Status here: ${on ? '✅ ON' : '🔕 OFF'}`,
        `➽ All private chats: ${state.all ? '✅ ON' : '🔕 OFF'}`,
        '',
        '📌 *𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦*',
        `➽ ${prefix}chatbot on`,
        `➽ ${prefix}chatbot off`,
        `➽ ${prefix}chatbot clear`,
        `➽ ${prefix}chatbot all on/off  (owner)`
    ));
});

// ───────────── auto-reply hook ─────────────
// Runs on every incoming message. It never blocks other plugins or commands.
registered.onMessage = async (sock, m) => {
    try {
        const text = String(m.body || '').trim();
        if (!text) return false;
        if (m.key?.fromMe) return false;
        if (/@(broadcast|newsletter)$/.test(m.from || '')) return false;

        const prefix = global.BOT_PREFIX || '.';
        if (text.startsWith(prefix)) return false;                 // that's a command
        if (m.quoted && MENU_WORDS.test(text)) return false;       // answer to a .play/.video/.x menu

        if (!isEnabled(m)) return false;
        if (isPrivateMode() && !m.isOwner && !m.isDev) return false;
        if (m.isGroup && !isAddressed(sock, m, text)) return false;

        if (seen.has(m.id)) return false;                          // alias duplicate
        seen.add(m.id);
        if (seen.size > 500) seen.clear();

        // Strip @mentions of the bot before sending to the AI
        const mine = [digits(sock.user?.id), digits(sock.user?.lid)].filter(Boolean);
        let input = text;
        for (const n of mine) input = input.split(`@${n}`).join('');
        input = input.replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT);
        if (!input) input = 'hey';

        enqueue(sock, m, input);   // fire and forget
    } catch (err) {
        console.error('[CHATBOT] Hook error:', err.message);
    }
    return false;
};
