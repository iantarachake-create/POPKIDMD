'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cmd } = require('../arslan');
const settings = require('../lib/settings');
const { P, isOwner, box, parseOnOff, digits, numberOf, targetJid, once } = require('../lib/cmdutil');

const CAT = 'Settings';

/* names shown under the SETTINGS MENU (main-menu.js reads this) */
global.settingsMenuNames = new Set(('addbadword addcountrycode addignorelist addmenuimage addmenuvideo addsudo allvar alwaysonline antiaudio antibug anticall antichannelpost anticontact antidelete antideletestatus antidocument antiedit antiforward antigif antiimage antilocation antimessage antipoll antireaction antisticker antivideo antiviewonce antivoice approve autobio autoblock autoreact autoreactchannel autoreactstatus autoread autorecord autorecordtyping autosaverepliedstatus autosavestatus autosend autotype autoviewstatus blocklist chr clearchat clearmenuimages clearmenuvideos consolemessages delalternatenumber delanticallmsg delcountrycode deletebadword delgfilter delgoodbye delignorelist delpfilter delsudo delvar delwelcome disable enable forward getid getsettings getvar gfilter groupaddprivacy lastseen listcountrycode listdisabled listgfilter listpfilter listwarn menustyle mode mute mutelist mypp mystatus onlineprivacy pfilter readprivacy reject removepp resetaza resetsetting resetwarn set setalive setanticallmsg setbio setbotname setchannelreactemoji setcontextlink setfont setgoodbye setmenuimage setmenuvideo setname setownername setownernumber setprefix setsecondnumber setstatusemoji setstickerauthor setstickerpackname settimezone setvar setwarn setwatermark showanticallmsg systemstatus testanticallmsg unblock unmute').split(' '));

/* ───────────────────────── environment-style variables ───────────────────────── */
const SENSITIVE = /(KEY|TOKEN|SESSION|SECRET|PASS|AUTH|CRED)/i;
const mask = (k, v) => (SENSITIVE.test(k) ? `••••(${String(v).length} chars)` : String(v));
const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

// re-apply saved variables to this process after every restart
for (const [k, v] of Object.entries(settings.map('vars'))) process.env[k] = v;

cmd({ pattern: 'setvar', name: 'setvar', category: CAT, desc: 'Set a bot variable: .setvar KEY value', react: '🔧', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const key = (args[0] || '').toUpperCase();
    const value = args.slice(1).join(' ');
    if (!VAR_RE.test(key) || !value) return m.reply(`❌ Usage: ${P()}setvar KEY value`);
    settings.map('vars')[key] = value;
    process.env[key] = value;
    settings.save();
    return m.reply(`✅ ${key} saved.\n_Saved in the bot's own store; it is not written to your hosting panel's env._`);
});

cmd({ pattern: 'getvar', name: 'getvar', category: CAT, desc: 'Show a variable: .getvar KEY', react: '🔍', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const key = (args[0] || '').toUpperCase();
    if (!key) return m.reply(`❌ Usage: ${P()}getvar KEY`);
    const own = settings.map('vars')[key];
    const val = own !== undefined ? own : process.env[key];
    if (val === undefined) return m.reply(`❌ ${key} is not set.`);
    return m.reply(`🔍 *${key}* = ${mask(key, val)}${own === undefined ? '\n(from environment)' : ''}`);
});

cmd({ pattern: 'delvar', name: 'delvar', category: CAT, desc: 'Delete a variable: .delvar KEY', react: '🗑️', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const key = (args[0] || '').toUpperCase();
    const vars = settings.map('vars');
    if (!(key in vars)) return m.reply(`❌ ${key} is not one of the saved variables.`);
    delete vars[key];
    delete process.env[key];
    settings.save();
    return m.reply(`✅ ${key} deleted.`);
});

cmd({ pattern: 'allvar', name: 'allvar', category: CAT, desc: 'List all saved variables', react: '📋', filename: __filename },
async (sock, m) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const vars = Object.entries(settings.map('vars'));
    if (!vars.length) return m.reply(box('𝗔𝗟𝗟 𝗩𝗔𝗥𝗦', ['➽ No saved variables.', `➽ Add: ${P()}setvar KEY value`]));
    return m.reply(box('𝗔𝗟𝗟 𝗩𝗔𝗥𝗦', vars.map(([k, v]) => `➽ ${k} = ${mask(k, v)}`)));
});

