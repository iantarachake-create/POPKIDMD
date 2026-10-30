const axios = require('axios');
const yts = require('yt-search');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const exec = promisify(execFile);
const { cmd } = require('../arslan');

const MAX_SECONDS = 1200;            // 20 min cap
const MAX_BYTES = 16 * 1024 * 1024;  // WhatsApp audio size limit
const BIN_DIR = path.join(__dirname, '..', 'tmp');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ffmpeg: env var, then the bundled @ffmpeg-installer binary, then whatever is on PATH
const FFMPEG = (() => {
    if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
    try { return require('@ffmpeg-installer/ffmpeg').path; } catch { return 'ffmpeg'; }
})();

// ---------- yt-dlp (downloaded automatically the first time if the host doesn't have it) ----------
let ytdlpReady = null;
const ensureYtdlp = () => {
    if (ytdlpReady) return ytdlpReady;
    ytdlpReady = (async () => {
        if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
        try { await exec('yt-dlp', ['--version']); return 'yt-dlp'; } catch { /* not installed */ }

        const isWin = process.platform === 'win32';
        const local = path.join(BIN_DIR, isWin ? 'yt-dlp.exe' : 'yt-dlp');
        try { await exec(local, ['--version']); return local; } catch { /* not downloaded yet */ }

        const asset = isWin ? 'yt-dlp.exe'
            : process.platform === 'darwin' ? 'yt-dlp_macos'
            : process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
        fs.mkdirSync(BIN_DIR, { recursive: true });
        const { data } = await axios.get(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, {
            responseType: 'arraybuffer', timeout: 120000, maxRedirects: 5
        });
        fs.writeFileSync(local, Buffer.from(data));
        fs.chmodSync(local, 0o755);
        await exec(local, ['--version']);
        return local;
    })().catch((e) => { ytdlpReady = null; throw e; });
    return ytdlpReady;
};

const encode = (input, output, bitrate) => exec(FFMPEG, [
    '-y', '-i', input, '-vn', '-t', String(MAX_SECONDS),
    '-c:a', 'libmp3lame', '-b:a', bitrate, '-ac', '2', '-ar', '44100', output
], { timeout: 180000, maxBuffer: 8 * 1024 * 1024 });

