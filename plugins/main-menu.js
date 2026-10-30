const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { cmd } = require('../arslan');

let settings = null;
try { settings = require('../lib/settings'); } catch (_) { /* rotation list is optional */ }

// WhatsApp rejects image captions that are too long. Anything that does not fit in the
// picture's caption continues straight after it in the same style, so every command is listed.
const MAX_CAPTION = 3000;
const MAX_TEXT = 3800;

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'menu-cache.jpg');     // last remote image that worked
const DEFAULT_FILE = path.join(DATA_DIR, 'menu-default.jpg'); // bundled picture, always available
const FETCH_TIMEOUT = 10000;   // per remote image
const BUDGET_MS = 25000;       // total time allowed to find a picture
const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

// ---------- menu picture / video ----------

// Look at the first bytes so an HTML error page is never mistaken for a picture
function sniff(b) {
    if (!b || b.length < 12) return null;
    if (b[0] === 0xFF && b[1] === 0xD8) return 'image';                                    // jpeg
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image';  // png
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image';
    if (b.toString('ascii', 0, 3) === 'GIF') return 'image';
    if (b.toString('ascii', 4, 8) === 'ftyp') return 'video';                              // mp4 / mov
    if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'video';  // webm / mkv
    return null;
}

// Remote files are kept in memory for a while so every .menu doesn't download them again
const memCache = new Map(); // src -> { buffer, kind, expires }
const MEM_TTL = 30 * 60 * 1000;

async function loadSource(src, deadline) {
    if (/^https?:\/\//i.test(src)) {
        const hit = memCache.get(src);
        if (hit && hit.expires > Date.now()) return { kind: hit.kind, buffer: hit.buffer, remote: false };

        const timeout = Math.max(3000, Math.min(FETCH_TIMEOUT, deadline - Date.now()));
        const res = await axios.get(src, {
            responseType: 'arraybuffer',
            timeout,
            maxContentLength: 30 * 1024 * 1024,
            headers: { 'User-Agent': UA, Accept: 'image/*,video/*,*/*;q=0.8' }
        });
        const buffer = Buffer.from(res.data);
        const kind = sniff(buffer);
        if (!kind) throw new Error('not a picture or video');

        if (memCache.size >= 8) memCache.delete(memCache.keys().next().value);
        memCache.set(src, { buffer, kind, expires: Date.now() + MEM_TTL });
        return { kind, buffer, remote: true };
    }

    const file = path.isAbsolute(src) ? src : path.join(process.cwd(), src);
    const buffer = fs.readFileSync(file);
    const kind = sniff(buffer);
    if (!kind) throw new Error('not a picture or video');
    return { kind, buffer, remote: false };
}

function candidates() {
    const shuffle = (a) => a.slice().sort(() => Math.random() - 0.5);
    const out = [];
    try {
        if (settings) {
            shuffle(settings.list('menuVideos')).forEach(src => out.push(src));
            shuffle(settings.list('menuImages')).forEach(src => out.push(src));
        }
    } catch (_) { /* ignore */ }
    if (global.menuImage) out.push(global.menuImage);
    out.push(path.join(DATA_DIR, 'menu-image.jpg'), CACHE_FILE, DEFAULT_FILE);
    return [...new Set(out)];
}

/**
 * Picks what the menu shows, trying in this order and skipping anything dead:
 *   1. a random video / image added with .addmenuvideo / .addmenuimage
 *   2. global.menuImage (a link, or a file saved by .setmenuimg)
 *   3. the last picture that downloaded successfully (cache)
 *   4. the picture bundled with the bot (data/menu-default.jpg)
 */
async function pickMenuMedia(skipSrc) {
    const deadline = Date.now() + BUDGET_MS;
    for (const src of candidates()) {
        if (src === skipSrc) continue;
        if (Date.now() > deadline && src !== DEFAULT_FILE) continue;
        try {
            const media = await loadSource(src, deadline);
            if (media.kind === 'video' && media.buffer.length > MAX_VIDEO_BYTES) throw new Error('video too large');
            if (media.remote && media.kind === 'image' && media.buffer.length < 5 * 1024 * 1024) {
                try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(CACHE_FILE, media.buffer); } catch (_) { /* cache is optional */ }
            }
            return { kind: media.kind, buffer: media.buffer, src };
        } catch (e) {
            console.error(`[MENU] picture skipped (${String(src).slice(0, 60)}): ${e.message}`);
        }
    }
    return null;
}

// ---------- the command ----------

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

    let date;
    try {
        date = now.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: global.timezone || 'Africa/Nairobi'
        });
    } catch (_) {
        date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    }

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

    // Fill the first message (the picture's caption) as far as `limit` allows,
    // then pack whatever is left into follow-up text messages.
    const compose = (limit) => {
        let caption = headerText;
        let idx = 0;
        while (idx < blocks.length && (caption.length + 2 + blocks[idx].length) <= limit - footer.length - 2) {
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

        return { caption, rest };
    };

    const sendRest = async (rest) => {
        for (const text of rest) {
            try {
                await new Promise(r => setTimeout(r, 500));
                await m.reply(text);
            } catch (err) {
                console.error('[MENU] text part failed:', err.message);
            }
        }
    };

    const contextInfo = {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363426692424154@newsletter',
            newsletterName: '😷popkid😷',
            serverMessageId: 1
        }
    };

    const sendMedia = (media, caption, ctx) => {
        const opts = { quoted: m.raw || m };
        const content = media.kind === 'video'
            ? { video: media.buffer, gifPlayback: true, caption }
            : { image: media.buffer, caption };
        if (ctx) content.contextInfo = ctx;
        return sock.sendMessage(m.from, content, opts);
    };

    // menu style 2 = text only
    if (menuStyle === 2) {
        const { caption, rest } = compose(MAX_TEXT);
        await m.reply(caption);
        return sendRest(rest);
    }

    // Try the picture, and if WhatsApp refuses it step down gently instead of giving up:
    //   full caption + channel header -> full caption -> short caption -> bundled picture -> plain text
    let media = null;
    try { media = await pickMenuMedia(); } catch (e) { console.error('[MENU] picture error:', e.message); }

    if (media) {
        const full = compose(MAX_CAPTION);
        const short = compose(0);
        const steps = [
            { media, ...full, ctx: contextInfo },
            { media, ...full, ctx: null },
            { media, ...short, ctx: null }
        ];

        for (const step of steps) {
            try {
                await sendMedia(step.media, step.caption, step.ctx);
                return sendRest(step.rest);
            } catch (err) {
                console.error('[MENU] picture send failed, trying a simpler one:', err.message);
            }
        }

        // the chosen file itself may be the problem: use the bundled picture
        try {
            const fallback = await pickMenuMedia(media.src);
            if (fallback) {
                await sendMedia(fallback, short.caption, null);
                return sendRest(short.rest);
            }
        } catch (err) {
            console.error('[MENU] bundled picture failed:', err.message);
        }
    }

    // last resort: the whole menu as text
    try {
        const { caption, rest } = compose(MAX_TEXT);
        await m.reply(caption);
        await sendRest(rest);
    } catch (err2) {
        console.error('[MENU] text error:', err2.message);
    }
});
