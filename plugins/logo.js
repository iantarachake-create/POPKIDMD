'use strict';

const fs = require('fs');
const path = require('path');
const { cmd } = require('../arslan');
const ephoto = require('../lib/ephoto');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   EFFECT TABLE
   name    : the main command
   alias   : extra command names that run the same effect
   urls    : candidate ephoto360 pages, tried in order
   (A dead link can be fixed from WhatsApp with .setephoto — no redeploy.)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const EFFECTS = [
    { name: '1917style',        alias: ['logo1917', '1917'],            urls: ['/1917-style-text-effect-523.html'] },
    { name: 'advancedglow',     alias: [],                              urls: ['/advanced-glow-effects-74.html'] },
    { name: 'americanflag',     alias: [],                              urls: ['/free-online-american-flag-3d-text-effect-generator-725.html'] },
    { name: 'blackpinklogo',    alias: [],                              urls: ['/create-blackpink-logo-online-free-607.html'] },
    { name: 'blackpinkstyle',   alias: [],                              urls: ['/online-blackpink-style-logo-maker-effect-711.html'] },
    { name: 'cartoonstyle',     alias: [],                              urls: ['/create-cartoon-style-graffiti-text-effect-online-668.html'] },
    { name: 'deletingtext',     alias: [],                              urls: ['/create-eraser-deleting-text-effect-online-717.html'] },
    { name: 'dragonball',       alias: [],                              urls: ['/create-dragon-ball-style-text-effects-online-809.html'] },
    { name: 'effectclouds',     alias: [],                              urls: ['/write-text-effect-clouds-in-the-sky-online-619.html'] },
    { name: 'flag3dtext',       alias: [],                              urls: ['/free-online-american-flag-3d-text-effect-generator-725.html'] },
    { name: 'flagtext',         alias: [],                              urls: ['/free-online-american-flag-3d-text-effect-generator-725.html', '/nigeria-3d-flag-text-effect-online-free-753.html'] },
    { name: 'freecreate',       alias: [],                              urls: ['/free-create-a-3d-hologram-text-effect-441.html'] },
    { name: 'galaxy',           alias: [],                              urls: ['/create-galaxy-wallpaper-mobile-online-528.html', '/create-galaxy-style-free-name-logo-438.html'] },
    { name: 'galaxystyle',      alias: [],                              urls: ['/create-galaxy-style-free-name-logo-438.html'] },
    { name: 'galaxywallpaper',  alias: [],                              urls: ['/create-galaxy-wallpaper-mobile-online-528.html'] },
    { name: 'glitchtext',       alias: [],                              urls: ['/create-digital-glitch-text-effects-online-767.html'] },
    { name: 'glossysilver',     alias: [],                              urls: ['/create-glossy-silver-3d-text-effect-online-802.html'] },
    { name: 'glowingtext',      alias: [],                              urls: ['/create-glowing-text-effects-online-706.html'] },
    { name: 'gradienttext',     alias: [],                              urls: ['/create-3d-gradient-text-effect-online-600.html'] },
    { name: 'graffiti',         alias: [],                              urls: ['/create-a-cartoon-style-graffiti-text-effect-online-668.html', '/create-cartoon-style-graffiti-text-effect-online-668.html'] },
    { name: 'incandescent',     alias: [],                              urls: ['/text-effects-incandescent-bulbs-219.html'] },
    { name: 'lighteffects',     alias: ['lighteffect'],                 urls: ['/create-light-effects-green-neon-online-429.html'] },
    { name: 'logomaker',        alias: [],                              urls: ['/free-bear-logo-maker-online-673.html'] },
    { name: 'luxurygold',       alias: [],                              urls: ['/modern-gold-4-213.html'] },
    { name: 'makingneon',       alias: [],                              urls: ['/making-neon-light-text-effect-with-galaxy-style-521.html'] },
    { name: 'matrix',           alias: [],                              urls: ['/matrix-text-effect-154.html'] },
    { name: 'multicoloredneon', alias: [],                              urls: ['/create-multicolored-neon-light-signatures-591.html'] },
    { name: 'neonglitch',       alias: [],                              urls: ['/create-impressive-neon-glitch-text-effects-online-768.html'] },
    { name: 'nigerianflag',     alias: [],                              urls: ['/nigeria-3d-flag-text-effect-online-free-753.html'] },
    { name: 'papercutstyle',    alias: ['papercut'],                    urls: ['/multicolor-3d-paper-cut-style-text-effect-658.html'] },
    { name: 'pixelglitch',      alias: [],                              urls: ['/create-pixel-glitch-text-effect-online-769.html'] },
    { name: 'royaltext',        alias: [],                              urls: ['/royal-text-effect-online-free-471.html'] },
    { name: 'sand',             alias: ['sandsummer'],                  urls: ['/write-in-sand-summer-beach-online-free-595.html', '/write-in-sand-summer-beach-online-576.html'] },
    { name: 'summerbeach',      alias: [],                              urls: ['/write-in-sand-summer-beach-online-576.html', '/write-in-sand-summer-beach-online-free-595.html'] },
    { name: 'topography',       alias: ['typographytext'],              urls: ['/create-typography-text-effect-on-pavement-online-774.html'] },
    { name: 'underwater',       alias: [],                              urls: ['/3d-underwater-text-effect-online-682.html'] },
    { name: 'watercolortext',   alias: [],                              urls: ['/create-a-watercolor-text-effect-online-655.html'] },
    { name: 'writetext',        alias: [],                              urls: ['/write-text-on-wet-glass-online-589.html'] }
];

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MENUS (exactly the names you asked for)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const MENU_MAIN = [
    '1917style', 'advancedglow', 'blackpinklogo', 'blackpinkstyle', 'cartoonstyle', 'deletingtext',
    'dragonball', 'effectclouds', 'flag3dtext', 'flagtext', 'freecreate', 'galaxystyle',
    'galaxywallpaper', 'glitchtext', 'glowingtext', 'gradienttext', 'graffiti', 'incandescent',
    'lighteffects', 'logomaker', 'luxurygold', 'makingneon', 'matrix', 'multicoloredneon',
    'neonglitch', 'papercutstyle', 'pixelglitch', 'royaltext', 'sand', 'summerbeach',
    'topography', 'watercolortext', 'writetext'
];
const MENU_EXTRA = [
    'bluearchive', 'ppcouple', 'advancedglow', 'americanflag', 'blackpinklogo', 'blackpinkstyle',
    'cartoonstyle', 'deletingtext', 'effectclouds', 'galaxy', 'galaxystyle', 'glitchtext',
    'glossysilver', 'glowingtext', 'gradienttext', 'lighteffect', 'logo1917', 'luxurygold',
    'makingneon', 'neonglitch', 'nigerianflag', 'papercut', 'pixelglitch', 'sandsummer',
    'summerbeach', 'typographytext', 'underwater', 'writetext', 'logomaker', 'logolist'
];

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   URL OVERRIDES (persisted, editable with .setephoto)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const DATA_DIR = path.join(process.cwd(), 'data');
const OVERRIDE_FILE = path.join(DATA_DIR, 'ephoto-urls.json');