// Download the audio with yt-dlp and convert it to mp3 (under the WhatsApp size limit)
const downloadLocal = async (url) => {
    const bin = await ensureYtdlp();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'popkid-play-'));
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });

    try {
        const args = [
            '--no-playlist', '--no-warnings', '--no-progress', '--print-json',
            '-f', 'bestaudio/best',
            '-x', '--audio-format', 'mp3', '--audio-quality', '128K',
            '--max-filesize', '120M',
            '--match-filter', `duration<=${MAX_SECONDS}`,
            '-o', path.join(dir, 'src.%(ext)s'),
        ];
        if (FFMPEG !== 'ffmpeg') args.push('--ffmpeg-location', FFMPEG);
        // Optional: a cookies.txt file helps when YouTube blocks the server's IP
        if (process.env.YTDLP_COOKIES && fs.existsSync(process.env.YTDLP_COOKIES)) args.push('--cookies', process.env.YTDLP_COOKIES);
        args.push(url);

        let res;
        try {
            res = await exec(bin, args, { timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
        } catch (err) {
            const msg = String(err?.stderr || err?.message || '');
            console.error('yt-dlp error:', msg.slice(0, 600));
            const e = new Error(/does not pass filter/i.test(msg) ? 'Song is longer than 20 minutes.'
                : /Video unavailable|Private video/i.test(msg) ? 'Track unavailable on YouTube.'
                : 'yt-dlp could not download this track.');
            e.raw = msg;
            throw e;
        }

        const file = fs.readdirSync(dir).find(f => f.endsWith('.mp3'));
        if (!file) throw new Error('No audio file was produced.');
        const raw = path.join(dir, file);

        let size = fs.statSync(raw).size;
        for (const rate of ['96k', '64k']) {
            if (size <= MAX_BYTES) break;
            const out = path.join(dir, `out_${rate}.mp3`);
            await encode(raw, out, rate);
            fs.renameSync(out, raw);
            size = fs.statSync(raw).size;
        }
        if (size > MAX_BYTES) throw new Error('File is too big even after compression.');

        let info = {};
        try { info = JSON.parse(String(res.stdout).trim().split('\n').filter(Boolean).pop() || '{}'); } catch { info = {}; }

        return { buffer: fs.readFileSync(raw), title: info.track || info.title, cleanup };
    } catch (err) {
        cleanup();
        throw err;
    }
};

// yt-dlp breaks whenever YouTube changes; update it once and retry if that looks like the cause
let updated = false;
const localAudio = async (url) => {
    try {
        return await downloadLocal(url);
    } catch (err) {
        if (!updated && /Sign in|HTTP Error 4\d\d|Unable to extract|nsig|player/i.test(err.raw || '')) {
            updated = true;
            try { await exec(await ensureYtdlp(), ['-U'], { timeout: 120000 }); } catch { /* ignore */ }
            return await downloadLocal(url);
        }
        throw err;
    }
};

// ---------- fallback: download APIs (used only if yt-dlp fails) ----------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const RYUU_KEY = process.env.RYUU_API_KEY || 'ryuu-apis-9c049100c28fc39e1791732697814';
const ELLYTUBE_KEY = process.env.ELLYTUBE_API_KEY || 'Agustus2026';

// Different APIs nest the link in different places, so look through every layer
const pickMedia = (data) => {
    if (!data || typeof data !== 'object') return null;
    const layers = [data?.result?.result, data?.result?.data, data?.data?.result, data?.result, data?.data, data];
    for (const layer of layers) {
        if (!layer || typeof layer !== 'object') continue;
        const link = layer.link || layer.url || layer.download || layer.downloadUrl || layer.download_url
            || layer.cdn || layer.media || layer.audio || layer.mp3 || layer.file?.url;
        if (link && typeof link === 'string' && (/^https?:\/\//i.test(link) || link.startsWith('/'))) {
            return { link, title: layer.title || data?.result?.title || data?.title };
        }
    }
    return null;
};

const fetchJson = async (url, headers = {}, timeout = 90000) => {
    const res = await axios.get(url, {
        headers: { Accept: 'application/json', 'User-Agent': UA, ...headers },
        timeout, validateStatus: () => true, responseType: 'text', transformResponse: (r) => r
    });
    let data;
    try { data = JSON.parse(res.data); } catch { throw new Error(`invalid JSON (${res.status})`); }
    if (res.status === 401) throw new Error('API key invalid');
    if (res.status === 429) throw new Error('API rate limited');
    return { ok: res.status >= 200 && res.status < 300, status: res.status, data };
};

// Some APIs hand back links that need a Referer (or return an HTML error page), so download the file ourselves
const downloadBuffer = async (link) => {
    const res = await axios.get(link, {
        headers: { 'User-Agent': UA, Accept: '*/*', Referer: 'https://ellytube.web.id/' },
        responseType: 'arraybuffer', timeout: 120000, maxContentLength: 64 * 1024 * 1024,
        validateStatus: () => true
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`Media download failed: ${res.status}`);
    const buf = Buffer.from(res.data);
    const sample = buf.slice(0, 64).toString('utf8').toLowerCase();
    if (sample.includes('<!doctype') || sample.includes('<html')) throw new Error('Link returned HTML instead of audio');
    if (buf.length < 10000) throw new Error(`Media file too small (${buf.length} bytes)`);
    return buf;
};

const PROVIDERS = [
    {
        name: 'ellytube',
        get: async (url) => {
            const qs = new URLSearchParams({ url, type: 'audio', quality: '320kbps', apikey: ELLYTUBE_KEY }).toString();
            const { ok, status, data } = await fetchJson(`https://ellytube.web.id/api/v1/youtube/download?${qs}`, {}, 95000);
            if (!ok || data?.status === false) throw new Error(`EllyTube HTTP ${status}`);
            return pickMedia(data);
        }
    },
    {
        name: 'apiziaul',
        get: async (url) => {
            try {
                const { ok, data } = await fetchJson(`https://apiziaul.vercel.app/api/downloader/ytmp3?url=${encodeURIComponent(url)}`);
                const media = ok && pickMedia(data);
                if (media) return media;
            } catch { /* try the second endpoint */ }
            const { ok, status, data } = await fetchJson(`https://apiziaul.vercel.app/api/downloader/ytplaymp3?query=${encodeURIComponent(url)}`);
            if (!ok) throw new Error(`apiziaul HTTP ${status}`);
            return pickMedia(data);
        }
    },
    {
        name: 'ryuu',
        get: async (url) => {
            const { ok, status, data } = await fetchJson(
                `https://api.ryuu-dev.my.id/downloader/youtube?url=${encodeURIComponent(url)}&format=mp3`,
                { 'X-RYUU-APIKEY': RYUU_KEY }, 95000);
            if (!ok) throw new Error(`Ryuu HTTP ${status}`);
            return pickMedia(data);
        }
    },
    {
        name: 'sidycoders',
        get: async (url) => {
            const { ok, status, data } = await fetchJson(
                `https://api.sidycoders.xyz/api/ytdl?url=${encodeURIComponent(url)}&format=mp3&apikey=memberdycoders`, {}, 60000);
            if (!ok) throw new Error(`sidy HTTP ${status}`);
            const link = data?.cdn || data?.result?.cdn || data?.url;
            return link ? { link, title: data?.title || data?.result?.title } : null;
        }
    },
    {
        // Vevioz REST API v1: create a job, then poll it until the link is ready
        name: 'vevioz',
        get: async (url) => {
            const API = 'https://api.vevioz.com/api/v1/jobs';
            const created = await axios.post(API, { url, format: 'mp3' }, { timeout: 30000 });
            const first = created.data?.data || created.data;
            if (pickMedia(first)) return pickMedia(first);

            const id = first?.job_id || first?.id;
            const token = first?.token || first?.access_token;
            if (!id) throw new Error('Vevioz did not return a job id.');

            for (let i = 0; i < 20; i++) {
                await wait(3000);
                const { data } = await axios.get(`${API}/${id}`, { params: { token }, timeout: 30000 });
                const job = data?.data || data;
                if (pickMedia(job)) return pickMedia(job);
                if (['failed', 'error', 'cancelled'].includes(String(job?.status || '').toLowerCase())) {
                    throw new Error(job?.error || job?.message || 'Vevioz job failed.');
                }
            }
            throw new Error('Vevioz job timed out.');
        }
    },
    {
        name: 'qasimdev',
        get: async (url) => {
            const { data } = await axios.get('https://api.qasimdev.dpdns.org/api/loaderto/download', {
                params: { apiKey: 'xbps-install-Syu', format: 'mp3', url },
                timeout: 90000,
            });
            return pickMedia(data?.data);
        }
    },
];

// Try every source in order; the first one that gives a real audio file wins
const apiAudio = async (url) => {
    const errors = [];
    for (const provider of PROVIDERS) {
        try {
            const media = await provider.get(url);
            if (!media?.link) throw new Error('no media link');
            const link = media.link.startsWith('/') ? 'https://api.vevioz.com' + media.link : media.link;
            const buffer = await downloadBuffer(link);
            return { buffer, title: media.title };
        } catch (e) {
            console.error(`Play provider failed [${provider.name}]:`, e.message);
            errors.push(`${provider.name}: ${e.message}`);
        }
    }
    throw new Error(`All download sources failed (${errors.join(' | ')})`.slice(0, 400));
};

const TITLE = '┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗟𝗔𝗬* ◈';
const FOOTER = '> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗';
const box = (...lines) =>
    `${TITLE}\n┃\n${lines.filter(l => l !== null && l !== undefined).map(l => `┃${l}`).join('\n')}\n┃\n┗▣\n${FOOTER}`;
const clean = (s) => String(s || 'song').replace(/[<>:"/\\|?*\n\r]/g, '_').trim().slice(0, 100);

cmd({
    pattern: 'play',
    name: 'play',
    category: 'Downloaders',
    aliases: ['ply', 'playy', 'pl', 'song'],
    description: 'Search YouTube and get a song as audio',
    filename: __filename
}, async (sock, m, args) => {
    const prefix = global.BOT_PREFIX || '.';
    const query = args && args.length ? args.join(' ').trim() : (m.quoted?.body || '').trim();

    if (!query) {
        return m.reply(box(
            '🎵 *𝗠𝗨𝗦𝗜𝗖 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥*',
            '➽ Enter a song name or YouTube link.',
            '',
            '📌 *𝗘𝗫𝗔𝗠𝗣𝗟𝗘𝗦*',
            `➽ ${prefix}play harlem shake`,
            `➽ ${prefix}play https://youtu.be/dQw4w9WgXcQ`
        ));
    }

    if (query.length > 150) {
        return m.reply(box('❌ *𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗤𝗨𝗘𝗥𝗬*', '➽ Keep it under 150 characters.'));
    }

    let local;
    try {
        await m.react('⌛');

        // 1. Search Logic
        let video;
        if (query.includes('youtube.com') || query.includes('youtu.be')) {
            video = { url: query, title: 'YouTube Audio' };
            try {
                const id = query.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:\S*&)?v=|shorts\/|embed\/|v\/|live\/))([\w-]{11})/i)?.[1];
                const v = id && await yts({ videoId: id });
                if (v?.videoId) video = v; // metadata is best-effort for links
            } catch { /* keep the basic info */ }
        } else {
            const search = await yts(query);
            video = search?.videos?.[0];
        }

        if (!video) {
            await m.react('❌');
            return m.reply(box('❌ *𝗡𝗢 𝗥𝗘𝗦𝗨𝗟𝗧𝗦*', `➽ No song found for: ${query}`));
        }
        if (video.seconds && video.seconds > MAX_SECONDS) {
            await m.react('❌');
            return m.reply(box('❌ *𝗧𝗢𝗢 𝗟𝗢𝗡𝗚*', `➽ ${video.title} is ${video.timestamp}.`, '➽ Max allowed is 20 minutes.'));
        }

        // 2. Send Preview Info
        const caption = box(
            '🎵 *𝗦𝗢𝗡𝗚*',
            `➽ ${video.title}`,
            video.author?.name ? `➽ 👤 ${video.author.name}` : null,
            video.timestamp ? `➽ ⏱️ ${video.timestamp}` : null,
            '',
            '⏳ _Converting to MP3... please wait_'
        );
        const thumb = video.thumbnail || video.image || 'https://files.catbox.moe/j9ia5c.png';
        await m.reply({ image: { url: thumb }, caption }).catch(() => m.reply({ text: caption }));

        // 3. Download Logic: yt-dlp first, download APIs as backup
        const videoUrl = video.url || `https://www.youtube.com/watch?v=${video.videoId}`;
        let audio, title = video.title;
        try {
            local = await localAudio(videoUrl);
            audio = local.buffer;
            if (title === 'YouTube Audio' && local.title) title = local.title;
        } catch (e) {
            console.error('[PLAY] Local download failed, trying APIs:', e.message);
            if (/longer than 20 minutes/.test(e.message)) throw e;
            const api = await apiAudio(videoUrl);
            audio = api.buffer;
            if (title === 'YouTube Audio' && api.title) title = api.title;
        }

        // 4. Send Audio File
        await m.reply({
            audio,
            mimetype: 'audio/mpeg',
            fileName: `${clean(title)}.mp3`,
            ptt: false // Set to true if you want it sent as a voice note
        });

        await m.react('✅');
    } catch (err) {
        console.error('[PLAY] Error:', err.message);
        await m.react('❌').catch(() => {});
        await m.reply(box('❌ *𝗣𝗟𝗔𝗬 𝗘𝗥𝗥𝗢𝗥*', `➽ ${err.message}`, '➽ Please try again.'));
    } finally {
        if (local) local.cleanup();
    }
});
