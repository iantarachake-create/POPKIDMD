'use strict';
const { cmd } = require('../arslan');
const { sendBtns } = require('../lib/buttons');
const autobio = require('../lib/autobio');

cmd({
    pattern: 'autobio',
    name: 'autobio',
    aliases: ['bio', 'autoabout'],
    category: 'Admin',
    description: 'Live bot bio with uptime and local time',
    filename: __filename
}, async (sock, m, args) => {
    if (!(m.isOwner || m.isDev)) return m.reply('❌ Owner only.');

    const action = (args[0] || '').toLowerCase();

    if (action === 'on' || action === 'off') {
        autobio.setEnabled(sock, action === 'on');
        return m.reply(`${action === 'on' ? '🟢' : '🔴'} Autobio turned ${action.toUpperCase()}.`);
    }

    if (action === 'tz' || action === 'timezone') {
        const tz = args[1];
        if (!tz || !autobio.setTimezone(sock, tz)) {
            return m.reply(`❌ Invalid timezone.\nExample: ${global.BOT_PREFIX}autobio tz Africa/Nairobi`);
        }
        return m.reply(`✅ Autobio timezone set to *${tz}*.`);
    }

    const s = autobio.getSettings();
    return sendBtns(sock, m, {
        title: '𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗨𝗧𝗢𝗕𝗜𝗢',
        text: `📊 *STATUS* : ${s.enabled ? '🟢 ON' : '🔴 OFF'}\n🌍 *TIMEZONE* : ${s.timezone}\n\n` +
              `📝 *PREVIEW*\n${autobio.buildBio()}\n\n` +
              `Change zone: ${global.BOT_PREFIX}autobio tz Africa/Lagos`,
        buttons: [
            { text: '🟢 Turn ON', cmd: 'autobio on' },
            { text: '🔴 Turn OFF', cmd: 'autobio off' }
        ]
    });
});
