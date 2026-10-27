'use strict';
const fs = require('fs');
const path = require('path');
const { cmd } = require('../arslan');
const settings = require('../lib/settings');
const { P, isOwner, box } = require('../lib/cmdutil');

const MEDIA_DIR = path.join(process.cwd(), 'data', 'menu-media');
const DEFAULT_IMAGE = 'https://i.ibb.co/GQNSbb6D/IMG-20260921-WA0012.jpg';

/** Get a URL or a saved local file from: a URL argument, a quoted media, or the message's own media. */
async function resolveSource(m, args, kind) {
    const url = args.find(a => /^https?:\/\//i.test(a));
    if (url) return url;

    const wantType = kind === 'image' ? ['imageMessage'] : ['videoMessage'];
    let target = null;
    if (m.quoted && wantType.includes(m.quoted.type)) target = m.quoted;
    else if (wantType.includes(m.type)) target = m;
    if (!target) return null;

    const buffer = await target.download();
    if (!buffer || !buffer.length) throw new Error('could not download the media');
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const file = path.join(MEDIA_DIR, `${kind}-${Date.now()}.${kind === 'image' ? 'jpg' : 'mp4'}`);
    fs.writeFileSync(file, buffer);
    return file;
}

function removeFiles(list) {
    for (const f of list) {
        if (!/^https?:\/\//i.test(f) && f.startsWith(MEDIA_DIR)) { try { fs.unlinkSync(f); } catch {} }
    }
}

function usage(name, kind) {
    return box(`𝗣𝗢𝗣𝗞𝗜𝗗 ${name.toUpperCase()}`, [
        `➽ Reply to a ${kind} with ${P()}${name}`,
        `➽ or: ${P()}${name} <https://link>`
    ]);
}

for (const kind of ['image', 'video']) {
    const key = kind === 'image' ? 'menuImages' : 'menuVideos';

    cmd({
        pattern: `addmenu${kind}`, name: `addmenu${kind}`, category: 'Settings',
        desc: `Add a ${kind} to the menu rotation`, react: '➕', filename: __filename
    }, async (sock, m, args) => {
        if (!isOwner(m)) return m.reply('❌ Owner only.');
        try {
            const src = await resolveSource(m, args, kind);
            if (!src) return m.reply(usage(`addmenu${kind}`, kind));
            settings.list(key).push(src);
            settings.save();
            return m.reply(`✅ Menu ${kind} added. Now ${settings.list(key).length} in rotation.`);
        } catch (e) { return m.reply(`❌ Failed: ${e.message}`); }
    });

    cmd({
        pattern: `setmenu${kind}`, name: `setmenu${kind}`, category: 'Settings',
        desc: `Use only this ${kind} for the menu`, react: '🖼️', filename: __filename
    }, async (sock, m, args) => {
        if (!isOwner(m)) return m.reply('❌ Owner only.');
        try {
            const src = await resolveSource(m, args, kind);
            if (!src) return m.reply(usage(`setmenu${kind}`, kind));
            removeFiles(settings.list(key));
            settings.list(key).length = 0;
            settings.list(key).push(src);
            if (kind === 'image') global.menuImage = src;
            settings.save();
            return m.reply(`✅ Menu ${kind} set. Send ${P()}menu to see it.`);
        } catch (e) { return m.reply(`❌ Failed: ${e.message}`); }
    });

    cmd({
        pattern: `clearmenu${kind}s`, name: `clearmenu${kind}s`, category: 'Settings',
        desc: `Remove all custom menu ${kind}s`, react: '🧹', filename: __filename
    }, async (sock, m) => {
        if (!isOwner(m)) return m.reply('❌ Owner only.');
        const old = settings.list(key).slice();
        removeFiles(old);
        settings.list(key).length = 0;
        if (kind === 'image') {
            global.menuImage = DEFAULT_IMAGE;
            try { fs.unlinkSync(path.join(process.cwd(), 'data', 'menuimage.json')); } catch {}
        }
        settings.save();
        return m.reply(`✅ Cleared ${old.length} custom menu ${kind}(s).${kind === 'image' ? ' Default image restored.' : ''}`);
    });
}

cmd({
    pattern: 'menustyle', name: 'menustyle', category: 'Settings',
    desc: 'Menu look: 1 = media + full list, 2 = text only, 3 = media + compact list', react: '🎛️', filename: __filename
}, async (sock, m, args) => {
    if (!isOwner(m)) return m.reply('❌ Owner only.');
    if (!args[0]) {
        return m.reply(box('𝗠𝗘𝗡𝗨 𝗦𝗧𝗬𝗟𝗘', [
            `➽ Current: ${settings.get('menustyle')}`,
            '➽ 1 = image/video + full list',
            '➽ 2 = text only',
            '➽ 3 = image/video + compact list',
            `➽ Use: ${P()}menustyle 1|2|3`
        ]));
    }
    try {
        const v = settings.set('menustyle', args[0]);
        global.menuStyle = v;
        return m.reply(`✅ Menu style set to ${v}.`);
    } catch (e) { return m.reply(`❌ ${e.message}`); }
});

// restore saved style on boot
global.menuStyle = settings.get('menustyle');
