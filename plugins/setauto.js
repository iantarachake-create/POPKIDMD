'use strict';
const { cmd } = require('../arslan');
const settings = require('../lib/settings');
const { defineToggle } = require('../lib/toggle');
const { P, isOwner, box, parseOnOff, digits, numberOf, deliveryJid, once, unwrap } = require('../lib/cmdutil');

const CAT = 'Settings';

/* ═══════════════════ simple on/off features that index.js already understands ═══════════════════ */
defineToggle('autoviewstatus', 'autoviewstatus', 'Auto view statuses', { filename: __filename, react: '👀' });
defineToggle('autoreactstatus', 'autoreactstatus', 'Auto react to statuses', { filename: __filename, react: '💚',
    help: [`➽ Emojis: ${P()}setstatusemoji ❤️ 🔥 😍`] });
defineToggle('autoreactchannel', 'autoreactchannel', 'Auto react to channel posts', { filename: __filename, react: '📢',
    help: [`➽ Emojis: ${P()}setchannelreactemoji ❤️ 🔥`] });
defineToggle('alwaysonline', 'alwaysonline', 'Always online', {
    filename: __filename, react: '🟢',
    after: async (sock, m, v) => { try { await sock.sendPresenceUpdate(v ? 'available' : 'unavailable'); } catch {} }
});

/* ═══════════════════ typing / recording indicators (persisted, share global.presenceMode) ═══════════════════ */
function presenceCommand(name, mode, label) {
    cmd({ pattern: name, name, category: CAT, desc: `${label}: on/off`, react: '⌨️', filename: __filename },
    async (sock, m, args) => {
        if (!isOwner(m)) return m.reply('❌ Owner only.');
        const v = parseOnOff(args[0]);
        const cur = settings.get('presence');
        if (v === null) return m.reply(`⚙️ ${label}: ${cur === mode ? '✅ ON' : '❌ OFF'}\nUsage: ${P()}${name} on|off\n(current presence mode: ${cur})`);
        if (v) settings.set('presence', mode);
        else if (cur === mode) settings.set('presence', 'none');
        return m.reply(`✅ ${label} turned ${v ? 'ON' : 'OFF'}.`);
    });
}
presenceCommand('autotype', 'typing', 'Auto typing');
presenceCommand('autorecord', 'recording', 'Auto recording');
presenceCommand('autorecordtyping', 'both', 'Auto recording + typing');

/* ═══════════════════ custom emojis ═══════════════════ */
function emojiCommand(name, key, label) {
    cmd({ pattern: name, name, category: CAT, desc: `Set ${label} emojis: .${name} ❤️ 🔥 😍 | reset`, react: '😀', filename: __filename },
    async (sock, m, args) => {
        if (!isOwner(m)) return m.reply('❌ Owner only.');
        const text = args.join(' ').trim();
        if (!text) return m.reply(`❌ Usage: ${P()}${name} ❤️ 🔥 😍   (several = random)\n➽ ${P()}${name} reset\n➽ Current: ${settings.get(key) || 'default random set'}`);
        if (text.toLowerCase() === 'reset') { settings.reset(key); return m.reply(`✅ ${label} emojis reset to default.`); }
        const saved = settings.set(key, text);
        return m.reply(`✅ ${label} emojis: ${saved}`);
    });
}
emojiCommand('setstatusemoji', 'statusemoji', 'status reaction');
emojiCommand('setchannelreactemoji', 'channelemoji', 'channel reaction');

