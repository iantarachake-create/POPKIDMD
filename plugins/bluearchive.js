'use strict';
const axios = require('axios');
const { cmd } = require('../arslan');

const UA = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' };

async function download(url) {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, headers: UA });
    const buf = Buffer.from(res.data);
    if (buf.length < 1500) throw new Error('image too small');
    return buf;
}

// Source 1: old rebix API (may return an image directly or JSON)
async function fromRebix() {
    const res = await axios.get('https://api-rebix.zone.id/api/bluearchive', {
        responseType: 'arraybuffer', timeout: 20000, headers: UA
    });
    const type = String(res.headers['content-type'] || '');
    if (type.startsWith('image/')) return Buffer.from(res.data);
    const json = JSON.parse(Buffer.from(res.data).toString('utf8'));
    const url = json.url || json.result || json.image || json.data?.url;
    if (!url) throw new Error('rebix: no image url');
    return download(url);
}

// Source 2: Danbooru, general-rated (safe) Blue Archive art
async function fromDanbooru() {
    const res = await axios.get('https://danbooru.donmai.us/posts/random.json', {
        params: { tags: 'blue_archive rating:g filetype:jpg,png' },
        timeout: 20000, headers: UA
    });
    const url = res.data.large_file_url || res.data.file_url;
    if (!url) throw new Error('danbooru: no file url');
    return download(url);
}

cmd({
    pattern: 'bluearchive',
    name: 'bluearchive',
    alias: ['ba', 'blue'],
    category: 'Fun',
    desc: 'Random Blue Archive image',
    react: '💙',
    filename: __filename
}, async (sock, m) => {
    const sources = [fromDanbooru, fromRebix];
    let lastErr;
    for (const src of sources) {
        for (let i = 0; i < 2; i++) {
            try {
                const buffer = await src();
                return await m.reply(buffer, { caption: '💙 *Blue Archive*\n> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗' });
            } catch (err) { lastErr = err; }
        }
    }
    console.error('bluearchive error:', lastErr?.message);
    return m.reply('❌ Could not fetch a Blue Archive image right now. Try again shortly.');
});
