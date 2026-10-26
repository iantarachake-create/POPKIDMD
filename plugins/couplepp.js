'use strict';
const axios = require('axios');
const { cmd } = require('../arslan');

const UA = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' };
const JSON_URLS = [
    'https://raw.githubusercontent.com/KazukoGans/database/main/anime/ppcouple.json',
    'https://raw.githubusercontent.com/Dev-Moonlight/database/main/anime/ppcouple.json'
];

async function download(url) {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, headers: UA });
    const buf = Buffer.from(res.data);
    if (buf.length < 1500) throw new Error('image too small');
    return buf;
}

async function fromJson() {
    for (const u of JSON_URLS) {
        try {
            const { data } = await axios.get(u, { timeout: 20000, headers: UA });
            const list = typeof data === 'string' ? JSON.parse(data) : data;
            if (!Array.isArray(list) || !list.length) continue;
            const pick = list[Math.floor(Math.random() * list.length)];
            const [boy, girl] = await Promise.all([download(pick.cowo), download(pick.cewe)]);
            return { boy, girl };
        } catch { /* try next source */ }
    }
    throw new Error('json sources failed');
}

// Fallback: two random general-rated matching-icon images from Danbooru
async function fromDanbooru() {
    const { data } = await axios.get('https://danbooru.donmai.us/posts.json', {
        params: { tags: 'matching_icons rating:g filetype:jpg,png', limit: 40, random: true },
        timeout: 20000, headers: UA
    });
    const urls = (data || []).map(p => p.large_file_url || p.file_url).filter(Boolean);
    if (urls.length < 2) throw new Error('danbooru: not enough images');
    const [a, b] = [urls[0], urls[1]];
    const [boy, girl] = await Promise.all([download(a), download(b)]);
    return { boy, girl };
}

cmd({
    pattern: 'ppcouple',
    name: 'ppcouple',
    alias: ['ppcp', 'couplepp'],
    category: 'Fun',
    desc: 'Random anime couple profile pictures',
    react: '💞',
    filename: __filename
}, async (sock, m) => {
    let pair, lastErr;
    for (const src of [fromJson, fromDanbooru]) {
        try { pair = await src(); break; } catch (err) { lastErr = err; }
    }
    if (!pair) {
        console.error('ppcouple error:', lastErr?.message);
        return m.reply('❌ Could not fetch couple pictures right now. Try again shortly.');
    }
    await m.reply(pair.boy, { caption: '> 👦 Boy' });
    await m.reply(pair.girl, { caption: '> 👧 Girl' });
});
