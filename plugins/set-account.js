'use strict';
const { cmd } = require('../arslan');
const settings = require('../lib/settings');
const { P, isOwner, isAdminOrOwner, box, digits, numberOf, targetJid } = require('../lib/cmdutil');

const CAT = 'Settings';

/* ═══════════════════ WhatsApp privacy ═══════════════════ */
const WHO = {
    everyone: 'all', all: 'all',
    contacts: 'contacts',
    contactsexcept: 'contact_blacklist', except: 'contact_blacklist', contact_blacklist: 'contact_blacklist',
    nobody: 'none', none: 'none'
};
const WHO_TEXT = { all: 'Everyone', contacts: 'My contacts', contact_blacklist: 'My contacts except…', none: 'Nobody', match_last_seen: 'Same as last seen' };

function privacyCommand({ name, label, field, method, values, help }) {
    cmd({ pattern: name, name, category: CAT, desc: `${label} privacy: ${values.join(' | ')}`, react: '🔒', filename: __filename },
    async (sock, m, args) => {
        if (!isOwner(m)) return m.reply('❌ Owner only.');
        const input = (args[0] || '').toLowerCase();
        if (!input) {
            let cur = '?';
            try { const p = await sock.fetchPrivacySettings(true); cur = WHO_TEXT[p[field]] || p[field] || '?'; } catch {}
            return m.reply(box(`𝗣𝗥𝗜𝗩𝗔𝗖𝗬: ${label.toUpperCase()}`, [
                `➽ Current: ${cur}`,
                `➽ ${P()}${name} ${help}`
            ]));
        }
        const value = values.includes(input) ? input : WHO[input];
        if (!value || !values.includes(value)) return m.reply(`❌ Choose: ${help}`);
        try {
            await sock[method](value);
            return m.reply(`✅ ${label} privacy → ${WHO_TEXT[value] || value}`);
        } catch (e) { return m.reply(`❌ WhatsApp refused: ${e.message}`); }
    });
}

const WHO_VALUES = ['all', 'contacts', 'contact_blacklist', 'none'];
const WHO_HELP = 'everyone | contacts | contactsexcept | nobody';
privacyCommand({ name: 'lastseen', label: 'Last seen', field: 'last', method: 'updateLastSeenPrivacy', values: WHO_VALUES, help: WHO_HELP });
privacyCommand({ name: 'mypp', label: 'Profile photo', field: 'profile', method: 'updateProfilePicturePrivacy', values: WHO_VALUES, help: WHO_HELP });
privacyCommand({ name: 'mystatus', label: 'Status', field: 'status', method: 'updateStatusPrivacy', values: WHO_VALUES, help: WHO_HELP });
privacyCommand({ name: 'groupaddprivacy', label: 'Who can add me to groups', field: 'groupadd', method: 'updateGroupsAddPrivacy', values: ['all', 'contacts', 'contact_blacklist'], help: 'everyone | contacts | contactsexcept' });
privacyCommand({ name: 'onlineprivacy', label: 'Online status', field: 'online', method: 'updateOnlinePrivacy', values: ['all', 'match_last_seen'], help: 'all | match_last_seen' });
privacyCommand({ name: 'readprivacy', label: 'Read receipts', field: 'readreceipts', method: 'updateReadReceiptsPrivacy', values: ['all', 'none'], help: 'all | none' });

/* ═══════════════════ profile ═══════════════════ */
cmd({ pattern: 'setbio', name: 'setbio', alias: ['setabout'], category: CAT, desc: 'Change the WhatsApp bio/about', react: '📝', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const text = args.join(' ').trim() || m.quoted?.body?.trim();
    if (!text) return m.reply(`❌ Usage: ${P()}setbio <text>`);
    if (text.length > 139) return m.reply('❌ Bio is too long (max 139 characters).');
    try {
        await sock.updateProfileStatus(text);
        return m.reply('✅ Bio updated.' + (global.autobio ? '\n⚠️ Auto-bio is running and may overwrite this soon.' : ''));
    } catch (e) { return m.reply(`❌ Failed: ${e.message}`); }
});