/* ═══════════════════ where saved things go ═══════════════════ */
cmd({ pattern: 'autosend', name: 'autosend', category: CAT, desc: 'Choose where saved statuses / revealed view-once go: me | here | <number> | group id', react: '📤', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const a = (args[0] || '').toLowerCase();
    if (!a) {
        return m.reply(box('𝗔𝗨𝗧𝗢𝗦𝗘𝗡𝗗', [
            `➽ Now sending to: ${settings.get('sendto') || 'your own chat (default)'}`,
            `➽ ${P()}autosend me      → your own chat`,
            `➽ ${P()}autosend here    → this chat`,
            `➽ ${P()}autosend 2547xxxxxxxx`,
            '➽ Used by: autosavestatus, autosaverepliedstatus,',
            '➽ antideletestatus and antiviewonce'
        ]));
    }
    if (a === 'me' || a === 'off' || a === 'default') { settings.reset('sendto'); return m.reply('✅ Saved items go to your own chat.'); }
    let jid;
    if (a === 'here') jid = m.from;
    else if (/@(s\.whatsapp\.net|g\.us)$/.test(a)) jid = a;
    else if (digits(a).length >= 7) jid = `${digits(a)}@s.whatsapp.net`;
    else return m.reply('❌ Use: me, here, a number with country code, or a group id.');
    settings.set('sendto', jid);
    return m.reply(`✅ Saved items now go to ${jid.endsWith('@g.us') ? 'that group' : '+' + numberOf(jid)}.`);
});

/* ═══════════════════ status saving / anti-delete status ═══════════════════ */
defineToggle('autosavestatus', 'autosavestatus', 'Auto save statuses', { filename: __filename, react: '💾',
    help: [`➽ Saved to your chat (change with ${P()}autosend)`] });
defineToggle('autosaverepliedstatus', 'autosaverepliedstatus', 'Auto save statuses you reply to', { filename: __filename, react: '💾',
    help: ['➽ When YOU reply to someone\'s status, I save that status for you.'] });
defineToggle('antideletestatus', 'antideletestatus', 'Anti-delete status', { filename: __filename, react: '♻️',
    help: ['➽ If someone deletes a status I already saw, I send it to you.'] });

const statusCache = new Map();
const MAX_CACHE = 400;

async function resolvePn(sock, jid) {
    if (!jid) return '';
    if (!String(jid).endsWith('@lid')) return numberOf(jid);
    try {
        const pn = await sock?.signalRepository?.lidMapping?.getPNForLID?.(jid);
        if (pn) return numberOf(pn);
    } catch { /* ignore */ }
    return numberOf(jid);
}

