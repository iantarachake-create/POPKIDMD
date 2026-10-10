const axios = require('axios');
const yts = require('yt-search');
const { cmd } = require('../arslan');

const YTMP4_API = 'https://api.delirius.online/download/ytmp4';
const YT_ID_REGEX = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:\S*&)?v=|shorts\/|embed\/|v\/|live\/))([\w-]{11})/i;
const DEFAULT_QUALITY = '360p';
const QUALITIES = ['144p', '240p', '360p', '480p', '720p', '1080p'];
const MAX_SECONDS = 20 * 60;          // refuse anything longer than 20 minutes
const MAX_BYTES = 100 * 1024 * 1024;  // 100MB download cap (fallback path)
const PENDING_TTL = 10 * 60 * 1000;   // menu stays active for 10 minutes

const TITLE = '┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗩𝗜𝗗𝗘𝗢* ◈';
const FOOTER = '> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗';

// Menu cards waiting for a 1/2 reply:  cardMessageId -> { ... }
const pending = new Map();
// Reply ids already processed (the plugin hook can fire once per alias)
const handled = new Set();

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const box = (...lines) =>
    `${TITLE}\n┃\n${lines.filter(l => l !== null && l !== undefined).map(l => `┃${l}`).join('\n')}\n┃\n┗▣\n${FOOTER}`;
const clean = (s) => String(s || 'video').replace(/[<>:"/\\|?*\n\r]/g, '_').trim().slice(0, 100);

function sweep() {
    const now = Date.now();
    for (const [id, p] of pending) if (p.expires < now) pending.delete(id);
    if (handled.size > 500) handled.clear();
}

// "1" / "video" / "doc" ... -> 'video' | 'document' | null
function parseChoice(text) {
    const t = String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['1', 'video', 'mp4', 'vid'].includes(t)) return 'video';
    if (['2', 'doc', 'document', 'file'].includes(t)) return 'document';
    return null;
}

// Last word like "720" / "720p" picks the quality; everything else is the query
function splitQuality(args) {
    const list = [...args];
    const last = (list[list.length - 1] || '').toLowerCase();
    const match = last.match(/^(\d{3,4})p?$/);
    if (match && QUALITIES.includes(`${match[1]}p`)) {
        list.pop();
        return { query: list.join(' ').trim(), quality: `${match[1]}p` };
    }
    return { query: list.join(' ').trim(), quality: DEFAULT_QUALITY };
}

// Turn a query (name or link) into video metadata
async function resolveVideo(query) {
    const id = query.match(YT_ID_REGEX)?.[1];

    if (id) {
        try {
            const v = await yts({ videoId: id });
            if (v?.videoId) return v;
        } catch (_) { /* metadata is best-effort for links */ }
        return { videoId: id, url: `https://www.youtube.com/watch?v=${id}` };
    }

    const res = await yts(query);
    const v = res?.videos?.[0];
    if (!v) throw new Error(`No video found for: ${query}`);
    return v;
}

async function requestMp4(videoUrl, format, retries) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const { data } = await axios.get(YTMP4_API, {
                params: { url: videoUrl, format },
                timeout: 120000
            });

            const link = data?.data?.download;
            if (!data?.status || !link || !/^https?:\/\//i.test(link)) {
                throw new Error('Download link not available for this video');
            }
            return data.data;
        } catch (err) {
            lastErr = err;
            if (i < retries) await wait(3000);
        }
    }
    throw lastErr;
}

// Try the wanted quality first, then fall back to 360p
async function fetchMp4(videoUrl, quality) {
    try {
        const data = await requestMp4(videoUrl, quality, quality === DEFAULT_QUALITY ? 2 : 1);
        return { ...data, quality };
    } catch (err) {
        if (quality === DEFAULT_QUALITY) throw err;
        const data = await requestMp4(videoUrl, DEFAULT_QUALITY, 1);
        return { ...data, quality: DEFAULT_QUALITY };
    }
}

async function getBuffer(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 300000,
        maxContentLength: MAX_BYTES,
        maxBodyLength: MAX_BYTES,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }
    });
    return Buffer.from(res.data);
}

// Send the video in the chosen format
async function deliver(m, choice, mp4, title) {
    const caption = `🎬 *${title}*\n🎞️ ${mp4.quality}\n\n${FOOTER}`;
    const fileName = `${clean(title)}.mp4`;

    const build = (source) => choice === 'document'
        ? { document: source, mimetype: 'video/mp4', fileName, caption }
        : { video: source, mimetype: 'video/mp4', caption };

    try {
        // Fast path: let WhatsApp pull straight from the URL
        return await m.reply(build({ url: mp4.download }));
    } catch (e) {
        // Fallback: download to a buffer first, then upload
        const buffer = await getBuffer(mp4.download);
        return await m.reply(build(buffer));
    }
}

