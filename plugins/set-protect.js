'use strict';
const { cmd } = require('../arslan');
const settings = require('../lib/settings');
const { defineToggle } = require('../lib/toggle');
const { P, isOwner, isAdminOrOwner, box, numberOf, targetJid, deliveryJid, once, unwrap } = require('../lib/cmdutil');

const CAT = 'Settings';

/* ═══════════════════ ANTI FILTERS (per group, or global from the owner's DM) ═══════════════════ */
const ANTI = {
    antiaudio:       { key: 'audio',       label: 'audio files' },
    antivoice:       { key: 'voice',       label: 'voice notes' },
    antigif:         { key: 'gif',         label: 'GIFs' },
    antiimage:       { key: 'image',       label: 'images' },
    antivideo:       { key: 'video',       label: 'videos' },
    antisticker:     { key: 'sticker',     label: 'stickers' },
    antidocument:    { key: 'document',    label: 'documents' },
    antilocation:    { key: 'location',    label: 'locations' },
    anticontact:     { key: 'contact',     label: 'contact cards' },
    antipoll:        { key: 'poll',        label: 'polls' },
    antireaction:    { key: 'reaction',    label: 'reaction spam' },
    antiforward:     { key: 'forward',     label: 'forwarded messages' },
    antimessage:     { key: 'text',        label: 'text messages' },
    antichannelpost: { key: 'channelpost', label: 'channel posts' }
};

const ACTIONS = ['delete', 'warn', 'kick'];

function antiAction(type, group) {
    const cfg = settings.map('anti')[type] || {};
    const v = cfg[group] !== undefined ? cfg[group] : cfg['*'];
    return v && v !== 'off' ? v : 'off';
}

function classify(message) {
    const u = unwrap(message);
    const c = u.content || {};
    const tags = new Set();
    switch (u.type) {
        case 'imageMessage': tags.add('image'); break;
        case 'videoMessage': tags.add(c.gifPlayback ? 'gif' : 'video'); break;
        case 'audioMessage': tags.add(c.ptt ? 'voice' : 'audio'); break;
        case 'stickerMessage': tags.add('sticker'); break;
        case 'documentMessage': tags.add('document'); break;
        case 'locationMessage':
        case 'liveLocationMessage': tags.add('location'); break;
        case 'contactMessage':
        case 'contactsArrayMessage': tags.add('contact'); break;
        case 'pollCreationMessage':
        case 'pollCreationMessageV2':
        case 'pollCreationMessageV3': tags.add('poll'); break;
        case 'reactionMessage': tags.add('reaction'); break;
        case 'conversation':
        case 'extendedTextMessage': tags.add('text'); break;
        default: break;
    }
    if (u.ctx?.isForwarded) tags.add('forward');
    if (u.ctx?.forwardedNewsletterMessageInfo) tags.add('channelpost');
    return { tags, u };
}

const noAdminNotice = new Map();
async function needAdminNotice(sock, jid) {
    const last = noAdminNotice.get(jid) || 0;
    if (Date.now() - last < 10 * 60 * 1000) return;
    noAdminNotice.set(jid, Date.now());
    await sock.sendMessage(jid, { text: '⚠️ A protection is ON but I am not an admin here, so I cannot delete messages or remove members. Please make me admin.' }).catch(() => {});
}

async function addWarning(sock, m, reason) {
    const limit = global.maxWarnings || 3;
    const warns = global.warnCounts instanceof Map ? global.warnCounts : (global.warnCounts = new Map());
    const count = (warns.get(m.sender) || 0) + 1;
    warns.set(m.sender, count);
    if (count >= limit) {
        warns.set(m.sender, 0);
        try {
            await sock.groupParticipantsUpdate(m.from, [m.sender], 'remove');
            await sock.sendMessage(m.from, { text: `🚫 @${numberOf(m.sender)} reached ${limit} warnings (${reason}) and was removed.`, mentions: [m.sender] });
        } catch (e) {
            await sock.sendMessage(m.from, { text: `⚠️ @${numberOf(m.sender)} reached ${limit} warnings but I could not remove them: ${e.message}`, mentions: [m.sender] }).catch(() => {});
        }
    } else {
        await sock.sendMessage(m.from, { text: `⚠️ @${numberOf(m.sender)} warned (${count}/${limit}) — ${reason}`, mentions: [m.sender] }).catch(() => {});
    }
}