function loadOverrides() {
    try { return JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8')) || {}; }
    catch { return {}; }
}
function saveOverrides(obj) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(obj, null, 2));
}

const BY_NAME = new Map();
for (const fx of EFFECTS) {
    BY_NAME.set(fx.name, fx);
    fx.alias.forEach(a => BY_NAME.set(a, fx));
}

function urlsFor(fx) {
    const ov = loadOverrides()[fx.name];
    return ov ? [ov, ...fx.urls] : fx.urls;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   HELPERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const P = () => global.BOT_PREFIX || '.';
const cooldown = new Map();
const COOLDOWN_MS = 4000;
let running = 0;
const MAX_PARALLEL = 3;

function box(title, lines) {
    return `┏▣ ◈ *${title}* ◈\n┃\n${lines.map(l => `┃${l}`).join('\n')}\n┃\n┗▣`;
}

function renderMenu() {
    const main = MENU_MAIN.map(n => `│➽ ${n}`).join('\n');
    const extra = MENU_EXTRA.map(n => `${P()}${n}`).join('\n');
    return `▣ ◈ *EPHOTO360 MENU* ◈\n${main}\n┗▣\n\n${extra}\n\n` +
           `📌 *Usage:* ${P()}<style> <your text>\n` +
           `📌 Two-text styles: ${P()}<style> text1 | text2\n` +
           `> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`;
}

function parseTexts(args, m) {
    let raw = args.join(' ').trim();
    if (!raw && m.quoted?.body) raw = m.quoted.body.trim();
    if (!raw) return [];
    return raw.split('|').map(s => s.trim()).filter(Boolean);
}

async function runEffect(sock, m, fx, commandUsed, args) {
    const texts = parseTexts(args, m);

    if (!texts.length) {
        return m.reply(box(`𝗣𝗢𝗣𝗞𝗜𝗗 ${commandUsed.toUpperCase()}`, [
            '❌ *𝗧𝗘𝗫𝗧 𝗠𝗜𝗦𝗦𝗜𝗡𝗚*',
            `➽ ${P()}${commandUsed} <your text>`,
            `➽ Example: ${P()}${commandUsed} POPKID`,
            `➽ Tip: reply to a message with ${P()}${commandUsed}`,
            `➽ See all styles: ${P()}logolist`
        ]));
    }

    const text = texts.join(' | ');
    if (text.length > 60) return m.reply('❌ Text is too long (max 60 characters).');

    const now = Date.now();
    const last = cooldown.get(m.sender) || 0;
    if (now - last < COOLDOWN_MS && !(m.isOwner || m.isDev)) {
        return m.reply(`⏳ Wait ${Math.ceil((COOLDOWN_MS - (now - last)) / 1000)}s before using another style.`);
    }
    if (running >= MAX_PARALLEL) return m.reply('⏳ Busy making other logos, try again in a few seconds.');

    cooldown.set(m.sender, now);
    running++;
    try { await m.react('⏳'); } catch {}

    try {
        const result = await ephoto.generate(urlsFor(fx), texts, { retries: 2 });

        const caption = box(`𝗣𝗢𝗣𝗞𝗜𝗗 ${commandUsed.toUpperCase()}`, [
            `➽ *𝗧𝗘𝗫𝗧* : ${text}`,
            `➽ *𝗦𝗧𝗬𝗟𝗘* : ${commandUsed}`
        ]) + '\n> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗';
        await m.reply(result.buffer, { caption });

        try { await m.react('✅'); } catch {}
    } catch (err) {
        console.error(`[ephoto:${fx.name}]`, err.message, err.details || '');
        try { await m.react('❌'); } catch {}
        cooldown.delete(m.sender);
        const owner = m.isOwner || m.isDev;
        await m.reply(box(`𝗣𝗢𝗣𝗞𝗜𝗗 ${commandUsed.toUpperCase()}`, [
            '❌ *𝗙𝗔𝗜𝗟𝗘𝗗* to create the image.',
            '➽ The site may be busy. Try again in a moment.',
            ...(owner ? [`➽ Owner: run ${P()}ephototest ${fx.name}`, `➽ then ${P()}setephoto ${fx.name} <working url>`] : [])
        ]));
    } finally {
        running--;
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   REGISTER EVERY EFFECT COMMAND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
for (const fx of EFFECTS) {
    const names = [fx.name, ...fx.alias];
    cmd({
        pattern: fx.name,
        name: fx.name,
        alias: fx.alias,
        category: 'Ephoto360',
        desc: `Ephoto360 ${fx.name} text effect`,
        react: '🎨',
        filename: __filename
    }, async (sock, m, args) => {
        // figure out which name the user actually typed (for the caption)
        const typed = (m.body || '').slice(P().length).trim().split(/\s+/)[0].toLowerCase();
        return runEffect(sock, m, fx, names.includes(typed) ? typed : fx.name, args);
    });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MENU / LIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
cmd({
    pattern: 'logolist',
    name: 'logolist',
    alias: ['ephoto360', 'ephoto', 'ephotomenu', 'logostyles', 'logomenu'],
    category: 'Ephoto360',
    desc: 'Show every ephoto360 logo / text style',
    react: '🎨',
    filename: __filename
}, async (sock, m) => m.reply(renderMenu()));

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OWNER TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
cmd({
    pattern: 'setephoto',
    name: 'setephoto',
    alias: ['seteffect'],
    category: 'Admin',
    desc: 'Owner: change an effect link. .setephoto <style> <ephoto360 url> | .setephoto <style> reset',
    hidden: true,
    filename: __filename
}, async (sock, m, args) => {
    if (!(m.isOwner || m.isDev)) return m.reply('❌ Owner only.');
    const [style, link] = [(args[0] || '').toLowerCase(), args[1]];
    const fx = BY_NAME.get(style);
    if (!fx || !link) {
        return m.reply(`❌ Usage:\n${P()}setephoto <style> <https://en.ephoto360.com/....html>\n${P()}setephoto <style> reset`);
    }
    const ov = loadOverrides();
    if (link.toLowerCase() === 'reset') {
        delete ov[fx.name];
        saveOverrides(ov);
        return m.reply(`✅ ${fx.name} reset to default link.`);
    }
    if (!/^https?:\/\/(en\.)?ephoto360\.com\/.+\.html/i.test(link)) {
        return m.reply('❌ That is not an ephoto360 effect link.');
    }
    ov[fx.name] = link;
    saveOverrides(ov);
    return m.reply(`✅ ${fx.name} now uses:\n${link}\n\nTest it: ${P()}${fx.name} TEST`);
});

cmd({
    pattern: 'ephototest',
    name: 'ephototest',
    alias: ['testephoto'],
    category: 'Admin',
    desc: 'Owner: test effect links. .ephototest (all) or .ephototest <style>',
    hidden: true,
    filename: __filename
}, async (sock, m, args) => {
    if (!(m.isOwner || m.isDev)) return m.reply('❌ Owner only.');

    const one = (args[0] || '').toLowerCase();
    const list = one ? [BY_NAME.get(one)].filter(Boolean) : EFFECTS;
    if (!list.length) return m.reply('❌ Unknown style.');

    await m.reply(`🧪 Testing ${list.length} effect(s)… this can take a few minutes.`);
    const ok = [];
    const bad = [];
    for (const fx of list) {
        try {
            await ephoto.generate(urlsFor(fx), ['TEST'], { retries: 1 });
            ok.push(fx.name);
        } catch (err) {
            bad.push(`${fx.name} → ${(err.details?.[0] || err.message).slice(0, 90)}`);
        }
        await new Promise(r => setTimeout(r, 1200));
    }
    return m.reply(
        `🧪 *EPHOTO TEST*\n✅ Working (${ok.length}): ${ok.join(', ') || 'none'}\n\n` +
        `❌ Broken (${bad.length}):\n${bad.join('\n') || 'none'}\n\n` +
        (bad.length ? `Fix with: ${P()}setephoto <style> <url from en.ephoto360.com>` : 'All good 🎉')
    );
});
