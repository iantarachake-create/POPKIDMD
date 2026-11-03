const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { cmd } = require('../arslan');

const ORDER = ['General', 'Downloaders', 'Tools', 'AI', 'Fun', 'Ephoto360', 'Group', 'Status', 'Channel', 'Admin', 'Settings'];
const MAX_CAPTION = 3000;
const FALLBACK_IMAGE = path.join(__dirname, '..', 'data', 'menu-default.jpg');

// menu picture: global.menuImage (link), else the picture bundled with the bot
async function getImage() {
    try {
        if (/^https?:\/\//i.test(global.menuImage || '')) {
            const res = await axios.get(global.menuImage, { responseType: 'arraybuffer', timeout: 5000 });
            return Buffer.from(res.data);
        }
    } catch (_) { /* use the bundled picture */ }
    try { return fs.readFileSync(FALLBACK_IMAGE); } catch (_) { return null; }
}

cmd({
    pattern: 'menu3',
    name: 'menu3',
    hidden: true,
    description: 'Show available bot commands',
    aliases: ['help', 'cmdlist', 'commands'],
    filename: __filename
}, async (sock, m) => {
    const prefix = global.BOT_PREFIX || '.';

    // group every loaded command by category
    const groups = {};
    const seen = new Set();
    for (const p of (global.plugins instanceof Map ? global.plugins.values() : [])) {
        if (!p || !p.name || p.hidden || seen.has(p.name)) continue;
        seen.add(p.name);
        const cat = global.settingsMenuNames?.has(p.name) ? 'Settings' : (p.category || 'General');
        (groups[cat] = groups[cat] || []).push(p.name);
    }
    const cats = [...ORDER.filter(c => groups[c]), ...Object.keys(groups).filter(c => !ORDER.includes(c))];

    const up = process.uptime();
    const header =
        `┏▣ ◈ *${global.botName || 'POPKID'}* ◈\n` +
        `┃ *ᴏᴡɴᴇʀ* : ${global.ownerName || 'POPKID'}\n` +
        `┃ *ᴜsᴇʀ* : ${m.pushName || 'User'}\n` +
        `┃ *ᴄᴏᴍᴍᴀɴᴅs* : ${seen.size}\n` +
        `┃ *ᴜᴘᴛɪᴍᴇ* : ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m\n` +
        `┃ *ᴘʀᴇғɪx* : [ ${prefix} ]\n` +
        `┗▣`;

    const boxes = cats.map(c =>
        `┏▣ ◈ *${c.toUpperCase()}* ◈\n${groups[c].map(n => `┃➽ ${prefix}${n}`).join('\n')}\n┗▣`);

    const text = [header, ...boxes].join('\n\n') + '\n\n*© 𝗣𝗢𝗣𝗞𝗜𝗗*';

    // picture + list in one message; if that is not possible, plain text
    if (text.length <= MAX_CAPTION) {
        const image = await getImage();
        if (image) {
            try { return await sock.sendMessage(m.from, { image, caption: text }, { quoted: m.raw }); }
            catch (err) { console.error('[MENU] picture failed:', err.message); }
        }
    }
    await m.reply(text);
});
