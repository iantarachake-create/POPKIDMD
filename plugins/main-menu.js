const axios = require('axios');
const fs = require('fs');

const { cmd } = require('../arslan');

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
    
    const time = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: true,
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
    
    const CATEGORY_ICONS = {
        General: '📜',
        Downloaders: '💼',
        Tools: '🛠️',
        AI: '🧠',
        Fun: '🎉',
        Group: '👥',
        Status: '📡',
        Channel: '📢',
        Admin: '👑',
        Ephoto360: '🎨',
        Settings: '⚙️'
    };

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

            const category = (global.settingsMenuNames && global.settingsMenuNames.has(plugin.name)) ? 'Settings' : (plugin.category || 'General');
            
            if (!grouped[category]) grouped[category] = [];
            grouped[category].push(`${prefix}${plugin.name}`);
        }
    }

    const allCategories = [
        ...CATEGORY_ORDER.filter(c => grouped[c]),
        ...Object.keys(grouped).filter(c => !CATEGORY_ORDER.includes(c))
    ];

    const menuStyle = Number(global.menuStyle) || 1;
    const commandSections = allCategories.map(category => {
        const icon = CATEGORY_ICONS[category] || '📂';
        if (category === 'Settings') grouped[category].sort();
        if (menuStyle === 3) {
            return `${icon} *${category.toUpperCase()}*\n${grouped[category].join(' • ')}`;
        }
        const lines = grouped[category]
            .map(l => `┃➽ ${l}`)
            .join('\n');

        return `${TOP} ◈ *${category.toUpperCase()} MENU* ◈
${lines}
${BOT}`;
    }).join('\n\n');

    const menuText = `
${TOP} ◈ *${(global.botName && global.botName !== 'POPKID') ? global.botName : '𝗣𝗢𝗣𝗞𝗜𝗗'}* ◈
${MID} *ᴏᴡɴᴇʀ* : ${botOwner}
${MID} *ᴜsᴇʀ* : ${user}
${MID} *ᴘʟᴜɢɪɴs* : ${totalPlugins}
${MID} *ᴜᴘᴛɪᴍᴇ* : ${uptimeStr}
${MID} *ᴅᴀᴛᴇ* : ${date}
${MID} *ʀᴀᴍ* : ${ramStr}
${MID} *ᴘʀᴇғɪx* : [ ${prefix} ]
${BOT}

${commandSections}

*© 𝗣𝗢𝗣𝗞𝗜𝗗*
`.trim();

    try {
        const media = menuStyle === 2 ? null : await require('../lib/menuMedia').pickMenuMedia();
        if (!media) return await m.reply(menuText);

        const ctxInfo = {
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363426692424154@newsletter',
                newsletterName: '𝗣𝗢𝗣𝗞𝗜𝗗',
                serverMessageId: 1
            }
        };

        if (media.kind === 'video') {
            await sock.sendMessage(m.from, { video: media.buffer, gifPlayback: true, caption: menuText, contextInfo: ctxInfo }, { quoted: m.raw });
        } else {
            await m.reply(media.buffer, { caption: menuText, contextInfo: ctxInfo });
        }
    } catch (err) {    
        console.error('Menu image error, falling back to text:', err.message);
        try {
            await m.reply(menuText);
        } catch (err2) {
            console.error('Menu fallback error:', err2.message);
        }
    }    
});
