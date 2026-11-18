'use strict';
/**
 * POPKID MENU
 *
 * Builds itself from the commands that are actually loaded, so a new plugin
 * shows up here the moment it calls cmd() — there is nothing to edit.
 *
 *   .menu                 picture + dashboard + every command, grouped by category
 *   .menu <category>      one category with a short description for each command
 *   .menu <command>       details of one command (aliases, category, usage)
 *   .menu all             the full list as plain text
 *   .<category>menu       shortcut, e.g. .adminmenu  .toolsmenu  .downloadsmenu
 *
 * Look is controlled by the existing owner setting:  .set menustyle 1|2|3
 *   1 = picture/video + full list (default)
 *   2 = text only, full list
 *   3 = compact: picture/video + dashboard + category index only
 *
 * Categories come from each command's `category:`. Spelling differences such as
 * "Downloader" / "Downloaders" / "tools" / "Tools" are merged; a category the
 * menu has never seen still appears (with a ✨ icon) — nothing is ever hidden.
 * Commands marked `hidden: true` and commands the owner disabled are left out.
 */
const { cmd } = require('../arslan');
const { pickMenuMedia } = require('../lib/menumedia');

let settings = null;
try { settings = require('../lib/settings'); } catch { /* optional */ }

/* ───────────────────────── look & feel ───────────────────────── */

const MAX_CAPTION = 3000;   // longest caption kept on the picture
const MAX_TEXT = 3500;      // longest follow-up text message
const DENSE_OVER = 30;      // categories bigger than this are printed 3 per line in the full list

const BOLD = (s) => String(s).split('').map(ch => {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x1D5D4 + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x1D5EE + c - 97);
    if (c >= 48 && c <= 57) return String.fromCodePoint(0x1D7EC + c - 48);
    return ch;
}).join('');

