'use strict';
/**
 * POPKID MENU — vertical box menu, built automatically from the loaded commands.
 *
 *   .menu             every command, one box per category
 *   .menu <category>  only that category   (e.g. .menu admin, .menu downloads)
 *
 * No links anywhere. The picture (optional) is a LOCAL file, never a URL.
 */
const fs = require('fs');
const path = require('path');
const { cmd } = require('../arslan');

// true = send a picture banner (header as caption) before the list (2 messages).
// false = send everything (header + all categories) in ONE text message.
const USE_PICTURE = false;
const MAX_IMAGE_BYTES = 800 * 1024; // bigger pictures make the upload hang -> skipped (or shrunk if sharp exists)
const IMAGE_TIMEOUT_MS = 15000;     // never let a stuck upload block the menu text
const MAX_MSG = 60000;              // keep full menu in ONE text message unless massive

/* ───────────── categories ───────────── */
const CATS = {
    general:   ['🏠', 'GENERAL'],
    info:      ['ℹ️', 'INFO'],
    downloads: ['📥', 'DOWNLOADS'],
    search:    ['🔍', 'SEARCH'],
    ai:        ['🤖', 'AI'],
    tools:     ['🛠️', 'TOOLS'],
    ephoto360: ['🎨', 'LOGO MAKER'],
    fun:       ['🎉', 'FUN'],
    sports:    ['⚽', 'SPORTS'],
    group:     ['👥', 'GROUP'],
    status:    ['📡', 'STATUS'],
    channel:   ['📢', 'CHANNEL'],
    admin:     ['🛡️', 'ADMIN'],
    owner:     ['👑', 'OWNER'],
    settings:  ['⚙️', 'SETTINGS']
};
const ORDER = Object.keys(CATS);
const SAME = {
    download: 'downloads', downloader: 'downloads', downloaders: 'downloads', dl: 'downloads',
    tool: 'tools', utility: 'tools', utilities: 'tools',
    logo: 'ephoto360', logos: 'ephoto360', ephoto: 'ephoto360', textpro: 'ephoto360',
    game: 'fun', games: 'fun', groups: 'group', misc: 'general', main: 'general'
};
const keyOf = (s) => {
    const k = String(s || 'general').toLowerCase().replace(/[^a-z0-9]/g, '') || 'general';
    return SAME[k] || k;
};

/* Commands answered directly by index.js (they never call cmd(), so they are listed here). */
const NATIVE = [
    ['warn', 'admin'], ['resetwarn', 'admin'],
    ['anticall', 'owner'], ['antispam', 'owner'], ['broadcast', 'owner'], ['backup', 'owner'], ['restore', 'owner']
];

/* ───────────── small helpers ───────────── */
const SMALL = { a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ғ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 's', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ' };
const sc = (s) => String(s).toLowerCase().split('').map(c => SMALL[c] || c).join('');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after ' + ms + 'ms')), ms))
]);

function clock() {
    const tz = global.timezone || 'Africa/Nairobi';
    const now = new Date();
    try {
        return {
            date: now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: tz }),
            time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: tz }),
            hour: Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(now)) % 24
        };
    } catch {
        return { date: now.toDateString(), time: now.toLocaleTimeString(), hour: now.getHours() };
    }
}

const greet = (h) => h >= 5 && h < 12 ? '🌅 Good morning' : h >= 12 && h < 17 ? '☀️ Good afternoon' : h >= 17 && h < 21 ? '🌇 Good evening' : '🌙 Good night';

function uptimeText() {
    const s = Math.floor(process.uptime());
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return `${d ? d + 'd ' : ''}${h}h ${m}m`;
}

/** args may be an array, a string, or undefined depending on the framework */
function normalizeArgs(args) {
    if (Array.isArray(args)) return args.map(String).filter(Boolean);
    if (typeof args === 'string') return args.trim().split(/\s+/).filter(Boolean);
    return [];
}

/** send text safely: m.reply first, sock.sendMessage as fallback */
async function sendText(sock, m, text) {
    try {
        return await m.reply(text);
    } catch (err) {
        console.error('[MENU] m.reply failed, trying sendMessage:', err && err.message);
        const jid = m.chat || m.from || (m.key && m.key.remoteJid);
        if (!jid) throw err;
        return sock.sendMessage(jid, { text }, { quoted: m });
    }
}

/* ───────────── read the loaded commands ───────────── */
function collect() {
    const groups = {};
    const seen = new Set();
    const add = (name, label) => {
        if (seen.has(name)) return;
        seen.add(name);
        const k = (global.settingsMenuNames && global.settingsMenuNames.has(name)) ? 'settings' : keyOf(label);
        (groups[k] = groups[k] || []).push(name);
    };

    let disabled = [];
    try {
        const d = require('../lib/settings').list('disabled');
        if (Array.isArray(d)) disabled = d;
    } catch { /* optional */ }

    const plugins = global.plugins instanceof Map ? [...global.plugins.values()]
        : Array.isArray(global.plugins) ? global.plugins
        : (global.plugins && typeof global.plugins === 'object') ? Object.values(global.plugins) : [];

    for (const p of plugins) {
        if (!p || typeof p.name !== 'string' || !p.name || p.hidden || p.name.startsWith('__') || disabled.includes(p.name)) continue;
        add(p.name, p.category);
    }
    for (const [name, cat] of NATIVE) if (!disabled.includes(name)) add(name, cat);

    const keys = [...ORDER.filter(k => groups[k]), ...Object.keys(groups).filter(k => !ORDER.includes(k)).sort()];
    return { groups, keys, total: seen.size };
}

/* ───────────── building the text ───────────── */
const LINE = '══════════════════⊷';

