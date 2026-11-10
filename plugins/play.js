'use strict';
/**
 * POPKID play.js  —  .play with a "reply 1 / 2" card, plus direct mp3/mp4 commands.
 *
 *   .play <name or YouTube link>   -> thumbnail + info card, reply 1 = MP3, 2 = MP4
 *   .playmp3 / .song <name|link>   -> MP3 straight away
 *   .playmp4 / .playvideo <name>   -> MP4 straight away
 *   .ytmp3 / .yta <YouTube link>   -> MP3 from a link (link required)
 *
 * Download routes, tried in order (first success wins):
 *   1) yt-dlp            2) yt-dlp (tv_embedded client)
 *   3) yt-dlp (web_embedded client)   4) Invidious public instances (no key)
 *
 * No API keys are used or needed.
 *
 * Optional env vars:
 *   YTDLP_PATH      path to yt-dlp (otherwise PATH, otherwise auto-downloaded into ./tmp)
 *   FFMPEG_PATH     path to ffmpeg (otherwise @ffmpeg-installer, otherwise PATH)
 *   YTDLP_COOKIES   path to a cookies.txt (helps when YouTube blocks your server IP)
 *   MAX_DOWNLOAD_MB per-file cap, default 100
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const yts = require('yt-search');
const { cmd } = require('../arslan');

const execP = promisify(execFile);

/* ───────────────────────────── settings ───────────────────────────── */
const MAX_SECONDS = 20 * 60;                                   // refuse anything longer
const MAX_MB = Number(process.env.MAX_DOWNLOAD_MB) || 100;
const DOC_THRESHOLD = 60 * 1048576;                            // bigger than this -> send as a document
const PICK_TTL = 3 * 60 * 1000;                                // how long the 1/2 card stays active
const MAX_PARALLEL = 2;                                        // simultaneous downloads (protects small hosts)
const BIN_DIR = path.join(__dirname, '..', 'tmp');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const FFMPEG = (() => {
    if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
    try { return require('@ffmpeg-installer/ffmpeg').path; } catch { return 'ffmpeg'; }
})();

/* ───────────────────────────── small helpers ───────────────────────────── */
const TITLE = '┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗟𝗔𝗬* ◈';
const FOOTER = '> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗';
const box = (...lines) =>
    `${TITLE}\n┃\n${lines.filter(l => l !== null && l !== undefined).map(l => `┃${l}`).join('\n')}\n┃\n┗▣\n${FOOTER}`;