/* ───────────────────────── generic set / getsettings / reset ───────────────────────── */
const HIDDEN_KEYS = new Set(['aza']);

function formatValue(def, v) {
    if (def.t === 'bool') return v ? '✅ ON' : '❌ OFF';
    if (v === '' || v === undefined) return '— (default)';
    return String(v).length > 40 ? String(v).slice(0, 40) + '…' : String(v);
}

cmd({ pattern: 'set', name: 'set', category: CAT, desc: 'Change any setting: .set <name> <value>', react: '⚙️', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const key = (args[0] || '').toLowerCase();
    if (!key) {
        const names = Object.keys(settings.DEFS).filter(k => !HIDDEN_KEYS.has(k));
        return m.reply(box('𝗦𝗘𝗧', [
            `➽ ${P()}set <name> <value>`,
            `➽ ${P()}getsettings to see values`,
            '',
            ...names.map(k => `➽ ${k}  (${settings.DEFS[k].t === 'enum' ? settings.DEFS[k].vals.join('/') : settings.DEFS[k].t})`)
        ]));
    }
    const def = settings.DEFS[key];
    if (!def || HIDDEN_KEYS.has(key)) return m.reply(`❌ Unknown setting "${key}". Send ${P()}set to see the list.`);
    const value = args.slice(1).join(' ');
    if (value === '') return m.reply(`⚙️ ${key} = ${formatValue(def, settings.get(key))}`);
    try {
        const saved = settings.set(key, value);
        return m.reply(`✅ ${key} → ${formatValue(def, saved)}`);
    } catch (e) { return m.reply(`❌ ${e.message}`); }
});

cmd({ pattern: 'getsettings', name: 'getsettings', alias: ['settings', 'allsettings'], category: CAT, desc: 'Show every setting and list size', react: '📊', filename: __filename },
async (sock, m) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const lines = Object.keys(settings.DEFS).filter(k => !HIDDEN_KEYS.has(k))
        .map(k => `➽ ${k}: ${formatValue(settings.DEFS[k], settings.get(k))}`);
    const anti = settings.map('anti');
    const activeAnti = Object.entries(anti).filter(([, v]) => Object.values(v).some(x => x && x !== 'off')).map(([k]) => k);
    lines.push('', `➽ anti filters active: ${activeAnti.join(', ') || 'none'}`,
        `➽ ignore list: ${settings.list('ignore').length}`,
        `➽ bad words: ${settings.list('badwords').length}`,
        `➽ country codes: ${settings.list('countrycodes').length}`,
        `➽ disabled cmds: ${settings.list('disabled').length}`,
        `➽ group filters: ${Object.keys(settings.map('gfilters')).length}`,
        `➽ private filters: ${Object.keys(settings.map('pfilters')).length}`,
        `➽ prefix: ${P()}`);
    return m.reply(box('𝗔𝗟𝗟 𝗦𝗘𝗧𝗧𝗜𝗡𝗚𝗦', lines));
});

cmd({ pattern: 'resetsetting', name: 'resetsetting', alias: ['resetsettings'], category: CAT, desc: 'Reset one setting or "all"', react: '♻️', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const key = (args[0] || '').toLowerCase();
    if (!key) return m.reply(`❌ Usage: ${P()}resetsetting <name>  or  ${P()}resetsetting all`);
    if (key === 'all') {
        settings.reset();
        return m.reply('✅ All settings and lists reset to defaults.');
    }
    if (!settings.DEFS[key]) return m.reply(`❌ Unknown setting "${key}".`);
    settings.reset(key);
    return m.reply(`✅ ${key} reset to default.`);
});

/* ───────────────────────── simple text settings ───────────────────────── */
function textSetting(name, key, label, { validate, after } = {}) {
    cmd({ pattern: name, name, category: CAT, desc: `Set ${label}`, react: '📝', filename: __filename }, async (sock, m, args) => {
        if (!isOwner(m)) return m.reply('❌ Owner only.');
        const value = args.join(' ').trim() || m.quoted?.body?.trim() || '';
        if (!value) return m.reply(`❌ Usage: ${P()}${name} <value>\n➽ Current: ${settings.get(key) || '— (default)'}`);
        try {
            if (validate) validate(value);
            const saved = settings.set(key, value);
            if (after) await after(sock, m, saved);
            return m.reply(`✅ ${label} set to: ${saved}`);
        } catch (e) { return m.reply(`❌ ${e.message}`); }
    });
}

