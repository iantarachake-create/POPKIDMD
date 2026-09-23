const { cmd } = require('../arslan');

cmd({
    pattern: "ping",
    name: 'ping',
    category: 'General',
    aliases: ['p', 'pong'],
    description: 'Check bot response time',
    filename: __filename
}, async (sock, m, args) => {
    const start = Date.now();
    const sent = await m.reply('Pinging...');
    const latency = Date.now() - start;

    await sock.sendMessage(m.from, {
        text: `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗜𝗡𝗚* ◈
┃
┃🏓 *𝗣𝗢𝗡𝗚!* 
┃
┃➽ *𝗟𝗔𝗧𝗘𝗡𝗖𝗬* : ${latency}ms
┃➽ *𝗦𝗧𝗔𝗧𝗨𝗦* : 𝗢𝗡𝗟𝗜𝗡𝗘
┃
┗▣`,
        edit: sent.key
    });
});
