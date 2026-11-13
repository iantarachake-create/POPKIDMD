const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { cmd } = require('../arslan');

let settings = null;
try { settings = require('../lib/settings'); } catch (_) { /* rotation list is optional */ }

// WhatsApp rejects image captions that are too long. Anything that does not fit in the
// picture's caption continues straight after it in the same style, so every command is listed.
const MAX_CAPTION = 3000;   // longest caption that stays on the picture itself
const MAX_TEXT = 3800;      // only used if a menu is ever too big for one message
const MAX_SINGLE = 20000;   // the whole menu goes out as ONE message up to this size (WhatsApp allows far more)

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'menu-cache.jpg');     // last remote image that worked
const DEFAULT_FILE = path.join(DATA_DIR, 'menu-default.jpg'); // bundled picture, always available
const FETCH_TIMEOUT = 4000;    // per remote image (the menu must stay quick)
const BUDGET_MS = 8000;        // total time allowed to find a picture
const FAIL_TTL = 30 * 60 * 1000; // a link that failed is not retried for this long
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

// Remote files are kept in memory, so after the first load every .menu is instant.
// An old copy keeps being used while a fresh one downloads quietly in the background.
const memCache = new Map();    // src -> { buffer, kind, fetched }
const failed = new Map();      // src -> time until which it is skipped
const refreshing = new Set();
const thumbCache = new Map();  // src -> small jpeg for the preview card
const MEM_TTL = 30 * 60 * 1000;

async function fetchRemote(src, timeout) {
    const res = await axios.get(src, {
        responseType: 'arraybuffer',
        timeout,
        maxContentLength: 30 * 1024 * 1024,
        headers: { 'User-Agent': UA, Accept: 'image/*,video/*,*/*;q=0.8' }
    });
    const buffer = Buffer.from(res.data);
    const kind = sniff(buffer);
    if (!kind) throw new Error('not a picture or video');

    if (!memCache.has(src) && memCache.size >= 20) memCache.delete(memCache.keys().next().value);
    memCache.set(src, { buffer, kind, fetched: Date.now() });
    thumbCache.delete(src);
    failed.delete(src);

    if (kind === 'image' && buffer.length < 5 * 1024 * 1024) {
        try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(CACHE_FILE, buffer); } catch (_) { /* cache is optional */ }
    }
    return { kind, buffer };
}

function refreshInBackground(src) {
    if (refreshing.has(src)) return;
    refreshing.add(src);
    fetchRemote(src, 15000)
        .catch(() => { failed.set(src, Date.now() + FAIL_TTL); })
        .finally(() => refreshing.delete(src));
}

async function loadSource(src, deadline) {
    if (/^https?:\/\//i.test(src)) {
        const hit = memCache.get(src);
        if (hit) {
            if (Date.now() - hit.fetched > MEM_TTL) refreshInBackground(src);
            return { kind: hit.kind, buffer: hit.buffer };
        }
        if ((failed.get(src) || 0) > Date.now()) throw new Error('skipped, it failed recently');

        try {
            const timeout = Math.max(3000, Math.min(FETCH_TIMEOUT, deadline - Date.now()));
            return await fetchRemote(src, timeout);
        } catch (e) {
            failed.set(src, Date.now() + FAIL_TTL);
            throw e;
        }
    }

    const file = path.isAbsolute(src) ? src : path.join(process.cwd(), src);
    const buffer = fs.readFileSync(file);
    const kind = sniff(buffer);
    if (!kind) throw new Error('not a picture or video');
    return { kind, buffer };
}