const clean = (s) => String(s || 'audio').replace(/[<>:"/\\|?*\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'audio';
const isUrl = (s) => /^https?:\/\//i.test(String(s || '').trim());
const YT_ID = /(?:youtube\.com\/(?:watch\?(?:\S*&)?v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/|music\.youtube\.com\/watch\?v=)([A-Za-z0-9_-]{11})/i;
const ytId = (u) => YT_ID.exec(String(u || ''))?.[1] || null;
const fmtDur = (sec) => {
    sec = Number(sec);
    if (!sec) return '';
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
};
const shortErr = (e) => {
    const s = String(e?.stderr || e?.message || e || '');
    const line = s.split('\n').find(l => /ERROR|rror/.test(l)) || s;
    return line.replace(/^ERROR:\s*/, '').slice(0, 160);
};
const rm = (...targets) => {
    for (const t of targets) { try { fs.rmSync(t, { recursive: true, force: true }); } catch { /* ignore */ } }
};
const finalError = (msg) => Object.assign(new Error(msg), { final: true }); // stop trying other routes

// tiny semaphore so a busy group can't start 20 yt-dlp processes at once
let running = 0;
const queue = [];
const acquire = () => new Promise((resolve) => {
    if (running < MAX_PARALLEL) { running++; return resolve(); }
    queue.push(resolve);
});
const release = () => {
    const next = queue.shift();
    if (next) next(); else running--;
};

/* ───────────────────────────── yt-dlp ───────────────────────────── */
let ytdlpReady = null;
function ensureYtdlp() {
    if (ytdlpReady) return ytdlpReady;
    ytdlpReady = (async () => {
        if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
        try { await execP('yt-dlp', ['--version']); return 'yt-dlp'; } catch { /* not on PATH */ }

        const isWin = process.platform === 'win32';
        const local = path.join(BIN_DIR, isWin ? 'yt-dlp.exe' : 'yt-dlp');
        try { await execP(local, ['--version']); return local; } catch { /* not downloaded yet */ }

        const asset = isWin ? 'yt-dlp.exe'
            : process.platform === 'darwin' ? 'yt-dlp_macos'
            : process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
        const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, {
            redirect: 'follow', signal: AbortSignal.timeout(120000)
        });
        if (!res.ok) throw new Error(`yt-dlp download failed (HTTP ${res.status})`);
        fs.mkdirSync(BIN_DIR, { recursive: true });
        fs.writeFileSync(local, Buffer.from(await res.arrayBuffer()));
        fs.chmodSync(local, 0o755);
        await execP(local, ['--version']);
        return local;
    })().catch((e) => { ytdlpReady = null; throw e; });
    return ytdlpReady;
}

async function viaYtdlp(target, kind, extra = [], via = 'yt-dlp') {
    const bin = await ensureYtdlp();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'popkid-play-'));
    const args = [
        '--no-playlist', '--no-warnings', '--no-progress',
        '--socket-timeout', '30', '--retries', '3',
        '--max-filesize', `${MAX_MB}M`,
        '--match-filter', `duration<=${MAX_SECONDS} & !is_live`,
        '-o', path.join(dir, '%(title).80B.%(ext)s'),
        '--print', 'after_move:filepath', '--no-simulate',
        ...extra
    ];
    if (FFMPEG !== 'ffmpeg') args.push('--ffmpeg-location', FFMPEG);
    if (process.env.YTDLP_COOKIES && fs.existsSync(process.env.YTDLP_COOKIES)) args.push('--cookies', process.env.YTDLP_COOKIES);

    const fmt = kind === 'audio'
        ? ['-f', 'ba[ext=m4a]/ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '5']
        : ['-f', 'b[ext=mp4][height<=720]/bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/b', '--merge-output-format', 'mp4'];

    try {
        const { stdout } = await execP(bin, [...fmt, ...args, target], { timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
        const printed = stdout.trim().split('\n').filter(Boolean).reverse().find(l => fs.existsSync(l));
        const file = printed || fs.readdirSync(dir).map(f => path.join(dir, f))[0];
        if (!file || !fs.existsSync(file)) throw new Error('No file was produced (too long, too big, or private?)');
        return { file, dir, via, title: path.basename(file).replace(/\.[^.]+$/, '') };
    } catch (e) {
        rm(dir);
        const msg = String(e?.stderr || e?.message || '');
        if (/File is larger|max-filesize/i.test(msg)) throw finalError(`File is bigger than ${MAX_MB}MB.`);
        if (/does not pass filter/i.test(msg)) throw finalError('Video is longer than 20 minutes (or live).');
        if (/Video unavailable|Private video|has been removed/i.test(msg)) throw finalError('This video is unavailable.');
        throw new Error(shortErr(msg || e));
    }
}

/* ───────────────────────────── Invidious fallback ───────────────────────────── */
const INV_KNOWN = [
    'https://yt.chocolatemoo53.com', 'https://inv.nadeko.net', 'https://invidious.nerdvpn.de',
    'https://yewtu.be', 'https://invidious.f5.si', 'https://iv.melmac.space', 'https://invidious.privacyredirect.com'
];
let invList = null, invAt = 0, invGood = null;

async function invidiousInstances() {
    if (invList && Date.now() - invAt < 3600000) return invList;
    let live = [];
    try {
        const r = await fetch('https://api.invidious.io/instances.json?sort_by=health', { signal: AbortSignal.timeout(10000) });
        const j = await r.json();
        live = j.filter(x => x[1]?.api && x[1]?.type === 'https').map(x => x[1].uri);
    } catch { /* use the built-in list */ }
    invList = [...new Set([...live, ...INV_KNOWN])];
    invAt = Date.now();
    return invList;
}

async function invTry(fn) {
    const list = await invidiousInstances();
    const order = invGood ? [invGood, ...list.filter(x => x !== invGood)] : list;
    let last;
    for (const base of order.slice(0, 8)) {
        try { const v = await fn(base); invGood = base; return v; }
        catch (e) { last = e; if (e.final) throw e; }
    }
    throw last || new Error('No Invidious instance responded');
}

async function fetchTo(url, file, headers = {}) {
    const r = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(240000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const limit = MAX_MB * 1048576;
    if ((+r.headers.get('content-length') || 0) > limit) throw finalError(`File is bigger than ${MAX_MB}MB.`);
    const out = fs.createWriteStream(file);
    let n = 0;
    try {
        for await (const chunk of r.body) {
            n += chunk.length;
            if (n > limit) throw finalError(`File is bigger than ${MAX_MB}MB.`);
            if (!out.write(chunk)) await new Promise(res => out.once('drain', res));
        }
    } catch (e) { out.destroy(); throw e; }
    await new Promise((res, rej) => out.end(err => (err ? rej(err) : res())));
    if (n < 10000) throw new Error('empty file');
}

const ffmpeg = (args) => execP(FFMPEG, ['-y', '-loglevel', 'error', ...args], { timeout: 180000 });

async function viaInvidious(id, kind) {
    return invTry(async (base) => {
        const r = await fetch(`${base}/api/v1/videos/${id}?local=true`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j) throw new Error(`${base} HTTP ${r.status}`);
        if (j.lengthSeconds > MAX_SECONDS) throw finalError('Video is longer than 20 minutes.');
        const abs = (u) => (u.startsWith('/') ? base + u : u);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'popkid-play-'));
        const title = clean(j.title);
        try {
            if (kind === 'audio') {
                const a = (j.adaptiveFormats || []).filter(f => /^audio\//.test(f.type || ''))
                    .sort((x, y) => (/mp4/.test(y.type) - /mp4/.test(x.type)) || ((+y.bitrate || 0) - (+x.bitrate || 0)))[0];
                if (!a?.url) throw new Error(`${base}: no audio stream`);
                const src = path.join(dir, 'src.' + (/webm/.test(a.type) ? 'webm' : 'm4a'));
                await fetchTo(abs(a.url), src);
                const mp3 = path.join(dir, title + '.mp3');
                await ffmpeg(['-i', src, '-vn', '-codec:a', 'libmp3lame', '-q:a', '5', mp3]);
                rm(src);
                return { file: mp3, dir, via: 'invidious', title: j.title || title };
            }
            const out = path.join(dir, title + '.mp4');
            const muxed = (j.formatStreams || []).filter(f => /mp4/.test(f.type || ''))
                .sort((x, y) => (parseInt(y.resolution) || 0) - (parseInt(x.resolution) || 0))
                .find(f => (parseInt(f.resolution) || 0) <= 720);
            if (muxed?.url) { await fetchTo(abs(muxed.url), out); return { file: out, dir, via: 'invidious', title: j.title || title }; }

            const vid = (j.adaptiveFormats || []).filter(f => /video\/mp4/.test(f.type || '') && /avc1/.test(f.type || ''))
                .sort((x, y) => (parseInt(y.resolution) || 0) - (parseInt(x.resolution) || 0))
                .find(f => (parseInt(f.resolution) || 0) <= 480);
            const aud = (j.adaptiveFormats || []).filter(f => /audio\/mp4/.test(f.type || ''))
                .sort((x, y) => (+y.bitrate || 0) - (+x.bitrate || 0))[0];
            if (!vid?.url || !aud?.url) throw new Error(`${base}: no video stream`);
            const vf = path.join(dir, 'v.mp4'), af = path.join(dir, 'a.m4a');
            await fetchTo(abs(vid.url), vf);
            await fetchTo(abs(aud.url), af);
            await ffmpeg(['-i', vf, '-i', af, '-c', 'copy', '-movflags', '+faststart', out]);
            rm(vf, af);
            return { file: out, dir, via: 'invidious', title: j.title || title };
        } catch (e) { rm(dir); throw e; }
    });
}

async function invidiousSearch(q) {
    return invTry(async (base) => {
        const r = await fetch(`${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12000) });
        const j = await r.json().catch(() => null);
        const v = Array.isArray(j) && j.find(x => x.videoId && (!x.lengthSeconds || x.lengthSeconds <= MAX_SECONDS));
        if (!v) throw new Error(`${base}: empty search`);
        return { id: v.videoId, title: v.title, author: v.author, seconds: v.lengthSeconds };
    });
}

/* ───────────────────────────── download-API fallback (audio only) ─────────────────────────────
 * Last resort when the host's IP is blocked by YouTube (common on Heroku/Render/etc).
 * Same services your previous play.js used. Override keys with env vars if you have your own.
 */
const RYUU_KEY = process.env.RYUU_API_KEY || 'ryuu-apis-9c049100c28fc39e1791732697814';
const ELLYTUBE_KEY = process.env.ELLYTUBE_API_KEY || 'Agustus2026';
const SIDY_KEY = process.env.SIDY_API_KEY || 'memberdycoders';
const QASIM_KEY = process.env.QASIM_API_KEY || 'xbps-install-Syu';

// APIs nest the link in different places, so look through every layer
const pickMedia = (data) => {
    if (!data || typeof data !== 'object') return null;
    const layers = [data?.result?.result, data?.result?.data, data?.data?.result, data?.result, data?.data, data];
    for (const layer of layers) {
        if (!layer || typeof layer !== 'object') continue;
        const link = layer.link || layer.url || layer.download || layer.downloadUrl || layer.download_url
            || layer.cdn || layer.media || layer.audio || layer.mp3 || layer.file?.url;
        if (link && typeof link === 'string' && /^https?:\/\//i.test(link)) {
            return { link, title: layer.title || data?.result?.title || data?.title };
        }
    }
    return null;
};

async function getJson(url, headers = {}, timeout = 90000) {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(timeout) });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`invalid JSON (HTTP ${r.status})`); }
    if (r.status === 401) throw new Error('API key invalid');
    if (r.status === 429) throw new Error('rate limited');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return data;
}

const API_PROVIDERS = [
    ['ellytube', async (u) => pickMedia(await getJson(`https://ellytube.web.id/api/v1/youtube/download?${new URLSearchParams({ url: u, type: 'audio', quality: '320kbps', apikey: ELLYTUBE_KEY })}`))],
    ['apiziaul', async (u) => pickMedia(await getJson(`https://apiziaul.vercel.app/api/downloader/ytmp3?url=${encodeURIComponent(u)}`))],
    ['ryuu', async (u) => pickMedia(await getJson(`https://api.ryuu-dev.my.id/downloader/youtube?url=${encodeURIComponent(u)}&format=mp3`, { 'X-RYUU-APIKEY': RYUU_KEY }))],
    ['sidycoders', async (u) => {
        const d = await getJson(`https://api.sidycoders.xyz/api/ytdl?url=${encodeURIComponent(u)}&format=mp3&apikey=${SIDY_KEY}`, {}, 60000);
        const link = d?.cdn || d?.result?.cdn || d?.url;
        return link ? { link, title: d?.title || d?.result?.title } : null;
    }],
    ['qasimdev', async (u) => pickMedia((await getJson(`https://api.qasimdev.dpdns.org/api/loaderto/download?${new URLSearchParams({ apiKey: QASIM_KEY, format: 'mp3', url: u })}`))?.data)]
];

async function viaApis(url, kind) {
    if (kind !== 'audio') throw new Error('no API fallback for video');
    const errs = [];
    for (const [name, get] of API_PROVIDERS) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'popkid-play-'));
        try {
            const media = await get(url);
            if (!media?.link) throw new Error('no media link');
            const file = path.join(dir, 'audio.mp3');
            await fetchTo(media.link, file, { Referer: 'https://ellytube.web.id/' });
            const head = fs.readFileSync(file).subarray(0, 64).toString('utf8').toLowerCase();
            if (head.includes('<!doctype') || head.includes('<html')) throw new Error('got a web page instead of audio');
            return { file, dir, via: 'api:' + name, title: media.title };
        } catch (e) {
            rm(dir);
            if (e.final) throw e;
            errs.push(`${name}: ${shortErr(e)}`);
        }
    }
    throw new Error(errs.join('; '));
}

/* ───────────────────────────── search + metadata ───────────────────────────── */
async function findVideo(query) {
    const q = String(query).trim();
    if (isUrl(q)) {
        const id = ytId(q);
        if (!id) throw finalError('Only YouTube links or song names are supported.');
        return videoInfo(id);
    }
    try {
        const res = await yts(q);
        const v = (res?.videos || []).find(x => !x.seconds || x.seconds <= MAX_SECONDS) || res?.videos?.[0];
        if (v) return { id: v.videoId, title: v.title, author: v.author?.name || '', seconds: v.seconds, thumb: v.thumbnail || thumbOf(v.videoId) };
    } catch (e) { console.error('[PLAY] yt-search failed:', e.message); }
    const v = await invidiousSearch(q).catch(() => null);
    if (!v) return null;
    return { ...v, thumb: thumbOf(v.id) };
}

const thumbOf = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

async function videoInfo(id) {
    const base = { id, title: 'YouTube audio', author: '', seconds: 0, thumb: thumbOf(id) };
    try {
        const v = await yts({ videoId: id });
        if (v?.title) return { ...base, title: v.title, author: v.author?.name || '', seconds: v.seconds || 0 };
    } catch { /* fall through to oEmbed */ }
    try {
        const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), { signal: AbortSignal.timeout(10000) });
        if (r.ok) { const j = await r.json(); return { ...base, title: j.title || base.title, author: j.author_name || '' }; }
    } catch { /* keep defaults */ }
    return base;
}

/* ───────────────────────────── download chain ───────────────────────────── */
let ytdlpUpdated = false;

async function download(id, kind) {
    const url = `https://www.youtube.com/watch?v=${id}`;
    const routes = [
        ['yt-dlp', () => viaYtdlp(url, kind)],
        ['yt-dlp tv', () => viaYtdlp(url, kind, ['--extractor-args', 'youtube:player_client=tv_embedded'], 'yt-dlp tv')],
        ['yt-dlp embedded', () => viaYtdlp(url, kind, ['--extractor-args', 'youtube:player_client=web_embedded'], 'yt-dlp embedded')],
        ['invidious', () => viaInvidious(id, kind)],
        ['api', () => viaApis(url, kind)]
    ];
    const errors = [];
    for (const [name, fn] of routes) {
        try {
            return await fn();
        } catch (e) {
            if (e.final) throw e;
            errors.push(`${name}: ${shortErr(e)}`);
            // YouTube changes break old yt-dlp builds: self-update once, then retry the first route
            if (name === 'yt-dlp' && !ytdlpUpdated && /Sign in|HTTP Error 4\d\d|Unable to extract|nsig|player/i.test(String(e.message))) {
                ytdlpUpdated = true;
                try { await execP(await ensureYtdlp(), ['-U'], { timeout: 120000 }); return await fn(); } catch { /* keep going */ }
            }
        }
    }
    console.error('[PLAY] all routes failed:', errors.join(' | '));
    throw Object.assign(new Error('Every download route failed right now. Try again in a minute or pick another song.'), { routes: errors });
}

async function withSlot(fn) {
    await acquire();
    try { return await fn(); } finally { release(); }
}

/* ───────────────────────────── delivery ───────────────────────────── */
async function deliver(m, r, kind, title) {
    const name = clean(r.title || title);
    const size = fs.statSync(r.file).size;
    if (kind === 'audio') {
        if (size > DOC_THRESHOLD) {
            return m.reply({ document: { url: r.file }, mimetype: 'audio/mpeg', fileName: `${name}.mp3`, caption: box('🎵 *' + name + '*', '➽ Large file, sent as a document.') });
        }
        return m.reply({ audio: { url: r.file }, mimetype: 'audio/mpeg', fileName: `${name}.mp3`, ptt: false });
    }
    if (size > DOC_THRESHOLD) {
        return m.reply({ document: { url: r.file }, mimetype: 'video/mp4', fileName: `${name}.mp4`, caption: box('🎬 *' + name + '*', '➽ Large file, sent as a document.') });
    }
    return m.reply({ video: { url: r.file }, mimetype: 'video/mp4', caption: box('🎬 *' + name + '*') });
}

// search/validate -> download -> send -> cleanup. Used by every command and by the 1/2 reply.
async function fetchAndSend(m, id, title, kind) {
    let r;
    try {
        r = await withSlot(() => download(id, kind));
        await deliver(m, r, kind, title);
        await m.react('✅');
    } finally {
        if (r?.dir) rm(r.dir);
    }
}

function fail(m, err, title = '❌ *𝗣𝗟𝗔𝗬 𝗘𝗥𝗥𝗢𝗥*') {
    console.error('[PLAY] Error:', err.message);
    const why = (m.isOwner || m.isDev) && err.routes?.length ? ['', '*Debug (owner only):*', ...err.routes.map(r => `➽ ${r.slice(0, 200)}`)] : [];
    return m.react('❌').catch(() => {}).then(() => m.reply(box(title, `➽ ${err.message}`, ...why)));
}

const getQuery = (m, args) => (args?.length ? args.join(' ').trim() : (m.quoted?.body || '').trim());
const usage = (prefix, name, extra = '') => box(
    '🎵 *𝗠𝗨𝗦𝗜𝗖 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥*',
    '➽ Enter a song name or YouTube link.',
    '',
    '📌 *𝗘𝗫𝗔𝗠𝗣𝗟𝗘𝗦*',
    `➽ ${prefix}${name} harlem shake`,
    `➽ ${prefix}${name} https://youtu.be/dQw4w9WgXcQ`,
    extra || null
);

/* ───────────────────────────── pending "reply 1 / 2" cards ───────────────────────────── */
const pending = new Map();   // "chat|sender" -> { id, title, cardId, until }
const handled = new Set();   // message ids already processed (the hook fires once per alias)
const busy = new Set();      // "chat|sender" with a download in progress
const pkey = (m) => `${m.from}|${m.sender || ''}`;

function sweep() {
    const now = Date.now();
    for (const [k, v] of pending) if (v.until < now) pending.delete(k);
    if (handled.size > 500) handled.clear();
}

const parsePick = (text) => {
    const t = String(text || '').trim().toLowerCase();
    if (['1', 'mp3', 'audio'].includes(t)) return 'audio';
    if (['2', 'mp4', 'video'].includes(t)) return 'video';
    return null;
};

/* ───────────────────────────── commands ───────────────────────────── */
const registered = cmd({
    pattern: 'play',
    name: 'play',
    category: 'Downloaders',
    aliases: ['ply', 'playy', 'pl'],
    description: 'Search YouTube: info card, then reply 1 = MP3 / 2 = MP4',
    react: '🎵',
    filename: __filename
}, async (sock, m, args) => {
    const prefix = global.BOT_PREFIX || '.';
    const query = getQuery(m, args);
    if (!query) return m.reply(usage(prefix, 'play'));
    if (query.length > 150) return m.reply(box('❌ *𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗤𝗨𝗘𝗥𝗬*', '➽ Keep it under 150 characters.'));

    try {
        await m.react('🔎');
        const v = await findVideo(query);
        if (!v) { await m.react('❌'); return m.reply(box('❌ *𝗡𝗢 𝗥𝗘𝗦𝗨𝗟𝗧𝗦*', `➽ No song found for: ${query}`)); }
        if (v.seconds > MAX_SECONDS) { await m.react('❌'); return m.reply(box('❌ *𝗧𝗢𝗢 𝗟𝗢𝗡𝗚*', `➽ ${v.title} is ${fmtDur(v.seconds)}.`, '➽ Max allowed is 20 minutes.')); }

        const caption = box(
            '🎵 *𝗦𝗢𝗡𝗚*',
            `➽ ${v.title}`,
            v.author ? `➽ 👤 ${v.author}` : null,
            v.seconds ? `➽ ⏱️ ${fmtDur(v.seconds)}` : null,
            `➽ 🔗 https://youtu.be/${v.id}`,
            '',
            '*Reply with:*',
            '1️⃣ = MP3 (audio) 🎧',
            '2️⃣ = MP4 (video) 🎬'
        );
        let sent;
        try { sent = await m.reply({ image: { url: v.thumb || thumbOf(v.id) }, caption }); }
        catch { sent = await m.reply(caption); }

        sweep();
        pending.set(pkey(m), { id: v.id, title: v.title, cardId: sent?.key?.id, until: Date.now() + PICK_TTL });
        await m.react('✅');
    } catch (err) { await fail(m, err); }
});

// "1" / "2" (or mp3 / mp4) answers the card. Same hook style as plugins/video.js.
registered.onMessage = async (sock, m) => {
    try {
        const kind = parsePick(m.body);
        if (!kind) return false;

        const k = pkey(m);
        const p = pending.get(k);
        if (!p) return false;
        if (p.until < Date.now()) { pending.delete(k); return false; }

        // If they replied to a specific message, it must be this card (so video.js menus aren't hijacked)
        const quotedId = m.quoted?.key?.id;
        if (quotedId && p.cardId && quotedId !== p.cardId) return false;

        if (handled.has(m.id)) return true;     // alias duplicate of the same reply
        handled.add(m.id);

        if (busy.has(k)) { await m.reply(box('⏳ *𝗕𝗨𝗦𝗬*', '➽ Your last download is still running.')); return true; }
        busy.add(k);
        pending.delete(k);

        try {
            await m.react('⏳');
            await m.reply(box(`📥 *${kind === 'audio' ? 'MP3' : 'MP4'}*`, `➽ ${p.title}`, '➽ Downloading... please wait.'));
            await fetchAndSend(m, p.id, p.title, kind);
        } catch (err) {
            pending.set(k, { ...p, until: Date.now() + PICK_TTL });   // allow another try
            await fail(m, err);
        } finally { busy.delete(k); }
        return true;
    } catch (err) {
        console.error('[PLAY] onMessage error:', err.message);
        return false;
    }
};

// Direct commands (no card): name, aliases, kind, linkOnly
function direct(pattern, aliases, kind, desc, linkOnly = false) {
    cmd({
        pattern, name: pattern, category: 'Downloaders', aliases, description: desc, react: kind === 'audio' ? '🎧' : '🎬', filename: __filename
    }, async (sock, m, args) => {
        const prefix = global.BOT_PREFIX || '.';
        const query = getQuery(m, args);
        if (!query) return m.reply(usage(prefix, pattern));
        if (query.length > 150) return m.reply(box('❌ *𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗤𝗨𝗘𝗥𝗬*', '➽ Keep it under 150 characters.'));
        if (linkOnly && !ytId(query)) return m.reply(box('❌ *𝗟𝗜𝗡𝗞 𝗡𝗘𝗘𝗗𝗘𝗗*', `➽ Use: ${prefix}${pattern} <YouTube link>`));

        const k = pkey(m);
        if (busy.has(k)) return m.reply(box('⏳ *𝗕𝗨𝗦𝗬*', '➽ Your last download is still running.'));
        busy.add(k);
        try {
            await m.react('⏳');
            const v = await findVideo(query);
            if (!v) { await m.react('❌'); return m.reply(box('❌ *𝗡𝗢 𝗥𝗘𝗦𝗨𝗟𝗧𝗦*', `➽ No result for: ${query}`)); }
            if (v.seconds > MAX_SECONDS) { await m.react('❌'); return m.reply(box('❌ *𝗧𝗢𝗢 𝗟𝗢𝗡𝗚*', `➽ ${v.title} is ${fmtDur(v.seconds)}.`, '➽ Max allowed is 20 minutes.')); }
            await m.reply(box(`📥 *${kind === 'audio' ? 'MP3' : 'MP4'}*`, `➽ ${v.title}`, '➽ Downloading... please wait.'));
            await fetchAndSend(m, v.id, v.title, kind);
        } catch (err) { await fail(m, err); }
        finally { busy.delete(k); }
    });
}

direct('playmp3', ['song', 'music', 'songmp3'], 'audio', 'Song straight to MP3 (no card)');
direct('playmp4', ['playvideo', 'songvideo'], 'video', 'Song straight to MP4 (no card)');
direct('ytmp3', ['yta'], 'audio', 'MP3 from a YouTube link', true);
