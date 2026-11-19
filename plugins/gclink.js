'use strict';

const { cmd } = require('../arslan');

const JID_RE = /[\d-]+@(?:g\.us|newsletter)/;

function extractJid(m, args) {
    const rawArgs = Array.isArray(args)
        ? args.join(' ')
        : typeof args === 'string'
            ? args
            : '';

    const argMatch = rawArgs.match(JID_RE);
    if (argMatch) return argMatch[0];

    const quotedText =
        m?.quoted?.text ||
        m?.quoted?.body ||
        m?.quoted?.message?.conversation ||
        m?.quoted?.message?.extendedTextMessage?.text ||
        '';

    const quotedMatch = String(quotedText).match(JID_RE);
    if (quotedMatch) return quotedMatch[0];

    const chatId = m?.chat || m?.from || m?.key?.remoteJid || '';
    if (typeof chatId === 'string' && chatId.endsWith('@g.us')) {
        return chatId;
    }

    return null;
}

cmd({
    pattern: 'gclink',
    name: 'gclink',
    alias: ['link', 'invitelink', 'grouplink'],
    category: 'Group',
    desc: 'Get group invite link (usable by any member)',
    filename: __filename
}, async (sock, m, args) => {
    try {
        const groupJid = extractJid(m, args);

        if (!groupJid || !groupJid.endsWith('@g.us')) {
            return await m.reply(
                '❌ Please use this command inside a group, or pass/reply to a group JID.\n\n' +
                'Example: `.gclink 120363000000000000@g.us`'
            );
        }

        let meta = null;
        try {
            meta = await sock.groupMetadata(groupJid);
        } catch {
            // Optional fallback if metadata fails
        }

        const code = await sock.groupInviteCode(groupJid);
        const link = `https://chat.whatsapp.com/${code}`;
        const groupName = meta?.subject ? `*${meta.subject}*` : 'Group';

        await m.reply(`🔗 *Group Invite Link*\n\n📌 *Group:* ${groupName}\n🌐 *Link:* ${link}`);
    } catch (err) {
        console.error('[GCLINK] error:', err);
        const msg = String(err?.message || '').toLowerCase();

        if (msg.includes('not-authorized') || msg.includes('forbidden') || msg.includes('401') || msg.includes('403')) {
            return await m.reply('❌ The bot must be an *admin* in that group to fetch its invite link.');
        }
        if (msg.includes('not-in-group') || msg.includes('404') || msg.includes('item-not-found')) {
            return await m.reply('❌ The bot is not in that group or the group no longer exists.');
        }

        await m.reply('❌ Failed to fetch the group invite link.');
    }
});
