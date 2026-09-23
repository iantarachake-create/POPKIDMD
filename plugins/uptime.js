const { cmd } = require('../arslan');

cmd({
    pattern: "uptime",
    name: 'uptime',
    category: 'General',
    aliases: ['up', 'runtime'],
    description: 'Check bot uptime',
    filename: __filename
}, async (sock, m) => {
    const uptimeSec = process.uptime();

    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = Math.floor(uptimeSec % 60);

    const uptime = `${days}d ${hours}h ${minutes}m ${seconds}s`;

    await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗨𝗣𝗧𝗜𝗠𝗘* ◈
┃
┃⏳ *𝗥𝗨𝗡𝗧𝗜𝗠𝗘*
┃➽ ${uptime}
┃
┃🟢 *𝗦𝗧𝗔𝗧𝗨𝗦* : 𝗢𝗡𝗟𝗜𝗡𝗘
┃
┗▣`);
});