const registered = cmd({
    pattern: 'video',
    name: 'video',
    category: 'Downloaders',
    aliases: ['ytmp4', 'ytvideo', 'vid'],
    description: 'Search YouTube and get a video as video or document',
    filename: __filename
}, async (sock, m, args) => {
    const prefix = global.BOT_PREFIX || '.';
    const fromQuote = (m.quoted?.body || '').trim();
    const { query: typed, quality } = splitQuality(args || []);
    const query = typed || fromQuote;

    if (!query) {
        return m.reply(box(
            '🎥 *𝗩𝗜𝗗𝗘𝗢 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥*',
            '➽ Enter a video name or YouTube link.',
            '',
            '📌 *𝗘𝗫𝗔𝗠𝗣𝗟𝗘𝗦*',
            `➽ ${prefix}video alan walker faded`,
            `➽ ${prefix}video https://youtu.be/dQw4w9WgXcQ`,
            `➽ ${prefix}video faded 720  (quality)`,
            '',
            `🎞️ Qualities: ${QUALITIES.join(', ')}`,
            `➽ Default: ${DEFAULT_QUALITY}`
        ));
    }

    if (query.length > 150) {
        return m.reply(box('❌ *𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗤𝗨𝗘𝗥𝗬*', '➽ Keep it under 150 characters.'));
    }

    try {
        await m.react('⌛');

        const video = await resolveVideo(query);
        const videoUrl = video.url || `https://www.youtube.com/watch?v=${video.videoId}`;

        if (video.seconds && video.seconds > MAX_SECONDS) {
            await m.react('❌');
            return m.reply(box(
                '❌ *𝗧𝗢𝗢 𝗟𝗢𝗡𝗚*',
                `➽ ${video.title || 'This video'} is ${video.timestamp}.`,
                `➽ Max allowed is ${MAX_SECONDS / 60} minutes.`
            ));
        }

        const title = video.title || 'Unknown Video';
        const thumbnail = video.thumbnail || video.image || '';

        const caption = box(
            '🎬 *𝗩𝗜𝗗𝗘𝗢*',
            `➽ ${title}`,
            video.author?.name ? `➽ 👤 ${video.author.name}` : null,
            video.timestamp ? `➽ ⏱️ ${video.timestamp}` : null,
            video.views ? `➽ 👁️ ${Number(video.views).toLocaleString()} views` : null,
            `➽ 🎞️ ${quality}`,
            '',
            '📥 *𝗥𝗘𝗣𝗟𝗬 𝗪𝗜𝗧𝗛 𝗔 𝗡𝗨𝗠𝗕𝗘𝗥*',
            '➽ *1* ▸ 🎬 Video',
            '➽ *2* ▸ 📄 Document'
        );

        // Menu card (thumbnail if we have one, plain text otherwise)
        let card;
        if (thumbnail) {
            card = await m.reply({ image: { url: thumbnail }, caption }).catch(() => null);
        }
        if (!card) card = await m.reply({ text: caption });

        const cardId = card?.key?.id;
        if (!cardId) throw new Error('Could not send the options menu');

        sweep();
        pending.set(cardId, {
            chat: m.from,
            sender: m.sender,
            videoUrl,
            title,
            quality,
            expires: Date.now() + PENDING_TTL
        });

        await m.react('✅');
    } catch (err) {
        console.error('[VIDEO] Error:', err.message);
        await m.react('❌').catch(() => {});
        await m.reply(box('❌ *𝗩𝗜𝗗𝗘𝗢 𝗘𝗥𝗥𝗢𝗥*', `➽ ${err.message}`, '➽ Please try again.'));
    }
});

// Runs on every incoming message: catches the "1 / 2" reply to a menu card
registered.onMessage = async (sock, m) => {
    try {
        const cardId = m.quoted?.key?.id;
        if (!cardId || !pending.has(cardId)) return false;

        const entry = pending.get(cardId);
        if (entry.expires < Date.now()) { pending.delete(cardId); return false; }
        if (entry.chat !== m.from || entry.sender !== m.sender) return false;

        const choice = parseChoice(m.body);
        if (!choice) return false;                 // not a menu answer, let it pass

        if (handled.has(m.id)) return true;        // same reply seen again (alias duplicate)
        handled.add(m.id);

        pending.delete(cardId);                    // one choice per menu card

        try {
            await m.react('⏳');
            const mp4 = await fetchMp4(entry.videoUrl, entry.quality);
            await deliver(m, choice, mp4, entry.title);
            await m.react('✅');
        } catch (err) {
            console.error('[VIDEO] Delivery error:', err.message);
            pending.set(cardId, entry);            // let them reply again to retry
            await m.react('❌').catch(() => {});
            await m.reply(box('❌ *𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗙𝗔𝗜𝗟𝗘𝗗*', `➽ ${err.message}`, '➽ Reply 1 or 2 again to retry.'));
        }

        return true;
    } catch (err) {
        console.error('[VIDEO] onMessage error:', err.message);
        return false;
    }
};
