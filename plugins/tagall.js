const { cmd } = require('../arslan');

cmd({
    pattern: "tagall",
    name: 'tagall',
    category: 'Group',
    aliases: ['everyone'],
    description: 'Tag everyone in the group',
    filename: __filename
}, async (sock, m) => {

    if (!m.isGroup) {
        return await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗧𝗔𝗚𝗔𝗟𝗟* ◈
┃
┃❌ *𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬*
┃
┃➽ This command can only
┃   be used in groups.
┃
┗▣`);
    }

    if (!m.isOwner && !m.isAdmin) {
        return await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗧𝗔𝗚𝗔𝗟𝗟* ◈
┃
┃❌ *𝗔𝗖𝗖𝗘𝗦𝗦 𝗗𝗘𝗡𝗜𝗘𝗗*
┃
┃➽ Only group admins
┃   or the bot owner can
┃   use this command.
┃
┗▣`);
    }

    const participants = Array.isArray(m.groupMetadata?.participants)
        ? m.groupMetadata.participants.map(p => p.id)
        : [];

    if (!participants.length) {
        return await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗧𝗔𝗚𝗔𝗟𝗟* ◈
┃
┃❌ *𝗡𝗢 𝗠𝗘𝗠𝗕𝗘𝗥𝗦 𝗙𝗢𝗨𝗡𝗗*
┃
┃➽ Unable to find group
┃   participants.
┃
┗▣`);
    }

    const mentionText = participants
        .map(p => `@${p.split('@')[0]}`)
        .join('\n');

    const message = `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗧𝗔𝗚𝗔𝗟𝗟* ◈
┃
┃👋 *𝗛𝗘𝗟𝗟𝗢 𝗘𝗩𝗘𝗥𝗬𝗢𝗡𝗘!*
┃
┃𝗚𝗥𝗢𝗨𝗣 𝗠𝗘𝗠𝗕𝗘𝗥𝗦:
┃
${mentionText}
┃
┗▣`;

    await m.send({
        text: message,
        mentions: participants
    });
});