textSetting('setbotname', 'botname', 'bot name');
textSetting('setownername', 'ownername', 'owner name');
textSetting('setstickerpackname', 'stickerpack', 'sticker pack name');
textSetting('setstickerauthor', 'stickerauthor', 'sticker author');
textSetting('setwatermark', 'watermark', 'watermark (added to media captions)');
textSetting('setcontextlink', 'contextlink', 'context link', {
    validate: v => { if (!/^https?:\/\//i.test(v)) throw new Error('give a full link starting with https://'); }
});
textSetting('settimezone', 'timezone', 'timezone', {
    validate: v => {
        try { new Intl.DateTimeFormat('en', { timeZone: v }); }
        catch { throw new Error('invalid timezone. Example: Africa/Nairobi, Africa/Lagos, Asia/Dubai'); }
    }
});

cmd({ pattern: 'setfont', name: 'setfont', category: CAT, desc: 'Change the font style of bot messages', react: '🔤', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const vals = settings.DEFS.font.vals;
    const v = (args[0] || '').toLowerCase();
    if (!v) {
        return m.reply(box('𝗦𝗘𝗧 𝗙𝗢𝗡𝗧', [
            `➽ Current: ${settings.get('font')}`,
            `➽ ${P()}setfont <style>`,
            ...vals.map(s => `➽ ${s}${s === 'normal' ? '' : '  →  ' + applyFont('Popkid Bot', s)}`)
        ]));
    }
    try {
        settings.set('font', v);
        return m.reply(`✅ Font set to ${v}: ${applyFont('Popkid Bot Online', v)}`);
    } catch (e) { return m.reply(`❌ ${e.message}`); }
});

/* ───────────────────────── owner numbers ───────────────────────── */
async function addOwnerJid(sock, number) {
    const num = digits(number);
    const pn = `${num}@s.whatsapp.net`;
    global.owners = Array.isArray(global.owners) ? global.owners : [];
    if (!global.owners.includes(pn)) global.owners.push(pn);
    // best effort: also learn the @lid form WhatsApp may report for this number
    try {
        const lid = await sock?.signalRepository?.lidMapping?.getLIDForPN?.(pn);
        if (lid) {
            const l = String(lid).split(':')[0];
            if (!global.owners.includes(l)) global.owners.push(l);
        }
    } catch { /* optional */ }
}
function removeOwnerJid(number) {
    const num = digits(number);
    global.owners = (global.owners || []).filter(o => !String(o).startsWith(num + '@') && !String(o).startsWith(num + ':'));
}
// restore saved extra owners after every restart
for (const key of ['ownernumber', 'secondnumber']) {
    const n = settings.get(key);
    if (n) { global.owners = global.owners || []; const pn = `${digits(n)}@s.whatsapp.net`; if (!global.owners.includes(pn)) global.owners.push(pn); }
}

cmd({ pattern: 'setownernumber', name: 'setownernumber', category: CAT, desc: 'Set the owner number: .setownernumber 2547xxxxxxxx', react: '👑', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const num = digits(args.join(''));
    if (num.length < 7 || num.length > 15) return m.reply(`❌ Usage: ${P()}setownernumber 2547xxxxxxxx (country code, no +)`);
    settings.set('ownernumber', num);
    await addOwnerJid(sock, num);
    return m.reply(`✅ Owner number set to +${num} and given owner access.`);
});

cmd({ pattern: 'setsecondnumber', name: 'setsecondnumber', alias: ['setalternatenumber'], category: CAT, desc: 'Add a second owner number', react: '📱', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const num = digits(args.join(''));
    if (num.length < 7 || num.length > 15) return m.reply(`❌ Usage: ${P()}setsecondnumber 2547xxxxxxxx`);
    settings.set('secondnumber', num);
    await addOwnerJid(sock, num);
    return m.reply(`✅ Second number +${num} added with owner access.`);
});

cmd({ pattern: 'delalternatenumber', name: 'delalternatenumber', alias: ['delsecondnumber'], category: CAT, desc: 'Remove the second owner number', react: '🗑️', filename: __filename },
async (sock, m) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const num = settings.get('secondnumber');
    if (!num) return m.reply('❌ No second number is set.');
    removeOwnerJid(num);
    settings.reset('secondnumber');
    return m.reply(`✅ +${num} removed from owners.`);
});

/* ───────────────────────── sudo (shares data/sudo.json with .sudo) ───────────────────────── */
const SUDO_FILE = path.join(process.cwd(), 'data', 'sudo.json');
const loadSudo = () => { try { const d = JSON.parse(fs.readFileSync(SUDO_FILE, 'utf8')); return Array.isArray(d) ? d : []; } catch { return []; } };
const saveSudo = list => { fs.mkdirSync(path.dirname(SUDO_FILE), { recursive: true }); fs.writeFileSync(SUDO_FILE, JSON.stringify(list, null, 2)); };

cmd({ pattern: 'addsudo', name: 'addsudo', category: CAT, desc: 'Give a user sudo access (reply / @tag / number)', react: '➕', filename: __filename },
async (sock, m, args) => {
    if (!m.isOwner) return m.reply('❌ Only the real owner can add sudo users.');
    const t = targetJid(m, args);
    if (!t) return m.reply(`❌ Reply to, tag, or type the number: ${P()}addsudo 2547xxxxxxxx`);
    const jid = `${numberOf(t)}@s.whatsapp.net`;
    const list = loadSudo();
    if (list.includes(jid)) return m.reply('ℹ️ Already a sudo user.');
    list.push(jid); saveSudo(list);
    return m.reply(`✅ +${numberOf(jid)} is now a sudo user.`);
});

cmd({ pattern: 'delsudo', name: 'delsudo', alias: ['removesudo'], category: CAT, desc: 'Remove a sudo user', react: '➖', filename: __filename },
async (sock, m, args) => {
    if (!m.isOwner) return m.reply('❌ Only the real owner can remove sudo users.');
    const t = targetJid(m, args);
    if (!t) return m.reply(`❌ Reply to, tag, or type the number: ${P()}delsudo 2547xxxxxxxx`);
    const jid = `${numberOf(t)}@s.whatsapp.net`;
    const list = loadSudo();
    if (!list.includes(jid)) return m.reply('ℹ️ That user is not sudo.');
    saveSudo(list.filter(j => j !== jid));
    return m.reply(`✅ +${numberOf(jid)} removed from sudo.`);
});

/* ───────────────────────── alive / system status ───────────────────────── */
const fmtUptime = s => `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m ${Math.floor(s % 60)}s`;

cmd({ pattern: 'alive', name: 'alive', category: 'General', desc: 'Check that the bot is online', react: '💚', filename: __filename },
async (sock, m) => {
    const tpl = global.aliveMsg;
    if (tpl) {
        return m.reply(tpl
            .replace(/\{uptime\}/gi, fmtUptime(process.uptime()))
            .replace(/\{name\}/gi, m.pushName || 'friend')
            .replace(/\{bot\}/gi, global.botName || 'POPKID')
            .replace(/\{owner\}/gi, global.ownerName || 'Owner')
            .replace(/\{prefix\}/gi, P()));
    }
    return m.reply(box(`𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗟𝗜𝗩𝗘`, [
        '💚 *I am online and ready!*',
        `➽ *Uptime* : ${fmtUptime(process.uptime())}`,
        `➽ *Prefix* : ${P()}`,
        `➽ *Owner* : ${global.ownerName || 'POPKID'}`
    ]));
});

cmd({ pattern: 'setalive', name: 'setalive', category: CAT, desc: 'Set the .alive message ({uptime} {name} {bot} {owner} {prefix})', react: '💚', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const text = args.join(' ').trim() || m.quoted?.body?.trim();
    if (!text) {
        return m.reply(box('𝗦𝗘𝗧 𝗔𝗟𝗜𝗩𝗘', [
            `➽ ${P()}setalive <message>`,
            '➽ Placeholders: {uptime} {name} {bot} {owner} {prefix}',
            `➽ ${P()}setalive default  → restore the default`
        ]));
    }
    if (text.toLowerCase() === 'default') { settings.reset('alivemsg'); return m.reply('✅ Alive message restored to default.'); }
    settings.set('alivemsg', text);
    return m.reply('✅ Alive message saved. Test it with ' + P() + 'alive');
});

cmd({ pattern: 'systemstatus', name: 'systemstatus', alias: ['sysstatus', 'sysinfo', 'status2'], category: CAT, desc: 'Server and bot health', react: '🖥️', filename: __filename },
async (sock, m) => {
    const t0 = Date.now();
    const mem = process.memoryUsage();
    const total = os.totalmem(), free = os.freemem();
    const cpus = os.cpus() || [];
    const load = os.loadavg().map(n => n.toFixed(2)).join(' / ');
    const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';
    const lines = [
        `➽ *Bot uptime* : ${fmtUptime(process.uptime())}`,
        `➽ *Server uptime* : ${fmtUptime(os.uptime())}`,
        `➽ *Platform* : ${os.platform()} ${os.arch()}`,
        `➽ *Node* : ${process.version}`,
        `➽ *CPU* : ${cpus[0]?.model?.trim() || 'n/a'} (${cpus.length} cores)`,
        `➽ *Load* : ${load}`,
        `➽ *RAM (server)* : ${mb(total - free)} / ${mb(total)}`,
        `➽ *RAM (bot)* : ${mb(mem.rss)} (heap ${mb(mem.heapUsed)})`,
        `➽ *Commands* : ${new Set((global.commands || []).map(c => c.pattern)).size}`,
        `➽ *Mode* : ${global.botMode || 'public'}`
    ];
    await m.reply(box('𝗦𝗬𝗦𝗧𝗘𝗠 𝗦𝗧𝗔𝗧𝗨𝗦', lines));
});

/* ───────────────────────── aza (payment details) ───────────────────────── */
cmd({ pattern: 'setaza', name: 'setaza', category: CAT, desc: 'Save payment details shown by .aza', react: '💳', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const text = args.join(' ').trim();
    if (!text) return m.reply(`❌ Usage: ${P()}setaza Bank | Account number | Account name`);
    settings.set('aza', text);
    return m.reply('✅ Payment details saved. Anyone can view them with ' + P() + 'aza');
});
cmd({ pattern: 'aza', name: 'aza', category: 'General', desc: 'Show payment / account details', react: '💳', filename: __filename },
async (sock, m) => {
    const v = settings.get('aza');
    if (!v) return m.reply('ℹ️ No payment details have been set.');
    return m.reply(box('𝗣𝗔𝗬𝗠𝗘𝗡𝗧 𝗗𝗘𝗧𝗔𝗜𝗟𝗦', v.split('|').map(s => `➽ ${s.trim()}`)));
});
cmd({ pattern: 'resetaza', name: 'resetaza', category: CAT, desc: 'Delete saved payment details', react: '🗑️', filename: __filename },
async (sock, m) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    if (!settings.get('aza')) return m.reply('ℹ️ Nothing to reset, no payment details were set.');
    settings.reset('aza');
    return m.reply('✅ Payment details cleared.');
});