const SMALL = { a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ғ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 's', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ' };
const SC = (s) => String(s).toLowerCase().split('').map(ch => SMALL[ch] || ch).join('');

const TOP = '┏▣ ◈';
const SIDE = '┃';
const END = '┗▣';

/**
 * Known categories: canonical key -> look + the spellings that map onto it.
 * `order` only decides where it sits in the list; unknown ones go last.
 */
const CATEGORIES = {
    general:   { title: 'General',     emoji: '🏠', order: 1,  also: ['main', 'core', 'basic'] },
    info:      { title: 'Info',        emoji: 'ℹ️', order: 2,  also: ['information', 'about'] },
    downloads: { title: 'Downloads',   emoji: '📥', order: 3,  also: ['download', 'downloader', 'downloaders', 'dl', 'media'] },
    search:    { title: 'Search',      emoji: '🔎', order: 4,  also: ['searcher', 'finder'] },
    ai:        { title: 'AI',          emoji: '🤖', order: 5,  also: ['chatbot', 'gpt'] },
    tools:     { title: 'Tools',       emoji: '🧰', order: 6,  also: ['tool', 'utility', 'utilities', 'utils', 'convert', 'converter'] },
    ephoto360: { title: 'Logo Maker',  emoji: '🎨', order: 7,  also: ['ephoto', 'logo', 'logos', 'textpro', 'textmaker', 'photooxy'] },
    fun:       { title: 'Fun',         emoji: '🎉', order: 8,  also: ['games', 'game', 'entertainment'] },
    sports:    { title: 'Sports',      emoji: '⚽', order: 9,  also: ['sport', 'football'] },
    group:     { title: 'Group',       emoji: '👥', order: 10, also: ['groups'] },
    status:    { title: 'Status',      emoji: '📡', order: 11, also: ['story', 'stories'] },
    channel:   { title: 'Channel',     emoji: '📢', order: 12, also: ['channels', 'newsletter'] },
    admin:     { title: 'Admin',       emoji: '🛡️', order: 13, also: ['admins', 'moderation', 'mod'] },
    owner:     { title: 'Owner',       emoji: '👑', order: 14, lock: true, also: ['dev', 'developer', 'creator'] },
    settings:  { title: 'Settings',    emoji: '⚙️', order: 15, lock: true, also: ['setting', 'config', 'configuration', 'setup'] }
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// every spelling -> canonical key
const SPELLING = new Map();
for (const [key, meta] of Object.entries(CATEGORIES)) {
    SPELLING.set(key, key);
    SPELLING.set(norm(meta.title), key);
    meta.also.forEach(a => SPELLING.set(norm(a), key));
}

function categoryKey(raw) {
    const n = norm(raw) || 'general';
    return SPELLING.get(n) || n;
}

function categoryMeta(key, sampleLabel) {
    if (CATEGORIES[key]) return CATEGORIES[key];
    const label = String(sampleLabel || key);
    return { title: label.charAt(0).toUpperCase() + label.slice(1), emoji: '✨', order: 100, lock: false, also: [] };
}

/* ───────────────────────── reading the loaded commands ───────────────────────── */

const prefix = () => global.BOT_PREFIX || '.';
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/**
 * Commands that index.js answers itself (handleNativeCommand) never go through cmd(),
 * so the menu cannot discover them. They are listed here and only added when no
 * plugin already provides the same name. Keep in step with handleNativeCommand().
 */
const NATIVE = [
    { name: 'warn',      category: 'Admin',  desc: 'Warn a member (reply or @tag); removed at the warning limit' },
    { name: 'resetwarn', category: 'Admin',  desc: 'Clear a member\'s warnings (reply or @tag)' },
    { name: 'sticker',   category: 'Tools',  desc: 'Turn a replied image into a sticker', alias: ['s'] },
    { name: 'anticall',  category: 'Owner',  desc: 'Reject incoming calls: on | off', use: '{p}anticall on|off' },
    { name: 'antispam',  category: 'Owner',  desc: 'Rate-limit message spam: on | off', use: '{p}antispam on|off' },
    { name: 'broadcast', category: 'Owner',  desc: 'Send a message to every group', use: '{p}broadcast <message>' },
    { name: 'backup',    category: 'Owner',  desc: 'Send a backup of the session (keep it private)' },
    { name: 'restore',   category: 'Owner',  desc: 'Restore a session from a replied backup .zip' }
];

/**
 * Returns every visible command, grouped:
 *   { cats: [{ key, meta, list: [entry…] }…], byName: Map(name|alias -> entry), total }
 */
function collect() {
    const entries = new Map();   // name -> entry  (last one registered wins, same as the dispatcher)

    for (const c of (global.commands || [])) {
        if (!c || !c.pattern) continue;
        entries.set(c.pattern, {
            name: c.pattern,
            aliases: c.alias || [],
            desc: c.desc || '',
            label: c.category,
            hidden: !!c.hidden,
            use: c.use || c.usage || c.example || ''
        });
    }
    // older { name, execute } style plugins are not in global.commands
    for (const p of new Set(global.plugins instanceof Map ? global.plugins.values() : [])) {
        if (!p || !p.name || entries.has(p.name)) continue;
        entries.set(p.name, {
            name: p.name,
            aliases: p.aliases || [],
            desc: p.description || '',
            label: p.category,
            hidden: !!p.hidden,
            use: ''
        });
    }

    for (const n of NATIVE) {
        if (entries.has(n.name)) continue;
        entries.set(n.name, { name: n.name, aliases: n.alias || [], desc: n.desc, label: n.category, hidden: false, use: n.use || '' });
    }

    let disabled = [];
    try { disabled = settings ? settings.list('disabled') : []; } catch { /* ignore */ }

    const byName = new Map();
    const groups = new Map();
    let total = 0;

    for (const e of entries.values()) {
        if (e.hidden || e.name.startsWith('__') || disabled.includes(e.name)) continue;
        const key = (global.settingsMenuNames && global.settingsMenuNames.has(e.name)) ? 'settings' : categoryKey(e.label);
        e.key = key;
        if (!groups.has(key)) groups.set(key, { key, meta: categoryMeta(key, e.label), list: [] });
        groups.get(key).list.push(e);
        byName.set(e.name, e);
        total++;
    }
    for (const e of byName.values()) {
        for (const a of e.aliases) if (!byName.has(a)) byName.set(a, e);
    }

    const cats = [...groups.values()]
        .map(g => ({ ...g, list: g.list.sort((a, b) => a.name.localeCompare(b.name)) }))
        .sort((a, b) => (a.meta.order - b.meta.order) || a.meta.title.localeCompare(b.meta.title));

    return { cats, byName, total };
}

/* ───────────────────────── building the text ───────────────────────── */

function greeting(tz) {
    let hour;
    try {
        hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date())) % 24;
    } catch { hour = new Date().getHours(); }
    if (hour >= 5 && hour < 12) return '🌅 Good morning';
    if (hour >= 12 && hour < 17) return '☀️ Good afternoon';
    if (hour >= 17 && hour < 21) return '🌇 Good evening';
    return '🌙 Good night';
}