async function enforce(sock, m, raw, action, reason, { canDelete = true } = {}) {
    if (!m.isBotAdmin) { await needAdminNotice(sock, m.from); return false; }
    if (canDelete) await sock.sendMessage(m.from, { delete: raw.key }).catch(() => {});
    if (action === 'warn') await addWarning(sock, m, reason);
    else if (action === 'kick') {
        await sock.groupParticipantsUpdate(m.from, [m.sender], 'remove').catch(async e => {
            await sock.sendMessage(m.from, { text: `⚠️ Could not remove @${numberOf(m.sender)}: ${e.message}`, mentions: [m.sender] }).catch(() => {});
        });
    }
    return true;
}

for (const [name, info] of Object.entries(ANTI)) {
    cmd({
        pattern: name, name, category: CAT,
        desc: `Block ${info.label}: on | off | delete | warn | kick`, react: '🛡️', filename: __filename
    }, async (sock, m, args) => {
        const wantsGlobal = (args[1] || '').toLowerCase() === 'global' || (!m.isGroup && isOwner(m));
        if (m.isGroup && !wantsGlobal) {
            if (!isAdminOrOwner(m)) return m.reply('❌ Admins only.');
        } else if (!isOwner(m)) {
            return m.reply('❌ Only the owner can change the global setting.');
        }
        const scope = wantsGlobal ? '*' : m.from;
        const scopeText = wantsGlobal ? 'ALL groups' : 'this group';
        const v = (args[0] || '').toLowerCase();
        const cfg = settings.map('anti');

        if (!v || v === 'status') {
            const cur = antiAction(info.key, m.isGroup ? m.from : '*');
            return m.reply(box(`𝗣𝗢𝗣𝗞𝗜𝗗 ${name.toUpperCase()}`, [
                `➽ Blocking ${info.label}: ${cur === 'off' ? '❌ OFF' : '✅ ' + cur.toUpperCase()}`,
                `➽ ${P()}${name} on|off`,
                `➽ ${P()}${name} delete|warn|kick`,
                ...(info.key === 'reaction' ? ['➽ (reactions cannot be deleted; spam gets warned/kicked)'] : []),
                ...(!m.isGroup ? [] : [`➽ Owner: add "global" to cover all groups`])
            ]));
        }
        let action;
        if (v === 'off') action = 'off';
        else if (v === 'on') action = 'delete';
        else if (ACTIONS.includes(v)) action = v;
        else return m.reply(`❌ Use: ${P()}${name} on | off | delete | warn | kick`);

        cfg[info.key] = cfg[info.key] || {};
        cfg[info.key][scope] = action;
        settings.save();
        return m.reply(action === 'off'
            ? `✅ ${name} turned OFF for ${scopeText}.`
            : `✅ ${name} ON for ${scopeText} — action: ${action.toUpperCase()}.${m.isGroup ? '\n(I must be a group admin to delete.)' : ''}`);
    });
}

/* ═══════════════════ antibug / antiviewonce ═══════════════════ */
defineToggle('antibug', 'antibug', 'Anti-bug (crash-message protection)', {
    filename: __filename, react: '🐞',
    help: ['➽ Deletes crash/lag messages and blocks the sender.']
});
defineToggle('antiviewonce', 'antiviewonce', 'Anti view-once (reveal)', {
    filename: __filename, react: '👁️',
    help: ['➽ Reveals view-once photos/videos/voice to your chat (or .autosend target).']
});

const BUG_RE = /[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u0610-\u061A\u064B-\u065F\u06D6-\u06ED\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F]{60,}|[\uA980-\uA9DF]{15,}|[\u{1F000}-\u{1FAFF}]{400,}/u;
function looksLikeBug(text) {
    if (!text) return false;
    if (text.length > 20000) return true;
    return BUG_RE.test(text);
}

