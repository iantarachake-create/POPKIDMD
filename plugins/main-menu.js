const axios = require('axios');
const fs = require('fs');

const { cmd } = require('../arslan');

// WhatsApp rejects image captions that are too long. Anything that does not fit in the
// picture's caption continues straight after it in the same style, so every command is listed.
const MAX_CAPTION = 3000;
const MAX_TEXT = 3800;

cmd({
    pattern: "menu",
    name: 'menu',
    hidden: true,
    description: 'Show available bot commands',
    aliases: ['help', 'cmdlist', 'commands'],
    filename: __filename
}, async (sock, m) => {    
    const prefix = global.BOT_PREFIX || '.';    
    
    const now = new Date();
    
    const date = now.toLocaleDateString('en-GB', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric',
        timeZone: global.timezone || 'Africa/Accra'
    });
    
    const botOwner = global.ownerName || 'POPKID';
    
    const user = m.pushName || m.sender?.split('@')[0] || 'User';

    const uptimeSec = process.uptime();
    const uh = Math.floor(uptimeSec / 3600);
    const um = Math.floor((uptimeSec % 3600) / 60);
    const us = Math.floor(uptimeSec % 60);
    const uptimeStr = `${uh}h ${um}m ${us}s`;

    const ramStr = `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)}MB`;

    // POPKID MENU STYLE
    const TOP = `┏▣ ◈`;
    const MID = `┃`;
    const BOT = `┗▣`;

    // Auto-build the command list from whatever plugins are actually loaded,
    // so new plugins show up here automatically without editing this file.
    const CATEGORY_ORDER = ['General', 'Downloaders', 'Tools', 'AI', 'Fun', 'Ephoto360', 'Group', 'Status', 'Channel', 'Admin', 'Settings'];

    const grouped = {};
    const seen = new Set();
    let totalPlugins = 0;

    if (global.plugins instanceof Map) {
        const uniquePlugins = new Set(global.plugins.values());
        totalPlugins = uniquePlugins.size;

        for (const plugin of global.plugins.values()) {
            if (!plugin || !plugin.name) continue;
            if (plugin.hidden) continue;
            if (seen.has(plugin.name)) continue;
            seen.add(plugin.name);

            // commands from the Settings menu are always shown under SETTINGS
            const category = (global.settingsMenuNames && global.settingsMenuNames.has(plugin.name))
                ? 'Settings'
                : (plugin.category || 'General');
            
            if (!grouped[category]) grouped[category] = [];
            grouped[category].push(`${prefix}${plugin.name}`);
        }
    }

    const allCategories = [
        ...CATEGORY_ORDER.filter(c => grouped[c]),
        ...Object.keys(grouped).filter(c => !CATEGORY_ORDER.includes(c))
    ];

    const menuStyle = Number(global.menuStyle) || 1;

    // One box per category (a very long category is continued in a second box, same look).
    const buildBlocks = (category, maxLen) => {
        const title = category.toUpperCase();
        const cmds = category === 'Settings' ? grouped[category].slice().sort() : grouped[category];

        if (menuStyle === 3) {
            return [`*${title}*\n${cmds.join(' • ')}`];
        }

        const blocks = [];
        let lines = [];
        const open = n => `${TOP} ◈ *${title} MENU${n > 1 ? ` (${n})` : ''}* ◈`;
        const render = n => `${open(n)}\n${lines.join('\n')}\n${BOT}`;

        let part = 1;
        for (const c of cmds) {
            const line = `┃➽ ${c}`;
            if (lines.length && (render(part).length + line.length + 1) > maxLen) {
                blocks.push(render(part));
                lines = [];
                part++;
            }
            lines.push(line);
        }
        if (lines.length) blocks.push(render(part));
        return blocks;
    };

    const blocks = allCategories.flatMap(c => buildBlocks(c, MAX_TEXT));

    const headerText = `
${TOP} ◈ *${(global.botName && global.botName !== 'POPKID') ? global.botName : '𝗣𝗢𝗣𝗞𝗜𝗗'}* ◈
${MID} *ᴏᴡɴᴇʀ* : ${botOwner}
${MID} *ᴜsᴇʀ* : ${user}
${MID} *ᴘʟᴜɢɪɴs* : ${totalPlugins}
${MID} *ᴜᴘᴛɪᴍᴇ* : ${uptimeStr}
${MID} *ᴅᴀᴛᴇ* : ${date}
${MID} *ʀᴀᴍ* : ${ramStr}
${MID} *ᴘʀᴇғɪx* : [ ${prefix} ]
${BOT}`.trim();

    const footer = '*© 𝗣𝗢𝗣𝗞𝗜𝗗*';

    // Fill the first message (the picture's caption) as far as the safe limit allows,
    // then pack whatever is left into follow-up text messages.
    let caption = headerText;
    let idx = 0;
    const captionLimit = menuStyle === 2 ? MAX_TEXT : MAX_CAPTION;
    while (idx < blocks.length && (caption.length + 2 + blocks[idx].length) <= captionLimit - footer.length - 2) {
        caption += `\n\n${blocks[idx++]}`;
    }

    const rest = [];
    let current = '';
    for (; idx < blocks.length; idx++) {
        if (current && (current.length + 2 + blocks[idx].length) > MAX_TEXT) {
            rest.push(current);
            current = blocks[idx];
        } else {
            current = current ? `${current}\n\n${blocks[idx]}` : blocks[idx];
        }
    }
    if (current) rest.push(current);

    // footer goes on the very last message
    if (rest.length) rest[rest.length - 1] += `\n\n${footer}`;
    else caption += `\n\n${footer}`;

    let firstSent = false;

    if (menuStyle !== 2) {
        try {
            // picture / video: a rotation added with .addmenuimage / .addmenuvideo, else global.menuImage
            // (a remote URL, or a local file saved by .setmenuimg)
            let media = null;
            try { media = await require('../lib/menuMedia').pickMenuMedia(); } catch (e) { console.error('menuMedia error:', e.message); }

            if (!media && global.menuImage) {
                const buffer = /^https?:\/\//i.test(global.menuImage)
                    ? (await axios.get(global.menuImage, { responseType: 'arraybuffer', timeout: 8000 })).data
                    : fs.readFileSync(global.menuImage);
                media = { kind: 'image', buffer };
            }
            if (!media) throw new Error('no menu image or video could be loaded');

            const contextInfo = {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363426692424154@newsletter',
                    newsletterName: '😷popkid😷',
                    serverMessageId: 1
                }
            };

            if (media.kind === 'video') {
                await sock.sendMessage(m.from, { video: media.buffer, gifPlayback: true, caption, contextInfo }, { quoted: m.raw });
            } else {
                await m.reply(media.buffer, { caption, contextInfo });
            }
            firstSent = true;
        } catch (err) {    
            console.error('Menu image error, falling back to text:', err.message);
        }
    }

    try {
        if (!firstSent) await m.reply(caption);
        for (const text of rest) {
            await new Promise(r => setTimeout(r, 500));
            await m.reply(text);
        }
    } catch (err2) {
        console.error('Menu text error:', err2.message);
    }
});
