'use strict';

const {
    setAntilink,
    getAntilink,
    removeAntilink
} = require('../lib/antilink');

const { cmd } = require('../arslan');

cmd({
    pattern: "antilink",
    name: 'antilink',
    aliases: ['alink', 'linkblock'],
    category: 'Admin',
    description: 'Prevent users from sending links in the group',
    filename: __filename
}, async (sock, m, args) => {

    const chatId = m.from;

    if (!m.isGroup) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞* ◈
┃
┃❌ *𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬*
┃
┃➽ This command can only
┃   be used in groups.
┃
┗▣`);
    }

    if (!m.isAdmin && !m.isOwner) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞* ◈
┃
┃❌ *𝗔𝗖𝗖𝗘𝗦𝗦 𝗗𝗘𝗡𝗜𝗘𝗗*
┃
┃➽ Only group admins
┃   or the bot owner can
┃   use this command.
┃
┗▣`);
    }

    const action = (args[0] || '').toLowerCase();

    if (!action) {
        const config = await getAntilink(chatId);

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞* ◈
┃
┃🔗 *𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞 𝗦𝗘𝗧𝗨𝗣*
┃
┃📊 *STATUS* : ${config?.enabled ? '🟢 ENABLED' : '🔴 DISABLED'}
┃⚙️ *ACTION* : ${config?.action || 'Not set'}
┃
┃📌 *𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦*
┃➽ .antilink on
┃➽ .antilink off
┃➽ .antilink set delete
┃➽ .antilink set kick
┃➽ .antilink set warn
┃➽ .antilink status
┃
┃🛡️ *𝗣𝗥𝗢𝗧𝗘𝗖𝗧𝗘𝗗 𝗟𝗜𝗡𝗞𝗦*
┃➽ WhatsApp Groups
┃➽ WhatsApp Channels
┃➽ Telegram
┃➽ Other links
┃
┃👑 *𝗘𝗫𝗘𝗠𝗣𝗧*
┃➽ Group Admins
┃➽ Bot Owner
┃
┗▣`);
    }

    switch (action) {

        case 'on': {
            const existingConfig = await getAntilink(chatId);

            if (existingConfig?.enabled) {
                return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞* ◈
┃
┃⚠️ *𝗔𝗟𝗥𝗘𝗔𝗗𝗬 𝗘𝗡𝗔𝗕𝗟𝗘𝗗*
┃
┃➽ Antilink is already
┃   enabled in this group.
┃
┗▣`);
            }

            const result = await setAntilink(chatId, 'delete');

            return m.reply(
                result
                    ? `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞* ◈
┃
┃✅ *𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞 𝗘𝗡𝗔𝗕𝗟𝗘𝗗*
┃
┃⚙️ *DEFAULT ACTION*
┃➽ Delete link messages
┃
┃🛡️ *𝗘𝗫𝗘𝗠𝗣𝗧*
┃➽ Admins
┃➽ Owner
┃
┗▣`
                    : `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞* ◈
┃
┃❌ *𝗘𝗡𝗔𝗕𝗟𝗘 𝗙𝗔𝗜𝗟𝗘𝗗*
┃
┃➽ Failed to enable
┃   antilink.
┃
┗▣`
            );
        }

        case 'off': {
            await removeAntilink(chatId);

            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞* ◈
┃
┃🔴 *𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞 𝗗𝗜𝗦𝗔𝗕𝗟𝗘𝗗*
┃
┃➽ Users can now send
┃   links freely.
┃
┗▣`);
        }

        case 'set': {
            if (args.length < 2) {
                return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞* ◈
┃
┃❌ *𝗔𝗖𝗧𝗜𝗢𝗡 𝗥𝗘𝗤𝗨𝗜𝗥𝗘𝗗*
┃
┃📌 *𝗨𝗦𝗔𝗚𝗘*
┃➽ .antilink set delete
┃➽ .antilink set kick
┃➽ .antilink set warn
┃
┗▣`);
            }

            const setAction = args[1].toLowerCase();

            if (!['delete', 'kick', 'warn'].includes(setAction)) {
                return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞* ◈
┃
┃❌ *𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗔𝗖𝗧𝗜𝗢𝗡*
┃
┃➽ Choose:
┃   • delete
┃   • kick
┃   • warn
┃
┗▣`);
            }

            const setResult = await setAntilink(
                chatId,
                setAction
            );

            const actionDescriptions = {
                delete: 'Delete link messages and warn users',
                kick: 'Delete messages and remove users',
                warn: 'Only send warning messages'
            };

            return m.reply(
                setResult
                    ? `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞* ◈
┃
┃✅ *𝗔𝗖𝗧𝗜𝗢𝗡 𝗨𝗣𝗗𝗔𝗧𝗘𝗗*
┃
┃⚙️ *ACTION* : ${setAction}
┃
┃➽ ${actionDescriptions[setAction]}
┃
┃🛡️ *𝗘𝗫𝗘𝗠𝗣𝗧*
┃➽ Admins
┃➽ Owner
┃
┗▣`
                    : `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞* ◈
┃
┃❌ *𝗨𝗣𝗗𝗔𝗧𝗘 𝗙𝗔𝗜𝗟𝗘𝗗*
┃
┃➽ Failed to set the
┃   antilink action.
┃
┗▣`
            );
        }

        case 'status':
        case 'get': {
            const status = await getAntilink(chatId);

            let behaviorNote = '';

            if (status?.action === 'delete') {
                behaviorNote =
                    '┃➽ Message is deleted\n┃➽ User gets warning';
            } else if (status?.action === 'kick') {
                behaviorNote =
                    '┃➽ Message is deleted\n┃➽ User is removed';
            } else if (status?.action === 'warn') {
                behaviorNote =
                    '┃➽ User gets warning\n┃➽ Message stays';
            } else {
                behaviorNote =
                    '┃➽ No action configured';
            }

            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞* ◈
┃
┃📊 *𝗦𝗧𝗔𝗧𝗨𝗦*
┃➽ ${status?.enabled ? '🟢 ENABLED' : '🔴 DISABLED'}
┃
┃⚙️ *𝗔𝗖𝗧𝗜𝗢𝗡*
┃➽ ${status?.action || 'Not set'}
┃
┃🚨 *𝗪𝗛𝗘𝗡 𝗟𝗜𝗡𝗞 𝗜𝗦 𝗗𝗘𝗧𝗘𝗖𝗧𝗘𝗗*
${behaviorNote}
┃
┃🛡️ *𝗘𝗫𝗘𝗠𝗣𝗧*
┃➽ Admins
┃➽ Owner
┃
┗▣`);
        }

        default:
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞* ◈
┃
┃❌ *𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗖𝗢𝗠𝗠𝗔𝗡𝗗*
┃
┃➽ Use .antilink to view
┃   all available options.
┃
┗▣`);
    }
});