/* ═══════════════════ ignore list ═══════════════════ */
cmd({ pattern: 'addignorelist', name: 'addignorelist', category: CAT, desc: 'Bot ignores a chat/user. Use in a chat, or with @tag/number', react: '🔇', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const t = targetJid(m, args);
    const id = t ? `${numberOf(t)}@s.whatsapp.net` : m.from;
    const list = settings.list('ignore');
    if (list.includes(id)) return m.reply('ℹ️ Already on the ignore list.');
    list.push(id); settings.save();
    return m.reply(`✅ Added to ignore list: ${t ? '+' + numberOf(id) : (m.isGroup ? 'this group' : 'this chat')}\nI will not respond there (you still can).`);
});
cmd({ pattern: 'delignorelist', name: 'delignorelist', category: CAT, desc: 'Remove a chat/user from the ignore list', react: '🔊', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const t = targetJid(m, args);
    const id = t ? `${numberOf(t)}@s.whatsapp.net` : m.from;
    const list = settings.list('ignore');
    if (!list.includes(id)) return m.reply('ℹ️ That chat/user is not on the ignore list.');
    list.splice(list.indexOf(id), 1); settings.save();
    return m.reply('✅ Removed from ignore list.');
});
cmd({ pattern: 'ignorelist', name: 'ignorelist', alias: ['listignorelist'], category: CAT, desc: 'Show the ignore list', react: '📋', filename: __filename },
async (sock, m) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const l = settings.list('ignore');
    return m.reply(box('𝗜𝗚𝗡𝗢𝗥𝗘 𝗟𝗜𝗦𝗧', l.length ? l.map((x, i) => `${i + 1}. ${x.endsWith('@g.us') ? 'group ' + x : '+' + numberOf(x)}`) : ['➽ Empty']));
});

/* ═══════════════════ enable / disable commands ═══════════════════ */
const PROTECTED_CMDS = new Set(['enable', 'disable', 'listdisabled']);
function resolveName(n) {
    const p = global.plugins instanceof Map ? global.plugins.get(String(n).toLowerCase()) : null;
    return p ? p.name : null;
}
cmd({ pattern: 'disable', name: 'disable', category: CAT, desc: 'Disable a command for everyone except owner: .disable <cmd>', react: '🚫', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const name = resolveName((args[0] || '').replace(P(), ''));
    if (!args[0]) return m.reply(`❌ Usage: ${P()}disable <command>`);
    if (!name) return m.reply('❌ No such command.');
    if (PROTECTED_CMDS.has(name)) return m.reply('❌ That command cannot be disabled.');
    const l = settings.list('disabled');
    if (l.includes(name)) return m.reply(`ℹ️ ${P()}${name} is already disabled.`);
    l.push(name); settings.save();
    return m.reply(`✅ ${P()}${name} disabled (and its aliases).`);
});
cmd({ pattern: 'enable', name: 'enable', category: CAT, desc: 'Re-enable a disabled command: .enable <cmd> | all', react: '✅', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const l = settings.list('disabled');
    if ((args[0] || '').toLowerCase() === 'all') { const n = l.length; l.length = 0; settings.save(); return m.reply(`✅ Re-enabled ${n} command(s).`); }
    const name = resolveName((args[0] || '').replace(P(), ''));
    if (!args[0]) return m.reply(`❌ Usage: ${P()}enable <command>  or  ${P()}enable all`);
    if (!name || !l.includes(name)) return m.reply('ℹ️ That command is not disabled.');
    l.splice(l.indexOf(name), 1); settings.save();
    return m.reply(`✅ ${P()}${name} enabled.`);
});
cmd({ pattern: 'listdisabled', name: 'listdisabled', category: CAT, desc: 'Show disabled commands', react: '📋', filename: __filename },
async (sock, m) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const l = settings.list('disabled');
    return m.reply(box('𝗗𝗜𝗦𝗔𝗕𝗟𝗘𝗗 𝗖𝗠𝗗𝗦', l.length ? l.map(x => `➽ ${P()}${x}`) : ['➽ None']));
});