function stamp(tz) {
    const when = new Date();
    try {
        const d = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz });
        const t = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
        return `${d} • ${t}`;
    } catch {
        return when.toLocaleString('en-GB');
    }
}

const botTitle = () => {
    const n = global.botName;
    return BOLD((n && n !== 'POPKID') ? String(n).toUpperCase() : 'POPKID MD');
};

const footer = () => `> © ${BOLD(global.watermark ? String(global.watermark).toUpperCase() : 'POWERED BY POPKID')}`;

function header(m, data) {
    const tz = global.timezone || 'Africa/Nairobi';
    const up = process.uptime();
    const uptime = `${Math.floor(up / 86400) ? Math.floor(up / 86400) + 'd ' : ''}${Math.floor((up % 86400) / 3600)}h ${Math.floor((up % 3600) / 60)}m`;
    const ram = `${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`;
    const mode = global.botMode === 'private' ? '🔒 Private' : '🌐 Public';
    const user = m.pushName || String(m.sender || '').split('@')[0] || 'friend';
    const row = (label, value) => `${SIDE}◈ ${SC(label)} : ${value}`;

    return [
        `${TOP} *${botTitle()}* ◈`,
        `${SIDE} ${greeting(tz)}, *${user}*`,
        SIDE,
        row('owner', global.ownerName || 'POPKID'),
        row('mode', mode),
        row('prefix', `[ ${prefix()} ]`),
        row('commands', data.total),
        row('categories', data.cats.length),
        row('uptime', uptime),
        row('ram', ram),
        row('date', stamp(tz)),
        END
    ].join('\n');
}

/** the table of contents: every category with its icon and size */
function index(data) {
    const p = prefix();
    const lines = data.cats.map(c => `${SIDE}➽ ${c.meta.emoji} *${c.meta.title}* ‹${c.list.length}›${c.meta.lock ? ' 🔒' : ''}`);
    return [
        `${TOP} *${BOLD('CATEGORIES')}* ◈`,
        ...lines,
        SIDE,
        `${SIDE}💡 ${p}menu <category>`,
        `${SIDE}💡 ${p}menu <command>`,
        `${SIDE}⚡ shortcut: ${p}<category>menu`,
        END
    ].join('\n');
}

/** wraps lines in a box; a box that would be too long continues in a second one with the same look */
function boxed(title, lines, maxLen = MAX_TEXT) {
    const out = [];
    let cur = [];
    let part = 1;
    const render = () => `${TOP} *${title}${part > 1 ? ` (${part})` : ''}* ◈\n${cur.join('\n')}\n${END}`;
    for (const line of lines) {
        if (cur.length && render().length + line.length + 1 > maxLen) {
            out.push(render());
            cur = [];
            part++;
        }
        cur.push(line);
    }
    if (cur.length) out.push(render());
    return out;
}

const catTitle = (c) => `${c.meta.emoji} ${BOLD(c.meta.title.toUpperCase())}`;

/** names only — the full list on the main menu */
function listBlocks(c) {
    const p = prefix();
    const names = c.list.map(e => `${p}${e.name}`);
    let lines;
    if (names.length > DENSE_OVER) {
        lines = [];
        for (let i = 0; i < names.length; i += 3) lines.push(`${SIDE}➽ ${names.slice(i, i + 3).join('  ‧  ')}`);
    } else {
        lines = names.map(n => `${SIDE}➽ ${n}`);
    }
    return boxed(`${catTitle(c)} ‹${c.list.length}›`, lines);
}

