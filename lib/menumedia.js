'use strict';
/**
 * Menu picture / video picker (used by plugins/menu.js).
 *
 * Tries, in this order, and silently skips anything that is dead:
 *   1. a random video / image saved in the settings lists  (menuVideos / menuImages)
 *   2. global.menuImage            (a link, or a file saved by .setmenuimg)
 *   3. data/menu-image.jpg         (local copy)
 *   4. data/menu-cache.jpg         (last remote picture that downloaded fine)
 *   5. data/menu-default.jpg       (bundled with the bot, always there)
 *
 * Remote pictures are cached in memory, so after the first .menu it is instant,
 * and a link that failed is not retried for 30 minutes.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

let settings = null;
try { settings = require('./settings'); } catch { /* the lists are optional */ }

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'menu-cache.jpg');
const DEFAULT_FILE = path.join(DATA_DIR, 'menu-default.jpg');

const FETCH_TIMEOUT = 4000;           // per remote picture
const BUDGET_MS = 8000;               // total time allowed to find one
const FAIL_TTL = 30 * 60 * 1000;      // a failed link is skipped for this long
const MEM_TTL = 60 * 60 * 1000;       // re-download a remote picture after an hour
const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

const memCache = new Map();   // url -> { kind, buffer, fetched }
const failed = new Map();     // url -> retry-after timestamp

/** Look at the first bytes so an HTML error page is never mistaken for a picture. */
function sniff(b) {
    if (!b || b.length < 12) return null;
    if (b[0] === 0xFF && b[1] === 0xD8) return 'image';                                      // jpeg
    if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return 'image';                // png
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image';
    if (b.toString('ascii', 0, 3) === 'GIF') return 'image';
    if (b.toString('ascii', 4, 8) === 'ftyp') return 'video';                                // mp4 / mov
    return null;
}

async function fetchRemote(url, timeout) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout,
        maxContentLength: 25 * 1024 * 1024,
        headers: { 'User-Agent': UA, Accept: 'image/*,video/*,*/*' }
    });
    const buffer = Buffer.from(res.data);
    const kind = sniff(buffer);
    if (!kind) throw new Error('not a picture or video');

    if (memCache.size >= 20 && !memCache.has(url)) memCache.delete(memCache.keys().next().value);
    memCache.set(url, { kind, buffer, fetched: Date.now() });
    failed.delete(url);

    if (kind === 'image' && buffer.length < 5 * 1024 * 1024) {
        try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(CACHE_FILE, buffer); } catch { /* cache is optional */ }
    }
    return { kind, buffer };
}

async function loadSource(src, deadline) {
    if (/^https?:\/\//i.test(src)) {
        const hit = memCache.get(src);
        if (hit) {
            if (Date.now() - hit.fetched > MEM_TTL) fetchRemote(src, 15000).catch(() => {}); // refresh quietly
            return { kind: hit.kind, buffer: hit.buffer };
        }
        if ((failed.get(src) || 0) > Date.now()) throw new Error('failed recently, skipped');
        try {
            return await fetchRemote(src, Math.max(3000, Math.min(FETCH_TIMEOUT, deadline - Date.now())));
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
    const shuffle = a => a.slice().sort(() => Math.random() - 0.5);
    const out = [];
    try {
        if (settings) {
            if (!imageOnly) shuffle(settings.list('menuVideos')).forEach(s => out.push(s));
            shuffle(settings.list('menuImages')).forEach(s => out.push(s));
        }
    } catch { /* ignore */ }
    if (global.menuImage) out.push(global.menuImage);
    out.push(path.join(DATA_DIR, 'menu-image.jpg'), CACHE_FILE, DEFAULT_FILE);
    return [...new Set(out)];
}

/**
 * @param {string}  [skipSrc]    a source that just failed to send, so pick another
 * @param {boolean} [imageOnly]  never return a video
 * @returns {Promise<{kind:'image'|'video', buffer:Buffer, src:string}|null>}
 */
async function pickMenuMedia(skipSrc, imageOnly) {
    const deadline = Date.now() + BUDGET_MS;
    for (const src of candidates(imageOnly)) {
        if (src === skipSrc) continue;
        // out of time: only instant local files from here on
        if (Date.now() > deadline && /^https?:\/\//i.test(src)) continue;
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

// Warm the cache shortly after boot so the very first .menu is already instant.
setTimeout(() => {
    const deadline = Date.now() + 20000;
    candidates(false)
        .filter(s => /^https?:\/\//i.test(s))
        .forEach(s => loadSource(s, deadline).catch(() => {}));
}, 3000).unref?.();

module.exports = { pickMenuMedia };