async function deliverStatus(sock, raw, title) {
    const u = unwrap(raw.message);
    const to = deliveryJid(sock);
    const poster = await resolvePn(sock, raw.key.participant);
    const head = `${title}\n➽ From: +${poster}`;
    const c = u.content || {};

    if (['imageMessage', 'videoMessage', 'audioMessage'].includes(u.type)) {
        const buffer = await global.downloadMediaMessage({ key: raw.key, message: u.msg }, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
        if (u.type === 'audioMessage') {
            await sock.sendMessage(to, { audio: buffer, mimetype: c.mimetype || 'audio/mp4', ptt: !!c.ptt });
            return sock.sendMessage(to, { text: head });
        }
        const k = u.type === 'imageMessage' ? 'image' : 'video';
        return sock.sendMessage(to, { [k]: buffer, caption: `${head}${c.caption ? '\n➽ ' + c.caption : ''}` });
    }
    const text = c.text || (typeof c === 'string' ? c : '');
    if (text) return sock.sendMessage(to, { text: `${head}\n\n${text}` });
}

const guard = once();
const hook = cmd({ pattern: '__setauto_hook', name: '__setauto_hook', hidden: true, category: CAT, filename: __filename }, async () => {});

hook.onMessage = async (sock, m) => {
    if (!guard(m)) return false;
    const raw = m.raw;
    if (!raw || !raw.message) return false;

    /* ─── statuses posted by others ─── */
    if (m.from === 'status@broadcast') {
        if (raw.key.fromMe) return false;
        const u = unwrap(raw.message);

        // someone deleted a status
        if (u.type === 'protocolMessage' && u.content?.type === 0 && u.content?.key?.id) {
            if (settings.get('antideletestatus')) {
                const old = statusCache.get(u.content.key.id);
                if (old) {
                    try { await deliverStatus(sock, old, '♻️ *Deleted status recovered*'); }
                    catch (e) { console.log('antideletestatus failed:', e.message); }
                }
            }
            return false;
        }

        if (['imageMessage', 'videoMessage', 'audioMessage', 'extendedTextMessage', 'conversation'].includes(u.type)) {
            if (settings.get('antideletestatus')) {
                statusCache.set(raw.key.id, raw);
                if (statusCache.size > MAX_CACHE) statusCache.delete(statusCache.keys().next().value);
            }
            if (settings.get('autosavestatus')) {
                try { await deliverStatus(sock, raw, '💾 *Status saved*'); }
                catch (e) { console.log('autosavestatus failed:', e.message); }
            }
        }
        return false; // leave statuses flowing to the other plugins exactly as before
    }

    /* ─── you replied to a status → save it ─── */
    if (raw.key.fromMe && settings.get('autosaverepliedstatus')) {
        const u = unwrap(raw.message);
        const ctx = u.ctx;
        if (ctx?.remoteJid === 'status@broadcast' && ctx.quotedMessage && ctx.stanzaId) {
            try {
                await deliverStatus(sock, {
                    key: { remoteJid: 'status@broadcast', id: ctx.stanzaId, participant: ctx.participant, fromMe: false },
                    message: ctx.quotedMessage
                }, '💾 *Replied status saved*');
            } catch (e) { console.log('autosaverepliedstatus failed:', e.message); }
        }
    }

    /* ─── "recording + typing" presence ─── */
    if (!raw.key.fromMe && global.presenceMode === 'both' && m.from) {
        try {
            await sock.sendPresenceUpdate('composing', m.from);
            setTimeout(() => sock.sendPresenceUpdate('recording', m.from).catch(() => {}), 2500);
        } catch { /* ignore */ }
    }

    /* ─── auto block by country code ─── */
    if (!m.isGroup && !raw.key.fromMe && !m.isOwner && !m.isDev && settings.get('autoblock')) {
        const codes = settings.list('countrycodes');
        if (codes.length) {
            const resolved = await resolvePn(sock, m.sender);
            // an @lid that could not be turned into a phone number must never be matched against country codes
            const real = String(m.sender).endsWith('@lid') && resolved === numberOf(m.sender) ? '' : resolved;
            if (real && codes.some(c => real.startsWith(c))) {
                try {
                    await sock.updateBlockStatus(m.sender, 'block');
                    console.log(`⛔ autoblock: blocked +${real}`);
                } catch (e) { console.log('autoblock failed:', e.message); }
                return true;
            }
        }
    }
    return false;
};

/* ═══════════════════ autoblock + country codes ═══════════════════ */
defineToggle('autoblock', 'autoblock', 'Auto-block by country code', { filename: __filename, react: '⛔',
    help: [`➽ Blocks private messages from numbers starting with a listed code.`, `➽ Add codes: ${P()}addcountrycode 212 91`] });

cmd({ pattern: 'addcountrycode', name: 'addcountrycode', category: CAT, desc: 'Add country codes to block: .addcountrycode 212 91', react: '➕', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const codes = args.join(' ').split(/[\s,]+/).map(c => digits(c)).filter(c => c.length >= 1 && c.length <= 4);
    if (!codes.length) return m.reply(`❌ Usage: ${P()}addcountrycode 212 91 234   (digits only, no +)`);
    const mine = numberOf(sock.user?.id || '');
    const own = codes.filter(c => mine.startsWith(c));
    if (own.length) return m.reply(`❌ Refused: ${own.join(', ')} matches YOUR OWN number, which would block almost everyone you know.`);
    const l = settings.list('countrycodes');
    const added = codes.filter(c => !l.includes(c));
    l.push(...added); settings.save();
    return m.reply(`✅ Added: ${added.join(', ') || 'nothing new'}\n${settings.get('autoblock') ? '' : `⚠️ Autoblock is OFF. Turn on: ${P()}autoblock on`}`.trim());
});
cmd({ pattern: 'delcountrycode', name: 'delcountrycode', category: CAT, desc: 'Remove a blocked country code (or "all")', react: '➖', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const l = settings.list('countrycodes');
    if ((args[0] || '').toLowerCase() === 'all') { const n = l.length; l.length = 0; settings.save(); return m.reply(`✅ Removed ${n} code(s).`); }
    const codes = args.join(' ').split(/[\s,]+/).map(c => digits(c)).filter(Boolean);
    if (!codes.length) return m.reply(`❌ Usage: ${P()}delcountrycode 212   or   all`);
    let n = 0;
    for (const c of codes) { const i = l.indexOf(c); if (i >= 0) { l.splice(i, 1); n++; } }
    settings.save();
    return m.reply(n ? `✅ Removed ${n} code(s).` : 'ℹ️ None of those codes were listed.');
});
cmd({ pattern: 'listcountrycode', name: 'listcountrycode', alias: ['listcountrycodes'], category: CAT, desc: 'Show blocked country codes', react: '📋', filename: __filename },
async (sock, m) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const l = settings.list('countrycodes');
    return m.reply(box('𝗖𝗢𝗨𝗡𝗧𝗥𝗬 𝗖𝗢𝗗𝗘𝗦', [`➽ Autoblock: ${settings.get('autoblock') ? '✅ ON' : '❌ OFF'}`, ...(l.length ? l.map(c => `➽ +${c}`) : ['➽ None'])]));
});