/** names + a short description — the `.menu <category>` view */
function detailBlocks(c) {
    const p = prefix();
    const lines = c.list.map(e => `${SIDE}➽ *${p}${e.name}*${e.desc ? ` — ${clip(e.desc, 70)}` : ''}`);
    return boxed(`${catTitle(c)} ‹${c.list.length}›`, lines);
}

function commandCard(e, data) {
    const p = prefix();
    const meta = data.cats.find(c => c.key === e.key)?.meta || categoryMeta(e.key, e.label);
    const row = (label, value) => `${SIDE}◈ ${SC(label)} : ${value}`;
    const lines = [
        `${TOP} *${BOLD('COMMAND')}* ◈`,
        SIDE,
        row('name', `*${p}${e.name}*`),
        row('category', `${meta.emoji} ${meta.title}`)
    ];
    if (e.aliases.length) lines.push(row('aliases', e.aliases.map(a => `${p}${a}`).join('  ')));
    if (e.desc) lines.push(row('info', clip(e.desc, 160)));
    if (e.use) lines.push(row('usage', String(e.use).replace(/\{p\}|<prefix>/gi, p)));
    lines.push(SIDE, END);
    return lines.join('\n');
}

/** groups whole boxes into messages that stay under the size limit */
function pack(blocks, max = MAX_TEXT) {
    const out = [];
    let cur = '';
    for (const b of blocks) {
        if (cur && cur.length + 2 + b.length > max) { out.push(cur); cur = b; }
        else cur = cur ? `${cur}\n\n${b}` : b;
    }
    if (cur) out.push(cur);
    return out;
}

/* ───────────────────────── sending ───────────────────────── */

const pause = (ms) => new Promise(r => setTimeout(r, ms));

function makeSender(sock, m) {
    // keepQuote: the reply quotes the person's own message (see the reply wrapper in index.js)
    return (content) => sock.sendMessage(m.from, content, { quoted: m.raw || m, keepQuote: true });
}

async function sendTexts(send, texts) {
    for (let i = 0; i < texts.length; i++) {
        if (i) await pause(400);
        try { await send({ text: texts[i] }); }
        catch (err) { console.error('[MENU] text part failed:', err.message); }
    }
}

const menuStyle = () => {
    let s = NaN;
    try { s = Number(settings ? settings.get('menustyle') : NaN); } catch { /* ignore */ }
    if (![1, 2, 3].includes(s)) s = Number(global.menuStyle);
    return [1, 2, 3].includes(s) ? s : 1;
};

async function sendMainMenu(sock, m, { forceText = false } = {}) {
    const data = collect();
    const send = makeSender(sock, m);
    const style = forceText ? 2 : menuStyle();

    const head = header(m, data);
    const toc = index(data);
    const lists = data.cats.flatMap(listBlocks);
    const end = footer();

    if (!data.total) return m.reply(`${head}\n\n_No commands are loaded yet._\n\n${end}`);

    // style 2: text only
    if (style === 2) {
        const texts = pack([head, ...lists]);
        texts[texts.length - 1] += `\n\n${end}`;
        return sendTexts(send, texts);
    }

    // style 1 / 3: picture (or video) carries the dashboard + index
    const opening = `${head}\n\n${toc}${style === 3 ? `\n\n${end}` : ''}`;
    const followUps = style === 3 ? [] : pack(lists);
    if (followUps.length) followUps[followUps.length - 1] += `\n\n${end}`;

    let sent = false;
    if (opening.length <= MAX_CAPTION) {
        let media = null;
        try { media = await pickMenuMedia(); } catch (e) { console.error('[MENU] picture error:', e.message); }

        const attempt = async (pick) => {
            const content = pick.kind === 'video'
                ? { video: pick.buffer, gifPlayback: true, caption: opening }
                : { image: pick.buffer, caption: opening };
            await send(content);
        };

        if (media) {
            try { await attempt(media); sent = true; }
            catch (err) {
                console.error('[MENU] picture send failed, trying another:', err.message);
                try {
                    const other = await pickMenuMedia(media.src, true);
                    if (other) { await attempt(other); sent = true; }
                } catch (err2) { console.error('[MENU] fallback picture failed:', err2.message); }
            }
        }
    }

    // no picture could be sent → the same content as plain text, nothing lost
    if (!sent) return sendTexts(send, pack([head, toc, ...(style === 3 ? [] : lists)]).map((t, i, a) => i === a.length - 1 ? `${t}\n\n${end}` : t));

    if (followUps.length) {
        await pause(500);
        await sendTexts(send, followUps);
    }
}

