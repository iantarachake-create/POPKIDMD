const axios = require('axios');
const yts = require('yt-search');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { cmd } = require('../arslan');

const execFileAsync = promisify(execFile);

let FFMPEG = 'ffmpeg';
try { FFMPEG = require('@ffmpeg-installer/ffmpeg').path || 'ffmpeg'; } catch (_) { /* use system ffmpeg */ }

const YTMP3_API = 'https://api.delirius.online/download/ytmp3';
const YT_ID_REGEX = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:\S*&)?v=|shorts\/|embed\/|v\/|live\/))([\w-]{11})/i;
const MAX_SECONDS = 30 * 60;          // refuse anything longer than 30 minutes
const MAX_BYTES = 100 * 1024 * 1024;  // 100MB download cap
const PENDING_TTL = 10 * 60 * 1000;   // menu stays active for 10 minutes

const TITLE = '┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗟𝗔𝗬* ◈';
const FOOTER = '> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗';

// Menu cards waiting for a 1/2/3 reply:  cardMessageId -> { ... }
const pending = new Map();
// Reply ids already processed (the plugin hook can fire once per alias)
const handled = new Set();

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const box = (...lines) =>
    `${TITLE}\n┃\n${lines.filter(l => l !== null && l !== undefined).map(l => `┃${l}`).join('\n')}\n┃\n┗▣\n${FOOTER}`;
const clean = (s) => String(s || 'song').replace(/[<>:"/\\|?*\n\r]/g, '_').trim().slice(0, 100);

function sweep() {
    const now = Date.now();
    for (const [id, p] of pending) if (p.expires < now) pending.delete(id);
    if (handled.size > 500) handled.clear();
}

// "1" / "audio" / "doc" / "vn" ... -> 'audio' | 'document' | 'voice' | null
function parseChoice(text) {
    const t = String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['1', 'audio', 'mp3', 'song', 'music'].includes(t)) return 'audio';
    if (['2', 'doc', 'document', 'file'].includes(t)) return 'document';
    if (['3', 'vn', 'voice', 'voicenote', 'ptt'].includes(t)) return 'voice';
    return null;
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
    if (!v) throw new Error(`No song found for: ${query}`);
    return v;
}

async function fetchMp3(videoUrl, retries = 2) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const { data } = await axios.get(YTMP3_API, {
                params: { url: videoUrl },
                timeout: 90000
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

async function getBuffer(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 180000,
        maxContentLength: MAX_BYTES,
        maxBodyLength: MAX_BYTES,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }
    });
    return Buffer.from(res.data);
}

// mp3 buffer -> ogg/opus buffer (the format WhatsApp voice notes need)
async function toVoiceNote(mp3Buffer) {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const input = path.join(os.tmpdir(), `play_${id}.mp3`);
    const output = path.join(os.tmpdir(), `play_${id}.ogg`);

    try {
        fs.writeFileSync(input, mp3Buffer);
        await execFileAsync(
            FFMPEG,
            ['-y', '-i', input, '-vn', '-c:a', 'libopus', '-b:a', '64k', '-ar', '48000', '-ac', '1', '-f', 'ogg', output],
            { timeout: 120000 }
        );
        return fs.readFileSync(output);
    } finally {
        for (const f of [input, output]) { try { fs.unlinkSync(f); } catch (_) {} }
    }
}

// Send the song in the chosen format
async function deliver(sock, m, choice, mp3, title) {
    const fileName = `${clean(title)}.mp3`;

    if (choice === 'voice') {
        const mp3Buffer = await getBuffer(mp3.download);
        try {
            const ogg = await toVoiceNote(mp3Buffer);
            return await m.reply({
                audio: ogg,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true
            });
        } catch (err) {
            console.error('[PLAY] Voice conversion failed, sending raw mp3 as PTT:', err.message);
            return await m.reply({
                audio: mp3Buffer,
                mimetype: 'audio/mpeg',
                ptt: true
            });
        }
    }

    const content = choice === 'document'
        ? { mimetype: 'audio/mpeg', fileName, caption: `🎵 ${title}\n\n${FOOTER}` }
        : { mimetype: 'audio/mpeg', fileName };
    const key = choice === 'document' ? 'document' : 'audio';

    try {
        // Fast path: let WhatsApp pull straight from the URL
        return await m.reply({ ...content, [key]: { url: mp3.download } });
    } catch (e) {
        // Fallback: download to a buffer first, then upload
        const buffer = await getBuffer(mp3.download);
        return await m.reply({ ...content, [key]: buffer });
    }
}

const registered = cmd({
    pattern: 'play',
    name: 'play',
    category: 'Downloaders',
    aliases: ['ply', 'playy', 'pl', 'song'],
    description: 'Search YouTube and get a song as audio, document or voice note',
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

        const title = video.title || 'Unknown Song';
        const thumbnail = video.thumbnail || video.image || '';

        const caption = box(
            '🎵 *𝗦𝗢𝗡𝗚*',
            `➽ ${title}`,
            video.author?.name ? `➽ 👤 ${video.author.name}` : null,
            video.timestamp ? `➽ ⏱️ ${video.timestamp}` : null,
            video.views ? `➽ 👁️ ${Number(video.views).toLocaleString()} views` : null,
            '',
            '📥 *𝗥𝗘𝗣𝗟𝗬 𝗪𝗜𝗧𝗛 𝗔 𝗡𝗨𝗠𝗕𝗘𝗥*',
            '➽ *1* ▸ 🎧 Audio',
            '➽ *2* ▸ 📄 Document',
            '➽ *3* ▸ 🎤 Voice note'
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
            expires: Date.now() + PENDING_TTL
        });

        await m.react('✅');
    } catch (err) {
        console.error('[PLAY] Error:', err.message);
        await m.react('❌').catch(() => {});
        await m.reply(box('❌ *𝗣𝗟𝗔𝗬 𝗘𝗥𝗥𝗢𝗥*', `➽ ${err.message}`, '➽ Please try again.'));
    }
});

// Runs on every incoming message: catches the "1 / 2 / 3" reply to a menu card
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
            const mp3 = await fetchMp3(entry.videoUrl);
            await deliver(sock, m, choice, mp3, entry.title);
            await m.react('✅');
        } catch (err) {
            console.error('[PLAY] Delivery error:', err.message);
            pending.set(cardId, entry);            // let them reply again to retry
            await m.react('❌').catch(() => {});
            await m.reply(box('❌ *𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗙𝗔𝗜𝗟𝗘𝗗*', `➽ ${err.message}`, '➽ Reply 1, 2 or 3 again to retry.'));
        }

        return true;
    } catch (err) {
        console.error('[PLAY] onMessage error:', err.message);
        return false;
    }
};
