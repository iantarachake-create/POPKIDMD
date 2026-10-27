'use strict';
const fs = require('fs');
const axios = require('axios');
const settings = require('./settings');

async function load(src) {
    if (/^https?:\/\//i.test(src)) {
        const res = await axios.get(src, { responseType: 'arraybuffer', timeout: 15000 });
        return Buffer.from(res.data);
    }
    return fs.readFileSync(src);
}

/**
 * Chooses what the .menu shows:
 *   1. a random menu video (if any were added)  -> played like a GIF
 *   2. else a random menu image (if any added)
 *   3. else the classic single global.menuImage
 * Dead entries are skipped automatically.
 */
async function pickMenuMedia() {
    const tries = [];
    const videos = settings.list('menuVideos').slice();
    const images = settings.list('menuImages').slice();
    const shuffle = a => a.sort(() => Math.random() - 0.5);
    shuffle(videos).forEach(v => tries.push({ kind: 'video', src: v }));
    shuffle(images).forEach(v => tries.push({ kind: 'image', src: v }));
    if (global.menuImage) tries.push({ kind: 'image', src: global.menuImage });

    for (const t of tries) {
        try {
            const buffer = await load(t.src);
            if (buffer && buffer.length > 500) return { kind: t.kind, buffer };
        } catch { /* try next */ }
    }
    return null;
}

module.exports = { pickMenuMedia };
