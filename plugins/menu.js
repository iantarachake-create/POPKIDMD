'use strict';
/**
 * Simple POPKID menu: one text reply, built automatically from the loaded commands.
 *   .menu             every command, grouped by category
 *   .menu <category>  just that category
 */
const { cmd } = require('../arslan');

const ORDER = ['general', 'info', 'downloads', 'search', 'ai', 'tools', 'ephoto360', 'fun', 'sports', 'group', 'status', 'channel', 'admin', 'owner', 'settings'];
const ALIAS = { downloader: 'downloads', downloaders: 'downloads', download: 'downloads', tool: 'tools', utility: 'tools' };

const key = (s) => {
    const k = String(s || 'general').toLowerCase().replace(/[^a-z0-9]/g, '') || 'general';
    return ALIAS[k] || k;
};

cmd({
    pattern: 'menu',
    name: 'menu',
    alias: ['help', 'commands', 'cmds'],
    category: 'General',
    desc: 'Show all commands',
    hidden: true,
    filename: __filename
}, async (sock, m, args) => {
    const p = global.BOT_PREFIX || '.';

    // collect every visible command, grouped by category
    const groups = {};
    const seen = new Set();
    for (const plugin of (global.plugins instanceof Map ? global.plugins.values() : [])) {
        if (!plugin || !plugin.name || plugin.hidden || plugin.name.startsWith('__') || seen.has(plugin.name)) continue;
        seen.add(plugin.name);
        const k = (global.settingsMenuNames && global.settingsMenuNames.has(plugin.name)) ? 'settings' : key(plugin.category);
        (groups[k] = groups[k] || []).push(plugin.name);
    }

    const want = args[0] ? key(args[0]) : null;
    const cats = [...ORDER.filter(c => groups[c]), ...Object.keys(groups).filter(c => !ORDER.includes(c)).sort()]
        .filter(c => !want || c === want);

    if (!cats.length) return m.reply(`❌ No category "${args[0]}". Try ${p}menu`);

    const up = process.uptime();
    const header =
        `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗗* ◈\n` +
        `┃ *ᴏᴡɴᴇʀ* : ${global.ownerName || 'POPKID'}\n` +
        `┃ *ᴜsᴇʀ* : ${m.pushName || 'User'}\n` +
        `┃ *ᴄᴏᴍᴍᴀɴᴅs* : ${seen.size}\n` +
        `┃ *ᴜᴘᴛɪᴍᴇ* : ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m\n` +
        `┃ *ᴘʀᴇғɪx* : [ ${p} ]\n` +
        `┗▣`;

    const boxes = cats.map(c =>
        `┏▣ ◈ *${c.toUpperCase()}* ◈\n` +
        groups[c].sort().map(n => `┃➽ ${p}${n}`).join('\n') +
        `\n┗▣`);

    await m.reply([header, ...boxes].join('\n\n') + '\n\n*© 𝗣𝗢𝗣𝗞𝗜𝗗*');
});