function candidates(imageOnly) {
    const shuffle = (a) => a.slice().sort(() => Math.random() - 0.5);
    const out = [];
    try {
        if (settings) {
            if (!imageOnly) shuffle(settings.list('menuVideos')).forEach(src => out.push(src));
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
async function pickMenuMedia(skipSrc, imageOnly) {
    const deadline = Date.now() + BUDGET_MS;
    for (const src of candidates(imageOnly)) {
        if (src === skipSrc) continue;
        if (Date.now() > deadline && /^https?:\/\//i.test(src)) continue; // out of time: only instant local files from here
        try {
            const media = await loadSource(src, deadline);
            if (imageOnly && media.kind !== 'image') throw new Error('video skipped');
            if (media.kind === 'video' && media.buffer.length > MAX_VIDEO_BYTES) throw new Error('video too large');
            return { kind: media.kind, buffer: media.buffer, src };
        } catch (e) {
            console.error(`[MENU] picture skipped (${String(src).slice(0, 60)}): ${e.message}`);
        }
    }
    return null;
}

// Download every menu picture shortly after the bot starts, so the first .menu is already instant.
// A failure here is silent and does NOT block the link later (the network may not be ready yet).
setTimeout(() => {
    candidates(false)
        .filter(src => /^https?:\/\//i.test(src))
        .forEach(src => fetchRemote(src, 15000).catch(() => {}));
}, 2000);

// Small copy of the picture for the preview card (sharp if the bot has it, otherwise the file itself)
async function cardThumb(buffer) {
    try {
        const sharp = require('sharp');
        return await sharp(buffer).resize({ width: 640, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    } catch (_) {
        return buffer.length < 300 * 1024 ? buffer : null;
    }
}

// ---------- the command ----------

cmd({
    pattern: "helpmenu",
    name: 'helpmenu',
    hidden: true,
    description: 'Show available bot commands',
    aliases: ['helpmenu', 'helplist', 'helpcommands'],
    filename: __filename
}, async (sock, m) => {
    const t0 = Date.now();
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
    // Support Menu: these commands are always listed together, in this order
    const SUPPORT_COMMANDS = ['popkid', 'poundz', 'helpers', 'whois', 'creator'];
    const CATEGORY_ORDER = ['General', 'Downloaders', 'Tools', 'AI', 'Fun', 'Ephoto360', 'Group', 'Status', 'Channel', 'Admin', 'Settings', 'Support'];

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
            const category = SUPPORT_COMMANDS.includes(plugin.name)
                ? 'Support'
                : (global.settingsMenuNames && global.settingsMenuNames.has(plugin.name))
                ? 'Settings'
                : (plugin.category || 'General');

            if (!grouped[category]) grouped[category] = [];
            grouped[category].push(`${prefix}${plugin.name}`);
        }
    }

    if (grouped['Support']) {
        grouped['Support'].sort((a, b) =>
            SUPPORT_COMMANDS.indexOf(a.slice(prefix.length)) - SUPPORT_COMMANDS.indexOf(b.slice(prefix.length)));
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
                await sock.sendMessage(m.from, { text }, { quoted: m.raw, keepQuote: true });
            } catch (err) {
                console.error('[MENU] text part failed:', err.message);
            }
        }
    };

    // Same channel header as every other bot message (set in config.js)
    const contextInfo = {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: global.channelJid || '120363426692424154@newsletter',
            newsletterName: global.channelName || 'Popkid',
            serverMessageId: -1
        }
    };

    const sendMedia = (media, caption, ctx) => {
        const content = media.kind === 'video'
            ? { video: media.buffer, gifPlayback: true, caption }
            : { image: media.buffer, caption };
        if (ctx) content.contextInfo = ctx;
        return sock.sendMessage(m.from, content, { quoted: m.raw, keepQuote: true });
    };

    // The whole menu as one piece of text; it only continues in a second message if it is bigger than MAX_SINGLE
    const fullText = `${[headerText, ...blocks].join('\n\n')}\n\n${footer}`;
    const chunks = fullText.length <= MAX_SINGLE
        ? [fullText]
        : (({ caption, rest }) => [caption, ...rest])(compose(MAX_TEXT));

    // runs one way of sending; true = it went out, false = try the next way
    const attempt = async (label, fn) => {
        try {
            await fn();
            console.log(`[MENU] sent (${label}) in ${Date.now() - t0}ms`);
            return true;
        } catch (err) {
            console.error(`[MENU] ${label} failed: ${err.message}`);
            return false;
        }
    };

    // Way 1: picture / video with the whole list as its caption (only when the list fits a caption)
    if (menuStyle !== 2 && fullText.length <= MAX_CAPTION) {
        let media = null;
        try { media = await pickMenuMedia(); } catch (e) { console.error('[MENU] picture error:', e.message); }

        if (media) {
            if (await attempt('picture + channel header', () => sendMedia(media, fullText, contextInfo))) return;
            if (await attempt('picture', () => sendMedia(media, fullText, null))) return;

            // the chosen file itself may be the problem: use another picture
            let other = null;
            try { other = await pickMenuMedia(media.src, true); } catch (e) { console.error('[MENU] fallback picture error:', e.message); }
            if (other && await attempt('other picture', () => sendMedia(other, fullText, null))) return;
        }
    }

    // Way 2: a long list as ONE text message with the picture on top as a large preview card
    if (menuStyle !== 2) {
        let card = null;
        try {
            const media = await pickMenuMedia(null, true);
            if (media) {
                let thumbnail = thumbCache.get(media.src);
                if (!thumbnail) {
                    thumbnail = await cardThumb(media.buffer);
                    if (thumbnail) thumbCache.set(media.src, thumbnail);
                }
                if (thumbnail) {
                    card = {
                        title: (global.botName && global.botName !== 'POPKID') ? global.botName : '𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗨𝗟𝗧𝗜𝗗𝗘𝗩𝗜𝗖𝗘',
                        body: `ᴏᴡɴᴇʀ : ${botOwner}  •  ᴘʀᴇғɪx : [ ${prefix} ]`,
                        thumbnail,
                        sourceUrl: global.menuSourceUrl || 'https://popkid.xyz',
                        mediaType: 1,
                        renderLargerThumbnail: true,
                        showAdAttribution: false
                    };
                }
            }
        } catch (e) { console.error('[MENU] card picture error:', e.message); }

        if (card) {
            const ways = [
                ['card + channel header', { ...contextInfo, externalAdReply: card }],
                ['card', { externalAdReply: card }]
            ];
            for (const [label, ctx] of ways) {
                if (await attempt(label, () => sock.sendMessage(m.from, { text: chunks[0], contextInfo: ctx }, { quoted: m.raw, keepQuote: true }))) {
                    return sendRest(chunks.slice(1));
                }
            }
        }
    }

    // Way 3 (also menu style 2): the whole menu as plain text, always works
    try {
        await sock.sendMessage(m.from, { text: chunks[0] }, { quoted: m.raw, keepQuote: true });
        await sendRest(chunks.slice(1));
        console.log(`[MENU] sent (text) in ${Date.now() - t0}ms`);
    } catch (err) {
        console.error('[MENU] text error:', err.message);
    }
});