/* ═══════════════════ anti-call message ═══════════════════ */
const DEFAULT_CALL_MSG = '┏▣ ◈ *𝗔𝗡𝗧𝗜 𝗖𝗔𝗟𝗟* ◈\n┃\n┃🚫 Calls are disabled for this bot.\n┃\n┗▣';

cmd({ pattern: 'setanticallmsg', name: 'setanticallmsg', category: CAT, desc: 'Set the message sent to people who call the bot', react: '📵', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const text = args.join(' ').trim() || m.quoted?.body?.trim();
    if (!text) return m.reply(`❌ Usage: ${P()}setanticallmsg <message>\n➽ Turn the feature on with ${P()}anticall on`);
    settings.set('anticallmsg', text);
    return m.reply(`✅ Anti-call message saved.${global.antiCall ? '' : `\n⚠️ Anti-call is OFF — enable it: ${P()}anticall on`}\nPreview: ${P()}testanticallmsg`);
});
cmd({ pattern: 'delanticallmsg', name: 'delanticallmsg', category: CAT, desc: 'Restore the default anti-call message', react: '🗑️', filename: __filename },
async (sock, m) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    if (!settings.get('anticallmsg')) return m.reply('ℹ️ No custom message is set (already default).');
    settings.reset('anticallmsg');
    return m.reply('✅ Custom anti-call message deleted. Default restored.');
});
cmd({ pattern: 'showanticallmsg', name: 'showanticallmsg', category: CAT, desc: 'Show the current anti-call message', react: '👁️', filename: __filename },
async (sock, m) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    return m.reply(`📵 *Anti-call is ${global.antiCall ? 'ON' : 'OFF'}*\n\n${settings.get('anticallmsg') || DEFAULT_CALL_MSG}`);
});
cmd({ pattern: 'testanticallmsg', name: 'testanticallmsg', category: CAT, desc: 'Send yourself a preview of the anti-call message', react: '🧪', filename: __filename },
async (sock, m) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    await m.reply('🧪 This is exactly what a caller would receive:');
    return sock.sendMessage(m.from, { text: settings.get('anticallmsg') || DEFAULT_CALL_MSG });
});