/* ═══════════════════ mute / unmute / mutelist (members of a group) ═══════════════════ */
const mutedIn = g => settings.map('mutes')[g] || [];
cmd({ pattern: 'mute', name: 'mute', category: CAT, desc: 'Silence a member: I delete their messages (reply/@tag)', react: '🔇', filename: __filename },
async (sock, m, args) => {
    if (!m.isGroup) return m.reply('❌ Group only.');
    if (!isAdminOrOwner(m)) return m.reply('❌ Admins only.');
    const t = targetJid(m, args);
    if (!t) return m.reply(`❌ Reply to or @tag the member: ${P()}mute @user`);
    if (!m.isBotAdmin) return m.reply('❌ Make me an admin first so I can delete their messages.');
    const jid = `${numberOf(t)}@s.whatsapp.net`;
    const meta = m.groupMetadata || await sock.groupMetadata(m.from).catch(() => null);
    const target = meta?.participants?.find(p => numberOf(p.id) === numberOf(t) || numberOf(p.phoneNumber) === numberOf(t));
    if (target?.admin) return m.reply('❌ I cannot mute a group admin.');
    const all = settings.map('mutes');
    all[m.from] = all[m.from] || [];
    if (all[m.from].some(x => numberOf(x) === numberOf(t) || x === (target?.id))) return m.reply('ℹ️ Already muted.');
    all[m.from].push(jid);
    if (target?.id && !all[m.from].includes(target.id)) all[m.from].push(target.id);
    settings.save();
    return sock.sendMessage(m.from, { text: `🔇 @${numberOf(t)} is muted. Their messages will be deleted.`, mentions: [t] }, { quoted: m.raw });
});
cmd({ pattern: 'unmute', name: 'unmute', category: CAT, desc: 'Unmute a member (reply/@tag)', react: '🔊', filename: __filename },
async (sock, m, args) => {
    if (!m.isGroup) return m.reply('❌ Group only.');
    if (!isAdminOrOwner(m)) return m.reply('❌ Admins only.');
    const t = targetJid(m, args);
    if (!t) return m.reply(`❌ Reply to or @tag the member: ${P()}unmute @user`);
    const all = settings.map('mutes');
    const before = (all[m.from] || []).length;
    all[m.from] = (all[m.from] || []).filter(x => numberOf(x) !== numberOf(t));
    settings.save();
    if (all[m.from].length === before) return m.reply('ℹ️ That member was not muted.');
    return sock.sendMessage(m.from, { text: `🔊 @${numberOf(t)} can talk again.`, mentions: [t] }, { quoted: m.raw });
});
cmd({ pattern: 'mutelist', name: 'mutelist', category: CAT, desc: 'List muted members of this group', react: '📋', filename: __filename },
async (sock, m) => {
    if (!m.isGroup) return m.reply('❌ Group only.');
    if (!isAdminOrOwner(m)) return m.reply('❌ Admins only.');
    const nums = [...new Set(mutedIn(m.from).map(numberOf))];
    return m.reply(box('𝗠𝗨𝗧𝗘 𝗟𝗜𝗦𝗧', nums.length ? nums.map((n, i) => `${i + 1}. +${n}`) : ['➽ Nobody is muted']));
});

/* ═══════════════════ bad words ═══════════════════ */
cmd({ pattern: 'addbadword', name: 'addbadword', category: CAT, desc: 'Ban words in groups: .addbadword word1, word2', react: '🤬', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const words = args.join(' ').split(/[,\n]+/).map(w => w.trim().toLowerCase()).filter(Boolean);
    if (!words.length) return m.reply(`❌ Usage: ${P()}addbadword word1, word2`);
    const l = settings.list('badwords');
    const added = words.filter(w => !l.includes(w));
    l.push(...added); settings.save();
    return m.reply(added.length ? `✅ Added ${added.length} bad word(s). In groups where I'm admin, messages containing them are deleted and the sender is warned.` : 'ℹ️ Those words are already listed.');
});
cmd({ pattern: 'deletebadword', name: 'deletebadword', alias: ['delbadword'], category: CAT, desc: 'Remove a bad word (or "all")', react: '🗑️', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const l = settings.list('badwords');
    const q = args.join(' ').trim().toLowerCase();
    if (!q) return m.reply(`❌ Usage: ${P()}deletebadword <word>  or  ${P()}deletebadword all`);
    if (q === 'all') { const n = l.length; l.length = 0; settings.save(); return m.reply(`✅ Cleared ${n} bad word(s).`); }
    const i = l.indexOf(q);
    if (i < 0) return m.reply('ℹ️ That word is not in the list.');
    l.splice(i, 1); settings.save();
    return m.reply('✅ Removed.');
});
cmd({ pattern: 'listbadword', name: 'listbadword', alias: ['badwords'], category: CAT, desc: 'Show banned words', react: '📋', filename: __filename },
async (sock, m) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const l = settings.list('badwords');
    return m.reply(box('𝗕𝗔𝗗 𝗪𝗢𝗥𝗗𝗦', l.length ? l.map(w => `➽ ${w}`) : ['➽ None']));
});