cmd({ pattern: 'setname', name: 'setname', alias: ['setwaname'], category: CAT, desc: 'Change the WhatsApp profile name of the bot account', react: '✏️', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const text = args.join(' ').trim();
    if (!text) return m.reply(`❌ Usage: ${P()}setname <new name>`);
    if (text.length > 25) return m.reply('❌ WhatsApp names are limited to 25 characters.');
    try {
        await sock.updateProfileName(text);
        return m.reply(`✅ WhatsApp name changed to: ${text}\n(Menu/bot title: ${P()}setbotname)`);
    } catch (e) { return m.reply(`❌ Failed: ${e.message}`); }
});

cmd({ pattern: 'removepp', name: 'removepp', alias: ['removeprofilepic', 'delpp'], category: CAT, desc: 'Remove the bot account profile picture', react: '🗑️', filename: __filename },
async (sock, m) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    try {
        await sock.removeProfilePicture(sock.user.id.split(':')[0] + '@s.whatsapp.net');
        return m.reply('✅ Profile picture removed.');
    } catch (e) { return m.reply(`❌ Failed: ${e.message}`); }
});

/* ═══════════════════ block list ═══════════════════ */
cmd({ pattern: 'blocklist', name: 'blocklist', alias: ['blocked'], category: CAT, desc: 'Show blocked contacts', react: '⛔', filename: __filename },
async (sock, m) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    try {
        const list = await sock.fetchBlocklist();
        if (!list || !list.length) return m.reply(box('𝗕𝗟𝗢𝗖𝗞 𝗟𝗜𝗦𝗧', ['➽ Nobody is blocked']));
        const shown = list.slice(0, 60).map((j, i) => `${i + 1}. +${numberOf(j)}`);
        if (list.length > 60) shown.push(`… and ${list.length - 60} more`);
        return m.reply(box(`𝗕𝗟𝗢𝗖𝗞 𝗟𝗜𝗦𝗧 (${list.length})`, shown));
    } catch (e) { return m.reply(`❌ Failed: ${e.message}`); }
});

cmd({ pattern: 'unblock', name: 'unblock', category: CAT, desc: 'Unblock a user (reply / @tag / number / use in their chat), or "all"', react: '✅', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    try {
        if ((args[0] || '').toLowerCase() === 'all') {
            const list = await sock.fetchBlocklist();
            let n = 0;
            for (const j of list || []) { try { await sock.updateBlockStatus(j, 'unblock'); n++; await new Promise(r => setTimeout(r, 700)); } catch {} }
            return m.reply(`✅ Unblocked ${n} contact(s).`);
        }
        let jid = targetJid(m, args);
        if (!jid && !m.isGroup) jid = m.from;
        if (!jid) return m.reply(`❌ Reply to, tag, or type a number: ${P()}unblock 2547xxxxxxxx`);
        await sock.updateBlockStatus(jid, 'unblock');
        return m.reply(`✅ Unblocked +${numberOf(jid)}.`);
    } catch (e) { return m.reply(`❌ Failed: ${e.message}`); }
});

