'use strict';

const { cmd } = require('../arslan');

cmd({
    pattern: 'ping',
    name: 'ping',
    alias: ['speed', 'latency'],
    category: 'General',
    desc: 'Check bot speed',
    filename: __filename
}, async (sock, m) => {
    const start = Date.now();
    const sent = await m.reply('⚡ *Pinging...*');
    const speed = Date.now() - start;

    const text = `🏓 *Pong!* ${speed}ms`;
    const jid = m.chat || m.from || (m.key && m.key.remoteJid);

    if (sent && sent.key && jid) {
        await sock.sendMessage(jid, { text, edit: sent.key });
    } else {
        await m.reply(text);
    }
});
