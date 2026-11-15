'use strict';
/**
 * .autostatus — same command layout as KnightBot's:
 *   .autostatus            show settings
 *   .autostatus on|off     auto view statuses
 *   .autostatus react on|off   auto react to statuses
 * Uses the bot's existing persisted settings (autoviewstatus / autoreactstatus),
 * which index.js reads, so it stays in sync with .autoviewstatus / .autoreactstatus.
 */
const { cmd } = require('../arslan');
const settings = require('../lib/settings');
const { P, isOwner, box, parseOnOff } = require('../lib/cmdutil');

cmd({
    pattern: 'autostatus',
    name: 'autostatus',
    category: 'Settings',
    aliases: ['autostatusview2'],
    description: 'Auto view / react to statuses: .autostatus on|off, .autostatus react on|off',
    filename: __filename
}, async (sock, m, args) => {
    if (!(isOwner(m) || m.raw?.key?.fromMe)) return m.reply('❌ This command can only be used by the owner!');

    const view = !!settings.get('autoviewstatus');
    const react = !!settings.get('autoreactstatus');
    const sub = String(args[0] || '').toLowerCase();

    if (!sub) {
        return m.reply(box('𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗨𝗧𝗢 𝗦𝗧𝗔𝗧𝗨𝗦', [
            `➽ 📱 Auto Status View: ${view ? '✅ enabled' : '❌ disabled'}`,
            `➽ 💫 Status Reactions: ${react ? '✅ enabled' : '❌ disabled'}`,
            '',
            `➽ ${P()}autostatus on / off`,
            `➽ ${P()}autostatus react on / off`
        ]));
    }

    if (sub === 'react') {
        const v = parseOnOff(args[1]);
        if (v === null) return m.reply(`❌ Please specify on/off for reactions!\nUse: ${P()}autostatus react on/off`);
        settings.set('autoreactstatus', v);
        return m.reply(v
            ? '💫 Status reactions have been enabled!\nBot will now react to status updates.'
            : '❌ Status reactions have been disabled!\nBot will no longer react to status updates.');
    }

    const v = parseOnOff(sub);
    if (v === null) {
        return m.reply(`❌ Invalid command! Use:\n${P()}autostatus on/off - Enable/disable auto status view\n${P()}autostatus react on/off - Enable/disable status reactions`);
    }
    settings.set('autoviewstatus', v);
    return m.reply(v
        ? '✅ Auto status view has been enabled!\nBot will now automatically view all contact statuses.'
        : '❌ Auto status view has been disabled!\nBot will no longer automatically view statuses.');
});