/* ═══════════════════ group join requests ═══════════════════ */
function requestCommand(name, action, label) {
    cmd({ pattern: name, name, category: CAT, desc: `${label} group join requests: .${name} all | number | @tag`, react: action === 'approve' ? '✅' : '❌', filename: __filename },
    async (sock, m, args) => {
        if (!m.isGroup) return m.reply('❌ Group only.');
        if (!isAdminOrOwner(m)) return m.reply('❌ Admins only.');
        if (!m.isBotAdmin) return m.reply('❌ Make me an admin first.');
        let pending;
        try { pending = await sock.groupRequestParticipantsList(m.from); }
        catch (e) { return m.reply(`❌ Could not read join requests: ${e.message}`); }
        if (!pending || !pending.length) return m.reply('ℹ️ There are no pending join requests.');

        const asJid = p => p.jid || p.phone_number || p.id;
        if (!args.length && !m.mentionedJid?.length) {
            return m.reply(box('𝗝𝗢𝗜𝗡 𝗥𝗘𝗤𝗨𝗘𝗦𝗧𝗦', [
                ...pending.slice(0, 40).map((p, i) => `${i + 1}. +${numberOf(asJid(p))}`),
                `➽ ${P()}${name} all`,
                `➽ ${P()}${name} 2547xxxxxxxx`
            ]));
        }
        let targets;
        if ((args[0] || '').toLowerCase() === 'all') targets = pending.map(asJid);
        else {
            const wanted = [...(m.mentionedJid || []).map(numberOf), ...args.map(digits).filter(d => d.length >= 7)];
            targets = pending.map(asJid).filter(j => wanted.includes(numberOf(j)));
        }
        if (!targets.length) return m.reply('ℹ️ None of those numbers have a pending request.');
        try {
            await sock.groupRequestParticipantsUpdate(m.from, targets, action);
            return m.reply(`✅ ${action === 'approve' ? 'Approved' : 'Rejected'} ${targets.length} request(s).`);
        } catch (e) { return m.reply(`❌ Failed: ${e.message}`); }
    });
}
requestCommand('approve', 'approve', 'Approve');
requestCommand('reject', 'reject', 'Reject');

/* ═══════════════════ forward / getid / clearchat ═══════════════════ */
cmd({ pattern: 'forward', name: 'forward', alias: ['fwd'], category: CAT, desc: 'Reply to a message then: .forward <number|group id> [more…]', react: '↪️', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    if (!m.quoted) return m.reply(`❌ Reply to the message you want to forward: ${P()}forward 2547xxxxxxxx`);
    const targets = [];
    for (const a of args) {
        if (/@(s\.whatsapp\.net|g\.us|newsletter)$/.test(a)) targets.push(a);
        else if (digits(a).length >= 7) targets.push(`${digits(a)}@s.whatsapp.net`);
    }
    if (!args.length || (args[0] || '').toLowerCase() === 'here') targets.push(m.from);
    if (!targets.length) return m.reply('❌ Give a number with country code or a group id.');
    let ok = 0;
    for (const jid of [...new Set(targets)].slice(0, 15)) {
        try {
            await sock.sendMessage(jid, { forward: { key: m.quoted.key, message: m.quoted.message } });
            ok++;
            await new Promise(r => setTimeout(r, 800));
        } catch (e) { console.log('forward failed:', e.message); }
    }
    return m.reply(ok ? `✅ Forwarded to ${ok} chat(s).` : '❌ Could not forward (message type may not be forwardable).');
});

cmd({ pattern: 'getid', name: 'getid', alias: ['jid', 'id'], category: CAT, desc: 'Get chat / user / group-link / channel-link id', react: '🆔', filename: __filename },
async (sock, m, args) => {
    const lines = [`➽ *Chat* : ${m.from}`, `➽ *You* : ${m.sender}`];
    if (m.quoted?.key?.participant) lines.push(`➽ *Replied user* : ${m.quoted.key.participant}`);
    for (const t of m.mentionedJid || []) lines.push(`➽ *Tagged* : ${t}`);

    const link = args.find(a => /whatsapp\.com\//i.test(a));
    if (link) {
        const ch = link.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i);
        const gr = link.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i);
        try {
            if (ch) {
                const info = await sock.newsletterMetadata('invite', ch[1]);
                lines.push(`➽ *Channel* : ${info.name || ''}`, `➽ *Channel ID* : ${info.id}`);
            } else if (gr) {
                const info = await sock.groupGetInviteInfo(gr[1]);
                lines.push(`➽ *Group* : ${info.subject || ''}`, `➽ *Group ID* : ${info.id}`);
            }
        } catch (e) { lines.push(`➽ Link lookup failed: ${e.message}`); }
    }
    return m.reply(box('𝗚𝗘𝗧 𝗜𝗗', lines));
});

