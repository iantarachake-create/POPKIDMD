const { cmd } = require('../arslan');

function getTargets(m, args) {
    const targets = [];

    // Mentioned users
    if (m.mentionedJid?.length) {
        targets.push(...m.mentionedJid);
    }

    // Replied/quoted user
    const ctx = m.message?.extendedTextMessage?.contextInfo;
    if (ctx?.participant) {
        targets.push(ctx.participant);
    }

    // Numbers provided directly
    for (const arg of args) {
        const number = arg.replace(/[^\d]/g, '');

        if (number.length >= 7) {
            targets.push(`${number}@s.whatsapp.net`);
        }
    }

    return [...new Set(targets)];
}


// ═════════════════════════════════════════════════════════════
// ADD
// ═════════════════════════════════════════════════════════════

cmd({
    pattern: "add",
    name: "add",
    category: "Group",
    aliases: ["invite"],
    description: "Add members to the group",
    filename: __filename
}, async (sock, m, args) => {

    try {
        if (!m.isGroup) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗗𝗗* ◈
┃
┃❌ *𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬*
┃➽ This command can only be used in groups.
┃
┗▣`);
        }

        const targets = getTargets(m, args);

        if (!targets.length) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗗𝗗* ◈
┃
┃👥 *𝗨𝗦𝗔𝗚𝗘*
┃➽ .add 2547XXXXXXXX
┃➽ .add @user
┃
┃📌 You can also reply to a
┃message and use *.add*
┃
┗▣`);
        }

        const metadata = await sock.groupMetadata(m.from);

        const existing = new Set(
            metadata.participants.map(p => p.id)
        );

        const toAdd = targets.filter(
            jid => !existing.has(jid)
        );

        if (!toAdd.length) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗗𝗗* ◈
┃
┃ℹ️ *𝗔𝗟𝗥𝗘𝗔𝗗 𝗜𝗡 𝗚𝗥𝗢𝗨𝗣*
┃➽ All selected users are already members.
┃
┗▣`);
        }

        const result = await sock.groupParticipantsUpdate(
            m.from,
            toAdd,
            'add'
        );

        const success = [];
        const failed = [];

        for (let i = 0; i < toAdd.length; i++) {
            if (result?.[i]?.status === '200') {
                success.push(toAdd[i]);
            } else {
                failed.push(toAdd[i]);
            }
        }

        let text = `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗗𝗗* ◈
┃
┃👥 *𝗔𝗗𝗗 𝗥𝗘𝗦𝗨𝗟𝗧*
┃
┃✅ *𝗔𝗗𝗗𝗘𝗗* : ${success.length}
┃❌ *𝗙𝗔𝗜𝗟𝗘𝗗* : ${failed.length}
`;

        if (success.length) {
            text += `┃
┃🟢 *𝗦𝗨𝗖𝗖𝗘𝗦𝗦*
┃➽ ${success.map(j => '@' + j.split('@')[0]).join(', ')}
`;
        }

        if (failed.length) {
            text += `┃
┃🔴 *𝗙𝗔𝗜𝗟𝗘𝗗*
┃➽ ${failed.map(j => '@' + j.split('@')[0]).join(', ')}
`;
        }

        text += `┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`;

        return m.reply(text);

    } catch (error) {
        console.error('[ADD]', error);

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗗𝗗* ◈
┃
┃❌ *𝗔𝗗𝗗 𝗙𝗔𝗜𝗟𝗘𝗗*
┃➽ ${error.message}
┃
┗▣`);
    }
});


// ═════════════════════════════════════════════════════════════
// REMOVE
// ═════════════════════════════════════════════════════════════

cmd({
    pattern: "remove",
    name: "remove",
    category: "Group",
    aliases: ["kick", "rm"],
    description: "Remove members from the group",
    filename: __filename
}, async (sock, m, args) => {

    try {
        if (!m.isGroup) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗥𝗘𝗠𝗢𝗩𝗘* ◈
┃
┃❌ *𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬*
┃➽ This command can only be used in groups.
┃
┗▣`);
        }

        const targets = getTargets(m, args);

        if (!targets.length) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗥𝗘𝗠𝗢𝗩𝗘* ◈
┃
┃👤 *𝗨𝗦𝗔𝗚𝗘*
┃➽ .remove 2547XXXXXXXX
┃➽ .remove @user
┃
┃📌 You can also reply to a
┃message and use *.remove*
┃
┗▣`);
        }

        const metadata = await sock.groupMetadata(m.from);

        const members = new Set(
            metadata.participants.map(p => p.id)
        );

        const toRemove = targets.filter(
            jid => members.has(jid)
        );

        if (!toRemove.length) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗥𝗘𝗠𝗢𝗩𝗘* ◈
┃
┃ℹ️ *𝗡𝗢𝗧 𝗙𝗢𝗨𝗡𝗗*
┃➽ None of the selected users are
┃members of this group.
┃
┗▣`);
        }

        const result = await sock.groupParticipantsUpdate(
            m.from,
            toRemove,
            'remove'
        );

        const success = [];
        const failed = [];

        for (let i = 0; i < toRemove.length; i++) {
            if (result?.[i]?.status === '200') {
                success.push(toRemove[i]);
            } else {
                failed.push(toRemove[i]);
            }
        }

        let text = `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗥𝗘𝗠𝗢𝗩𝗘* ◈
┃
┃👤 *𝗥𝗘𝗠𝗢𝗩𝗘 𝗥𝗘𝗦𝗨𝗟𝗧*
┃
┃✅ *𝗥𝗘𝗠𝗢𝗩𝗘𝗗* : ${success.length}
┃❌ *𝗙𝗔𝗜𝗟𝗘𝗗* : ${failed.length}
`;

        if (success.length) {
            text += `┃
┃🟢 *𝗦𝗨𝗖𝗖𝗘𝗦𝗦*
┃➽ ${success.map(j => '@' + j.split('@')[0]).join(', ')}
`;
        }

        if (failed.length) {
            text += `┃
┃🔴 *𝗙𝗔𝗜𝗟𝗘𝗗*
┃➽ ${failed.map(j => '@' + j.split('@')[0]).join(', ')}
`;
        }

        text += `┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`;

        return m.reply(text);

    } catch (error) {
        console.error('[REMOVE]', error);

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗥𝗘𝗠𝗢𝗩𝗘* ◈
┃
┃❌ *𝗥𝗘𝗠𝗢𝗩𝗘 𝗙𝗔𝗜𝗟𝗘𝗗*
┃➽ ${error.message}
┃
┗▣`);
    }
});
