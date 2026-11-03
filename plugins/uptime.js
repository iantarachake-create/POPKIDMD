const { cmd } = require('../arslan');

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d}d ${h}h ${m}m ${s}s`;
}

cmd({
    pattern: "uptime",
    name: 'uptime',
    category: 'General',
    aliases: ['up', 'runtime'],
    description: 'Check how long the bot has been running',
    filename: __filename
}, async (sock, m, args) => {
    await sock.sendMessage(m.from, {
        text: `⏱️ Uptime: ${formatUptime(process.uptime())}`
    }, { quoted: m.raw });
});