cmd({ pattern: 'clearchat', name: 'clearchat', alias: ['clearchats'], category: CAT, desc: 'Clear all messages in this chat (on the bot account)', react: '🧹', filename: __filename },
async (sock, m) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const ts = Number(m.raw?.messageTimestamp?.low ?? m.raw?.messageTimestamp) || Math.floor(Date.now() / 1000);
    const last = [{ key: m.key, messageTimestamp: ts }];
    try {
        await sock.chatModify({ clear: true, lastMessages: last }, m.from);
        return;
    } catch (e1) {
        try {
            await sock.chatModify({ delete: true, lastMessages: last }, m.from);
            return;
        } catch (e2) {
            return m.reply(`❌ Could not clear this chat: ${e2.message}`);
        }
    }
});

/* ═══════════════════ warn settings ═══════════════════ */
cmd({ pattern: 'setwarn', name: 'setwarn', category: CAT, desc: 'Set warnings before a member is removed (1-20)', react: '⚠️', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    if (!args[0]) return m.reply(`⚠️ Warn limit: ${settings.get('maxwarn')}\nUsage: ${P()}setwarn <1-20>`);
    try { const v = settings.set('maxwarn', args[0]); return m.reply(`✅ Members are removed after ${v} warning(s).`); }
    catch (e) { return m.reply(`❌ ${e.message}`); }
});
cmd({ pattern: 'listwarn', name: 'listwarn', alias: ['warnlist', 'warns'], category: CAT, desc: 'Show members who currently have warnings', react: '📋', filename: __filename },
async (sock, m) => {
    if (!isAdminOrOwner(m)) return m.reply('❌ Admins only.');
    const map = global.warnCounts instanceof Map ? global.warnCounts : new Map();
    const rows = [...map.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const limit = global.maxWarnings || 3;
    return m.reply(box(`𝗪𝗔𝗥𝗡 𝗟𝗜𝗦𝗧 (limit ${limit})`, rows.length ? rows.map(([j, n], i) => `${i + 1}. +${numberOf(j)} — ${n}/${limit}`) : ['➽ Nobody has warnings']));
});

/* ═══════════════════ welcome / goodbye messages ═══════════════════ */
const PLACEHOLDERS = '@user = the member • @group = group name • @count = member count';
if ((settings.get('welcomemsg') || settings.get('goodbyemsg')) && !global.welcomeConfig) global.welcomeConfig = { enabled: true };

function messageCommands(kind, key) {
    cmd({ pattern: `set${kind}`, name: `set${kind}`, category: CAT, desc: `Set the ${kind} message (${PLACEHOLDERS})`, react: '👋', filename: __filename },
    async (sock, m, args) => {
        if (!isOwner(m)) return m.reply('❌ Owner only.');
        const text = args.join(' ').trim() || m.quoted?.body?.trim();
        if (!text) return m.reply(box(`𝗦𝗘𝗧 ${kind.toUpperCase()}`, [`➽ ${P()}set${kind} <message>`, `➽ ${PLACEHOLDERS}`, `➽ Example: ${P()}set${kind} Hello @user, ${kind === 'welcome' ? 'welcome to' : 'goodbye from'} @group!`]));
        settings.set(key, text);
        global.welcomeConfig = global.welcomeConfig || { enabled: true };
        global.welcomeConfig.enabled = true;
        return m.reply(`✅ ${kind} message saved and welcome/goodbye messages are ON.\nPreview: ${text.replace(/@user/gi, '@' + numberOf(m.sender)).replace(/@group/gi, 'My Group').replace(/@count/gi, '25')}`);
    });
    cmd({ pattern: `del${kind}`, name: `del${kind}`, category: CAT, desc: `Delete the custom ${kind} message (back to default)`, react: '🗑️', filename: __filename },
    async (sock, m) => {
        if (!isOwner(m)) return m.reply('❌ Owner only.');
        if (!settings.get(key)) return m.reply(`ℹ️ No custom ${kind} message is set.`);
        settings.reset(key);
        return m.reply(`✅ Custom ${kind} message deleted. Default text restored.`);
    });
}
messageCommands('welcome', 'welcomemsg');
messageCommands('goodbye', 'goodbyemsg');