async function sendCategory(sock, m, key) {
    const data = collect();
    const cat = data.cats.find(c => c.key === key);
    if (!cat) return m.reply(`❌ No commands in that category yet.`);
    const texts = pack(detailBlocks(cat));
    texts[texts.length - 1] += `\n\n💡 ${prefix()}menu <command> for details\n${footer()}`;
    return sendTexts(makeSender(sock, m), texts);
}

/** closest names for "did you mean" */
function suggest(data, q) {
    const names = [...new Set([...data.byName.values()].map(e => e.name))];
    const starts = names.filter(n => n.startsWith(q));
    const has = names.filter(n => !n.startsWith(q) && n.includes(q));
    return [...starts, ...has].slice(0, 8);
}

/* ───────────────────────── the commands ───────────────────────── */

cmd({
    pattern: 'menu',
    name: 'menu',
    alias: ['help', 'commands', 'cmds', 'cmdlist', 'allmenu'],
    category: 'General',
    desc: 'Show every command, a category, or details of one command',
    use: '{p}menu  •  {p}menu <category>  •  {p}menu <command>',
    react: '📜',
    hidden: true,
    filename: __filename
}, async (sock, m, args) => {
    const p = prefix();
    const q = norm((args[0] || '').replace(p, ''));

    try {
        if (!q) return await sendMainMenu(sock, m);
        if (q === 'all' || q === 'full' || q === 'list' || q === 'text') return await sendMainMenu(sock, m, { forceText: true });

        const data = collect();

        // 1) a category (any accepted spelling: .menu downloader, .menu dl, .menu logo …)
        const key = SPELLING.get(q) || q;
        if (data.cats.some(c => c.key === key)) return await sendCategory(sock, m, key);

        // 2) a command or one of its aliases
        const hit = data.byName.get(q) || data.byName.get((args[0] || '').toLowerCase().replace(p, ''));
        if (hit) return await m.reply(`${commandCard(hit, data)}\n\n${footer()}`);

        // 3) nothing matched
        const near = suggest(data, q);
        const lines = [
            `${TOP} *${BOLD('NOT FOUND')}* ◈`,
            SIDE,
            `${SIDE}❌ No category or command called *${args[0]}*`
        ];
        if (near.length) lines.push(SIDE, `${SIDE}🔎 ${SC('did you mean')}`, ...near.map(n => `${SIDE}➽ ${p}${n}`));
        lines.push(SIDE, `${SIDE}📂 ${SC('categories')}`, ...data.cats.map(c => `${SIDE}➽ ${c.meta.emoji} ${c.meta.title.toLowerCase()}`), SIDE, END);
        return await m.reply(lines.join('\n'));
    } catch (err) {
        console.error('[MENU] error:', err);
        return m.reply('❌ Could not build the menu.').catch(() => {});
    }
});

/**
 * `.<category>menu` shortcuts. They are created once every plugin has loaded
 * (so new categories get their shortcut automatically). They are real commands,
 * so private mode, bot on/off and disabled-command rules apply to them as usual.
 */
setImmediate(() => {
    try {
        const data = collect();
        for (const c of data.cats) {
            const names = [c.key, ...(CATEGORIES[c.key]?.also || [])].map(norm).filter(Boolean);
            for (const n of new Set(names)) {
                const pattern = `${n}menu`;
                if (global.plugins instanceof Map && global.plugins.has(pattern)) continue;   // never shadow a real command
                cmd({
                    pattern,
                    name: pattern,
                    category: 'General',
                    desc: `Show the ${c.meta.title} commands`,
                    hidden: true,
                    filename: __filename
                }, async (sock, m) => {
                    try { await sendCategory(sock, m, c.key); }
                    catch (err) { console.error('[MENU] category error:', err); }
                });
            }
        }
    } catch (err) {
        console.error('[MENU] could not create category shortcuts:', err.message);
    }
});