function hasBadWord(text) {
    const l = settings.list('badwords');
    if (!l.length || !text) return null;
    const t = text.toLowerCase();
    for (const w of l) {
        const re = /^[a-z0-9_]+$/.test(w) ? new RegExp(`(^|[^a-z0-9_])${w}([^a-z0-9_]|$)`, 'i') : null;
        if (re ? re.test(t) : t.includes(w)) return w;
    }
    return null;
}

/* ═══════════════════ filters: auto-replies (g = groups, p = private chats) ═══════════════════ */
function filterCommands(prefix, mapName, label) {
    cmd({ pattern: `${prefix}filter`, name: `${prefix}filter`, category: CAT, desc: `Auto-reply in ${label}: .${prefix}filter keyword | reply`, react: '🧲', filename: __filename },
    async (sock, m, args) => {
        if (!isOwner(m)) return m.reply('❌ Owner only.');
        const raw = args.join(' ');
        const i = raw.indexOf('|');
        const key = (i < 0 ? '' : raw.slice(0, i)).trim().toLowerCase();
        const reply = (i < 0 ? '' : raw.slice(i + 1)).trim();
        if (!key || !reply) return m.reply(`❌ Usage: ${P()}${prefix}filter keyword | reply text`);
        settings.map(mapName)[key] = reply; settings.save();
        return m.reply(`✅ Filter saved. When someone says "${key}" in ${label}, I reply.`);
    });
    cmd({ pattern: `del${prefix}filter`, name: `del${prefix}filter`, category: CAT, desc: `Delete a ${label} filter (or "all")`, react: '🗑️', filename: __filename },
    async (sock, m, args) => {
        if (!isOwner(m)) return m.reply('❌ Owner only.');
        const f = settings.map(mapName);
        const key = args.join(' ').trim().toLowerCase();
        if (!key) return m.reply(`❌ Usage: ${P()}del${prefix}filter keyword  or  all`);
        if (key === 'all') { const n = Object.keys(f).length; for (const k of Object.keys(f)) delete f[k]; settings.save(); return m.reply(`✅ Deleted ${n} filter(s).`); }
        if (!(key in f)) return m.reply('ℹ️ No such filter.');
        delete f[key]; settings.save();
        return m.reply('✅ Filter deleted.');
    });
    cmd({ pattern: `list${prefix}filter`, name: `list${prefix}filter`, category: CAT, desc: `Show ${label} filters`, react: '📋', filename: __filename },
    async (sock, m) => {
        if (!isOwner(m)) return m.reply('❌ Owner only.');
        const e = Object.entries(settings.map(mapName));
        return m.reply(box(`${label.toUpperCase()} 𝗙𝗜𝗟𝗧𝗘𝗥𝗦`, e.length ? e.map(([k, v]) => `➽ ${k} → ${v.length > 40 ? v.slice(0, 40) + '…' : v}`) : ['➽ None']));
    });
}
filterCommands('g', 'gfilters', 'groups');
filterCommands('p', 'pfilters', 'private chats');

const filterCooldown = new Map();
function matchFilter(text, mapName) {
    const f = settings.map(mapName);
    const t = text.toLowerCase();
    for (const [k, reply] of Object.entries(f)) {
        const re = /^[a-z0-9_]+$/.test(k) ? new RegExp(`(^|[^a-z0-9_])${k}([^a-z0-9_]|$)`, 'i') : null;
        if (re ? re.test(t) : t.includes(k)) return { k, reply };
    }
    return null;
}

/* ═══════════════════ the hook that makes all of this work ═══════════════════ */
const guard = once();
const reactionTrack = new Map();
const hook = cmd({ pattern: '__setprotect_hook', name: '__setprotect_hook', hidden: true, category: CAT, filename: __filename }, async () => {});