function headerBox(m, total, categories) {
    const c = clock();
    const mode = global.botMode === 'private' ? 'Private' : 'Public';
    const ram = (process.memoryUsage().rss / 1048576).toFixed(0);
    return [
        `╭${LINE}`,
        `║   ✨ *${'𝗣𝗢𝗣𝗞𝗜𝗗-𝗠𝗗'}* ✨`,
        `╠${LINE}`,
        `║ ${greet(c.hour)}, *${(m && m.pushName) || 'User'}*`,
        `╠${LINE}`,
        `║ 👑 *${sc('owner')}:* ${global.ownerName || 'POPKID'}`,
        `║ 🚀 *${sc('commands')}:* ${total}`,
        `║ 📂 *${sc('categories')}:* ${categories}`,
        `║ 🔑 *${sc('prefix')}:* [ ${global.BOT_PREFIX || '.'} ]`,
        `║ 🌐 *${sc('mode')}:* ${mode}`,
        `║ ⏳ *${sc('uptime')}:* ${uptimeText()}`,
        `║ 📅 *${sc('date')}:* ${c.date}`,
        `║ ⌚ *${sc('time')}:* ${c.time}`,
        `║ 📊 *${sc('ram')}:* ${ram}ᴍʙ`,
        `╰${LINE}`
    ].join('\n');
}

function categoryBox(key, names) {
    const [emoji, title] = CATS[key] || ['💠', key.toUpperCase()];
    const p = global.BOT_PREFIX || '.';
    return [
        `╔${LINE}`,
        `║ ${emoji}  *${title}*  ‹${names.length}›`,
        `╠${LINE}`,
        ...names.slice().sort().map(n => `║ ◈ ${p}${n}`),
        `╚${LINE}`
    ].join('\n');
}

/** join boxes into messages that stay under the size limit (oversized single boxes are split by line) */
function pack(blocks) {
    const pieces = [];
    for (const b of blocks) {
        if (b.length <= MAX_MSG) { pieces.push(b); continue; }
        let cur = '';
        for (const line of b.split('\n')) {
            if (cur && cur.length + 1 + line.length > MAX_MSG) { pieces.push(cur); cur = line; }
            else cur = cur ? `${cur}\n${line}` : line;
        }
        if (cur) pieces.push(cur);
    }
    const out = [];
    let cur = '';
    for (const b of pieces) {
        if (cur && cur.length + 1 + b.length > MAX_MSG) { out.push(cur); cur = b; }
        else cur = cur ? `${cur}\n${b}` : b;
    }
    if (cur) out.push(cur);
    return out;
}

/** local picture only — never a link. Oversized pictures are shrunk with sharp if present, else skipped. */
async function localPicture() {
    const candidates = [
        global.menuImage,
        path.join(__dirname, '..', 'popkid.jpg'),
        path.join(__dirname, '..', 'data', 'menu-image.jpg'),
        path.join(__dirname, '..', 'data', 'menu-default.jpg')
    ];

    for (const f of candidates) {
        try {
            if (!f || typeof f !== 'string' || /^https?:\/\//i.test(f) || !fs.existsSync(f)) continue;
            let buf = fs.readFileSync(f);
            if (buf.length > MAX_IMAGE_BYTES) {
                try {
                    const sharp = require('sharp');
                    buf = await sharp(buf).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
                } catch {
                    console.error(`[MENU] ${path.basename(f)} is ${(buf.length / 1024) | 0}KB (> limit) and sharp is not installed — shrink it by hand`);
                    continue;
                }
            }
            return buf;
        } catch { /* try the next one */ }
    }
    return null;
}

/* ───────────── the command ───────────── */
cmd({
    pattern: 'menu',
    name: 'menu',
    alias: ['help', 'list', 'commands', 'cmds'],
    category: 'General',
    desc: 'Show all commands',
    hidden: true,
    filename: __filename
}, async (sock, m, args) => {
    try {
        const a = normalizeArgs(args);
        const { groups, keys, total } = collect();
        const p = global.BOT_PREFIX || '.';

        // .menu <category>
        const want = a[0] ? keyOf(a[0]) : null;
        const shown = want ? keys.filter(k => k === want) : keys;
        if (!shown.length) {
            const list = keys.map(k => (CATS[k] ? CATS[k][1] : k.toUpperCase()).toLowerCase()).join(', ');
            return await sendText(sock, m, `❌ No category called *${a[0]}*\n\n📂 ${list}\n\nTry ${p}menu`);
        }

        const head = headerBox(m, total, keys.length);
        const footer = `\n💡 ${sc('tip')}: ${p}menu <category>\n\n*© 𝟤𝟢𝟤𝟨 ᴘᴏᴘᴋɪᴅ ᴋᴇɴʏᴀ* 🇰🇪`;
        const boxes = shown.map(k => categoryBox(k, groups[k]));

        let blocks = [head, ...boxes];
        if (USE_PICTURE && !want) {
            const img = await localPicture();
            if (img) {
                try {
                    await withTimeout(Promise.resolve(m.reply({ image: img, caption: head })), IMAGE_TIMEOUT_MS);
                    blocks = boxes;
                } catch (err) {
                    console.error('[MENU] picture failed, sending text only:', err && err.message);
                }
            }
        }

        const texts = pack(blocks);
        texts[texts.length - 1] += `\n${footer}`;
        for (let i = 0; i < texts.length; i++) {
            if (i) await sleep(400);
            await sendText(sock, m, texts[i]);
        }
    } catch (err) {
        console.error('[MENU] error:', err);
        try { await m.reply('❌ Could not build the menu.'); } catch { /* nothing left to try */ }
    }
});
