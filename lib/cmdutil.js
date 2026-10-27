'use strict';

const P = () => global.BOT_PREFIX || '.';

const isOwner = m => !!(m.isOwner || m.isDev);
const isAdminOrOwner = m => !!(m.isAdmin || m.isOwner || m.isDev);

function box(title, lines) {
    return `┏▣ ◈ *${title}* ◈\n┃\n${[].concat(lines).map(l => `┃${l}`).join('\n')}\n┃\n┗▣`;
}

function parseOnOff(arg) {
    const v = String(arg || '').toLowerCase();
    if (['on', 'true', 'enable', 'enabled', 'yes', '1'].includes(v)) return true;
    if (['off', 'false', 'disable', 'disabled', 'no', '0'].includes(v)) return false;
    return null;
}

const digits = s => String(s || '').replace(/[^\d]/g, '');
const bare = jid => String(jid || '').split(':')[0];
const numberOf = jid => bare(jid).split('@')[0];

/** user targeted by @mention, quoted reply, or typed number */
function targetJid(m, args = []) {
    const mention = m.mentionedJid?.[0];
    if (mention) return mention;
    const quotedSender = m.quoted?.key?.participant;
    if (quotedSender) return quotedSender;
    const num = digits(args.join(''));
    if (num.length >= 7) return `${num}@s.whatsapp.net`;
    return null;
}

/** where bot-side deliveries (saved status, reveals) go: setting "sendto" or the bot's own chat */
function selfJid(sock) {
    const id = sock?.user?.id || sock?.user?.lid || '';
    return bare(id).replace(/@.*$/, '') + '@s.whatsapp.net';
}
function deliveryJid(sock) {
    const s = require('./settings').get('sendto');
    if (s) return s.includes('@') ? s : `${digits(s)}@s.whatsapp.net`;
    return selfJid(sock);
}

/** per-message guard so a hook registered once is never run twice for the same message */
function once() {
    let last = null;
    return m => {
        const id = m?.key?.id || m?.id;
        if (!id) return true;
        if (last === id) return false;
        last = id;
        return true;
    };
}

/** strip wrappers (ephemeral / view-once / edited / document-with-caption) and classify */
function unwrap(message) {
    let msg = message || {};
    let viewOnce = false;
    for (let i = 0; i < 6; i++) {
        const inner =
            msg.ephemeralMessage?.message ||
            msg.viewOnceMessage?.message ||
            msg.viewOnceMessageV2?.message ||
            msg.viewOnceMessageV2Extension?.message ||
            msg.documentWithCaptionMessage?.message ||
            msg.editedMessage?.message ||
            null;
        if (!inner) break;
        if (msg.viewOnceMessage || msg.viewOnceMessageV2 || msg.viewOnceMessageV2Extension) viewOnce = true;
        msg = inner;
    }
    const type = Object.keys(msg).find(k => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage') || '';
    const content = msg[type];
    if (content && content.viewOnce) viewOnce = true;
    return { msg, type, content, viewOnce, ctx: content?.contextInfo || null };
}

module.exports = { P, isOwner, isAdminOrOwner, box, parseOnOff, digits, bare, numberOf, targetJid, selfJid, deliveryJid, once, unwrap };