/* ───────────────────────── consolemessages ───────────────────────── */
cmd({ pattern: 'consolemessages', name: 'consolemessages', alias: ['consolelog'], category: CAT, desc: 'Log every message to the console: on/off', react: '🖥️', filename: __filename },
async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    const v = parseOnOff(args[0]);
    if (v === null) return m.reply(`⚙️ consolemessages: ${settings.get('consolemessages') ? 'ON' : 'OFF'}\nUsage: ${P()}consolemessages on|off`);
    settings.set('consolemessages', v);
    return m.reply(`✅ Console message logging ${v ? 'ON' : 'OFF'}.`);
});

/* ═════════════ font engine + sendMessage wrapper (font / watermark / context link) ═════════════ */
const ranges = {
    bold:       [0x1D5D4, 0x1D5EE],
    italic:     [0x1D608, 0x1D622],
    bolditalic: [0x1D63C, 0x1D656],
    mono:       [0x1D670, 0x1D68A],
    script:     [0x1D4D0, 0x1D4EA],
    bubble:     [0x24B6, 0x24D0],
    fullwidth:  [0xFF21, 0xFF41]
};
const SMALLCAPS = { a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ' };

function mapChar(ch, style) {
    const c = ch.charCodeAt(0);
    if (style === 'smallcaps') return SMALLCAPS[ch.toLowerCase()] || ch;
    const r = ranges[style];
    if (!r) return ch;
    if (c >= 65 && c <= 90) return String.fromCodePoint(r[0] + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(r[1] + c - 97);
    return ch;
}

function applyFont(text, style) {
    if (!style || style === 'normal' || typeof text !== 'string') return text;
    const prefix = P();
    return text.split(/(\s+)/).map(tok => {
        if (!tok.trim()) return tok;
        if (tok.includes('://') || tok.startsWith('www.') || tok.startsWith('@') || tok.includes('`') || tok.includes('@s.whatsapp') ) return tok;
        if (tok.startsWith(prefix) && /^[a-z]/i.test(tok.slice(prefix.length))) return tok;   // keep commands copy-able
        if (/^\{.*\}$/.test(tok)) return tok;
        return [...tok].map(ch => mapChar(ch, style)).join('');
    }).join('');
}

function decorate(jid, content) {
    if (!content || typeof content !== 'object') return content;
    if (content.react || content.delete || content.forward || content.poll || content.sticker || content.audio) return content;

    const style = global.fontStyle;
    const out = { ...content };

    if (typeof out.text === 'string' && !out.edit) {
        if (style && style !== 'normal') out.text = applyFont(out.text, style);
    } else if (typeof out.text === 'string' && out.edit) {
        if (style && style !== 'normal') out.text = applyFont(out.text, style);
    }

    const isMedia = out.image || out.video || out.document;
    if (isMedia) {
        let cap = typeof out.caption === 'string' ? out.caption : '';
        if (style && style !== 'normal' && cap) cap = applyFont(cap, style);
        if (global.watermark && !cap.includes(global.watermark)) cap = cap ? `${cap}\n\n${global.watermark}` : global.watermark;
        if (cap) out.caption = cap;
    }

    if (global.contextLink && (typeof out.text === 'string' || isMedia) && !out.contextInfo?.externalAdReply) {
        out.contextInfo = {
            ...(out.contextInfo || {}),
            externalAdReply: {
                title: global.botName || 'POPKID',
                body: global.ownerName || '',
                sourceUrl: global.contextLink,
                mediaType: 1,
                renderLargerThumbnail: false,
                showAdAttribution: false
            }
        };
    }
    return out;
}

function wrapSock(sock) {
    if (!sock || sock.__popkidWrapped) return;
    sock.__popkidWrapped = true;
    const original = sock.sendMessage.bind(sock);
    sock.sendMessage = async (jid, content, options) => {
        let c = content;
        try { c = decorate(jid, content); } catch { c = content; }
        return original(jid, c, options);
    };
    // learn @lid forms of the saved extra owner numbers
    for (const key of ['ownernumber', 'secondnumber']) {
        const n = settings.get(key);
        if (n) addOwnerJid(sock, n).catch(() => {});
    }
}

/* ═════════════ hidden pipeline hook: sudo + console log + wrapper install ═════════════ */
const DANGEROUS_FOR_SUDO = new Set(['backup', 'restore', 'setvar', 'getvar', 'delvar', 'allvar', 'setownernumber', 'setsecondnumber', 'delalternatenumber', 'addsudo', 'delsudo', 'update', 'resetsetting', 'setprefix', 'pair']);
const guard = once();

async function isSudoSender(sock, sender) {
    const list = loadSudo().map(j => numberOf(j));
    if (!list.length) return false;
    if (list.includes(numberOf(sender))) return true;
    if (String(sender).endsWith('@lid')) {
        try {
            const pn = await sock?.signalRepository?.lidMapping?.getPNForLID?.(sender);
            if (pn) return list.includes(numberOf(pn));
        } catch { /* ignore */ }
    }
    return false;
}

const hook = cmd({ pattern: '__setcore_hook', name: '__setcore_hook', hidden: true, category: CAT, filename: __filename }, async () => {});
hook.onMessage = async (sock, m) => {
    if (!guard(m)) return false;
    wrapSock(sock);

    if (settings.get('consolemessages') && m.body) {
        console.log(`[MSG] ${m.isGroup ? 'GROUP ' : ''}${m.from} | ${m.pushName || numberOf(m.sender)}: ${String(m.body).slice(0, 200)}`);
    }

    if (!m.isOwner && m.body && m.body.startsWith(P()) && await isSudoSender(sock, m.sender)) {
        const name = m.body.slice(P().length).trim().split(/\s+/)[0].toLowerCase();
        m.isSudo = true;
        if (!DANGEROUS_FOR_SUDO.has(name)) m.isOwner = true;
    }
    return false;
};

module.exports = { applyFont, decorate };