hook.onMessage = async (sock, m) => {
    if (!guard(m)) return false;
    const raw = m.raw;
    if (!raw || !raw.message) return false;
    if (m.from === 'status@broadcast') return false;

    const fromMe = !!raw.key.fromMe;
    const exempt = fromMe || m.isOwner || m.isDev;

    /* 1) ignore list */
    if (!exempt) {
        const ig = settings.list('ignore');
        if (ig.length && (ig.includes(m.from) || ig.some(x => numberOf(x) === numberOf(m.sender)))) return true;
    }

    /* 2) disabled commands */
    if (!exempt && m.body && m.body.startsWith(P())) {
        const typed = m.body.slice(P().length).trim().split(/\s+/)[0].toLowerCase();
        const dis = settings.list('disabled');
        if (dis.length) {
            const real = resolveName(typed);
            if (real && dis.includes(real)) {
                await m.reply(`🚫 ${P()}${real} is disabled by the owner.`).catch(() => {});
                return true;
            }
        }
    }

    if (fromMe) return false;

    const { tags, u } = classify(raw.message);
    const text = m.body || u.content?.text || u.content?.caption || '';
    const groupAdminExempt = m.isGroup && (m.isAdmin || m.isOwner || m.isDev);

    /* 3) muted members */
    if (m.isGroup && !groupAdminExempt) {
        const mu = mutedIn(m.from);
        if (mu.length && mu.some(x => numberOf(x) === numberOf(m.sender))) {
            await enforce(sock, m, raw, 'delete', 'muted');
            return true;
        }
    }

    /* 4) anti-bug (groups + private) */
    if (settings.get('antibug') && !m.isOwner && !m.isDev && !(m.isGroup && m.isAdmin)) {
        const crashing = looksLikeBug(text) || looksLikeBug(u.content?.contextInfo?.quotedMessage?.conversation || '');
        if (crashing) {
            if (m.isGroup && m.isBotAdmin) await sock.sendMessage(m.from, { delete: raw.key }).catch(() => {});
            await sock.updateBlockStatus(m.sender, 'block').catch(() => {});
            console.log(`🐞 antibug: blocked ${m.sender}`);
            return true;
        }
    }

    /* 5) anti-view-once reveal → owner chat */
    if (settings.get('antiviewonce') && u.viewOnce && ['imageMessage', 'videoMessage', 'audioMessage'].includes(u.type)) {
        try {
            const buffer = await global.downloadMediaMessage({ key: raw.key, message: u.msg }, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
            const to = deliveryJid(sock);
            const who = `@${numberOf(m.sender)}${m.isGroup ? ' in ' + (m.groupMetadata?.subject || 'a group') : ''}`;
            const cap = `👁️ *View-once revealed*\n➽ From: ${who}${u.content.caption ? '\n➽ ' + u.content.caption : ''}`;
            const k = u.type === 'imageMessage' ? 'image' : u.type === 'videoMessage' ? 'video' : 'audio';
            await sock.sendMessage(to, k === 'audio'
                ? { audio: buffer, mimetype: u.content.mimetype || 'audio/ogg; codecs=opus', ptt: !!u.content.ptt }
                : { [k]: buffer, caption: cap, mentions: [m.sender] });
            if (k === 'audio') await sock.sendMessage(to, { text: cap, mentions: [m.sender] });
        } catch (e) { console.log('antiviewonce failed:', e.message); }
    }

    /* 6) group-only protections */
    if (m.isGroup && !groupAdminExempt) {
        // anti filters
        for (const tag of tags) {
            const action = antiAction(tag, m.from);
            if (action === 'off') continue;
            if (tag === 'text' && text.startsWith(P())) continue;   // never delete bot commands

            if (tag === 'reaction') {
                const k = m.from + m.sender;
                const now = Date.now();
                const arr = (reactionTrack.get(k) || []).filter(t => now - t < 10000);
                arr.push(now); reactionTrack.set(k, arr);
                if (arr.length > 5) {
                    reactionTrack.set(k, []);
                    await enforce(sock, m, raw, action === 'kick' ? 'kick' : 'warn', 'reaction spam', { canDelete: false });
                }
                continue;
            }
            if (await enforce(sock, m, raw, action, `${tag} not allowed`)) return true;
        }

        // bad words
        const bad = tags.has('text') || text ? hasBadWord(text) : null;
        if (bad && await enforce(sock, m, raw, 'warn', 'bad language')) return true;
    }

    /* 7) filters (auto replies) */
    if (text && !text.startsWith(P())) {
        const mapName = m.isGroup ? 'gfilters' : 'pfilters';
        if (Object.keys(settings.map(mapName)).length) {
            const hit = matchFilter(text, mapName);
            if (hit) {
                const ck = m.from + hit.k;
                if (Date.now() - (filterCooldown.get(ck) || 0) > 5000) {
                    filterCooldown.set(ck, Date.now());
                    await m.reply(hit.reply).catch(() => {});
                }
            }
        }
    }
    return false;
};
