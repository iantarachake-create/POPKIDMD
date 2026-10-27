'use strict';
/**
 * Persistent settings store + registry.
 *
 *  - Everything is saved in data/settings.json (survives restarts; session & config.js untouched).
 *  - Each registered setting is mirrored to the global.* variable the rest of the bot already reads,
 *    so changing it from WhatsApp takes effect immediately and again after every restart.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DIR, 'settings.json');

let data = { s: {}, lists: {} };
let timer = null;

function load() {
    try {
        const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        if (parsed && typeof parsed === 'object') data = parsed;
    } catch { /* first run */ }
    data.s = data.s && typeof data.s === 'object' ? data.s : {};
    data.lists = data.lists && typeof data.lists === 'object' ? data.lists : {};
}

function flush() {
    try {
        fs.mkdirSync(DIR, { recursive: true });
        const tmp = FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, FILE);
    } catch (e) {
        console.error('[settings] save failed:', e.message);
    }
}
function save() {
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
}
process.on('exit', flush);

/* ───────── registry: key -> { t: type, d: default, apply(v) } ───────── */
const emojiList = v => String(v || '').split(/[\s,]+/).filter(Boolean);

const DEFS = {
    // toggles that mirror existing globals in index.js
    autoread:             { t: 'bool', d: false, apply: v => { global.autoRead = v; } },
    autoviewstatus:       { t: 'bool', d: true,  apply: v => { global.autoView = v; } },
    autoreactstatus:      { t: 'bool', d: false, apply: v => { global.autoLike = v; } },
    alwaysonline:         { t: 'bool', d: true,  apply: v => { global.alwaysOnline = v; } },
    presence:             { t: 'enum', d: 'none', vals: ['none', 'typing', 'recording', 'both', 'online'], apply: v => { global.presenceMode = v; } },
    autoreactchannel:     { t: 'bool', d: true,  apply: v => { global.autoReactChannel = v; } },
    // new features
    antibug:              { t: 'bool', d: false },
    antiviewonce:         { t: 'bool', d: false },
    autoblock:            { t: 'bool', d: false },
    autosavestatus:       { t: 'bool', d: false },
    autosaverepliedstatus:{ t: 'bool', d: false },
    antideletestatus:     { t: 'bool', d: false },
    consolemessages:      { t: 'bool', d: false },
    // text / number settings
    channelemoji:         { t: 'str',  d: '', apply: v => { global.channelReactEmojis = emojiList(v); } },
    statusemoji:          { t: 'str',  d: '', apply: v => { global.statusEmojis = emojiList(v); } },
    sendto:               { t: 'str',  d: '' },
    botname:              { t: 'str',  d: 'POPKID', apply: v => { global.botName = v; } },
    ownername:            { t: 'str',  d: '',   apply: v => { if (v) global.ownerName = v; } },
    ownernumber:          { t: 'str',  d: '',   apply: v => { global.ownerNumber = v; } },
    secondnumber:         { t: 'str',  d: '' },
    timezone:             { t: 'str',  d: '',   apply: v => { global.timezone = v || undefined; } },
    font:                 { t: 'enum', d: 'normal', vals: ['normal', 'bold', 'italic', 'bolditalic', 'mono', 'script', 'bubble', 'smallcaps', 'fullwidth'], apply: v => { global.fontStyle = v; } },
    watermark:            { t: 'str',  d: '',   apply: v => { global.watermark = v; } },
    contextlink:          { t: 'str',  d: '',   apply: v => { global.contextLink = v; } },
    stickerpack:          { t: 'str',  d: 'POPKID', apply: v => { global.stickerPack = v; } },
    stickerauthor:        { t: 'str',  d: 'POPKID', apply: v => { global.stickerAuthor = v; } },
    maxwarn:              { t: 'num',  d: 3, min: 1, max: 20, apply: v => { global.maxWarnings = v; } },
    menustyle:            { t: 'num',  d: 1, min: 1, max: 3 },
    alivemsg:             { t: 'str',  d: '' , apply: v => { global.aliveMsg = v; } },
    anticallmsg:          { t: 'str',  d: '', apply: v => { global.antiCallMsg = v; } },
    welcomemsg:           { t: 'str',  d: '', apply: v => { global.welcomeMsg = v; } },
    goodbyemsg:           { t: 'str',  d: '', apply: v => { global.goodbyeMsg = v; } },
    aza:                  { t: 'str',  d: '' }
};

function get(key) {
    const def = DEFS[key];
    if (key in data.s) return data.s[key];
    return def ? def.d : undefined;
}

function coerce(def, raw) {
    if (def.t === 'bool') {
        if (typeof raw === 'boolean') return raw;
        const v = String(raw).toLowerCase();
        if (['on', 'true', 'yes', 'enable', 'enabled', '1'].includes(v)) return true;
        if (['off', 'false', 'no', 'disable', 'disabled', '0'].includes(v)) return false;
        throw new Error('use on or off');
    }
    if (def.t === 'num') {
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new Error('give a number');
        if (def.min !== undefined && n < def.min) throw new Error(`minimum is ${def.min}`);
        if (def.max !== undefined && n > def.max) throw new Error(`maximum is ${def.max}`);
        return Math.round(n);
    }
    if (def.t === 'enum') {
        const v = String(raw).toLowerCase();
        if (!def.vals.includes(v)) throw new Error(`choose: ${def.vals.join(', ')}`);
        return v;
    }
    return String(raw);
}

function set(key, raw) {
    const def = DEFS[key];
    if (!def) throw new Error(`unknown setting "${key}"`);
    const value = coerce(def, raw);
    data.s[key] = value;
    if (def.apply) def.apply(value);
    save();
    return value;
}

function reset(key) {
    const keys = key ? [key] : Object.keys(DEFS);
    for (const k of keys) {
        const def = DEFS[k];
        if (!def) continue;
        delete data.s[k];
        if (def.apply) def.apply(def.d);
    }
    if (!key) data.lists = {};
    save();
}

function applyAll() {
    for (const [k, v] of Object.entries(data.s)) {
        try { DEFS[k]?.apply?.(v); } catch { /* ignore */ }
    }
}

/* ───────── generic lists / maps (sudo-free; filters, ignore, mutes, anti …) ───────── */
function list(name) {
    if (!Array.isArray(data.lists[name])) data.lists[name] = [];
    return data.lists[name];
}
function map(name) {
    if (!data.lists[name] || Array.isArray(data.lists[name]) || typeof data.lists[name] !== 'object') data.lists[name] = {};
    return data.lists[name];
}

load();
applyAll();

module.exports = { DEFS, get, set, reset, save, flush, list, map, applyAll, raw: () => data };
