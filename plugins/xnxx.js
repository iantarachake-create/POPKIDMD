const axios = require('axios');
const { cmd } = require('../arslan');

const XNXX_API = 'https://api.delirius.online/download/xnxxdl';
const XNXX_REGEX = /https?:\/\/(?:www\.)?xnxx\.[a-z.]+\/video-\S+/i;
const MAX_BYTES = 100 * 1024 * 1024;  // 100MB download cap (fallback path)
const PENDING_TTL = 10 * 60 * 1000;   // menu stays active for 10 minutes

const TITLE = '┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗫* ◈';
const FOOTER = '> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗';

// Menu cards waiting for a 1/2/3 reply:  cardMessageId -> { ... }
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

// "1" / "video" / "doc" / "low" ... -> 'video' | 'document' | 'low' | null
function parseChoice(text) {
    const t = String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['1', 'video', 'mp4', 'vid'].includes(t)) return 'video';
    if (['2', 'doc', 'document', 'file'].includes(t)) return 'document';
    if (['3', 'low', 'small', '240', '240p'].includes(t)) return 'low';
    return null;
}

async function fetchXnxx(url, retries = 2) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const { data } = await axios.get(XNXX_API, {
                params: { url },
                timeout: 90000
            });

            const d = data?.data;
            const high = d?.download?.high;
            const low = d?.download?.low;
            if (!data?.status || !d || (!high && !low)) {
                throw new Error('No downloadable video found for this link');
            }
            return d;
        } catch (err) {
            lastErr = err;
            if (i < retries) await wait(3000);
        }
    }
    throw lastErr;
}

// The API packs "uploader\n12min" into one field
function parseDuration(raw) {
    const parts = String(raw || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { uploader: parts[0], duration: parts[parts.length - 1] };
    return { uploader: '', duration: parts[0] || '' };
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
async function deliver(m, choice, entry) {
    const wantLow = choice === 'low';
    const link = wantLow ? (entry.low || entry.high) : (entry.high || entry.low);
    const quality = (wantLow || !entry.high) ? '240p' : '360p';

    const caption = `🔞 *${entry.title}*\n🎞️ ${quality}\n\n${FOOTER}`;
    const fileName = `${clean(entry.title)}.mp4`;

    const build = (source) => choice === 'document'
        ? { document: source, mimetype: 'video/mp4', fileName, caption }
        : { video: source, mimetype: 'video/mp4', caption };

    try {
        // Fast path: let WhatsApp pull straight from the URL
        return await m.reply(build({ url: link }));
    } catch (e) {
        // Fallback: download to a buffer first, then upload
        const buffer = await getBuffer(link);
        return await m.reply(build(buffer));
    }
}

const registered = cmd({
    pattern: 'xnxx',
    name: 'xnxx',
    category: 'Downloaders',
    aliases: ['x', 'xdl', 'xnxxdl'],
    description: '18+ XNXX video downloader by link (private chat)',
    filename: __filename
}, async (sock, m, args) => {
    const prefix = global.BOT_PREFIX || '.';

    // Adult content: private chats only (owner/dev may use it anywhere)
    if (m.isGroup && !m.isOwner && !m.isDev) {
        return m.reply(box('🔞 *𝗣𝗥𝗜𝗩𝗔𝗧𝗘 𝗖𝗛𝗔𝗧 𝗢𝗡𝗟𝗬*', '➽ This command is disabled in groups.'));
    }

    // Accept a link in the command text OR in a replied-to message
    const source = `${args.join(' ')} ${m.quoted?.body || ''}`;
    const url = source.match(XNXX_REGEX)?.[0];

    if (!url) {
        return m.reply(box(
            '🔞 *𝟭𝟴+ 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥*',
            '➽ Send an XNXX video link.',
            '',
            '📌 *𝗘𝗫𝗔𝗠𝗣𝗟𝗘*',
            `➽ ${prefix}xnxx https://www.xnxx.com/video-xxxxx/title`
        ));
    }

    try {
        await m.react('⌛');

        const d = await fetchXnxx(url);
        const { uploader, duration } = parseDuration(d.duration);

        const caption = box(
            '🎬 *𝗩𝗜𝗗𝗘𝗢*',
            `➽ ${String(d.title || 'Untitled').slice(0, 150)}`,
            uploader ? `➽ 👤 ${uploader}` : null,
            duration ? `➽ ⏱️ ${duration}` : null,
            d.quality ? `➽ 🎞️ Source: ${d.quality}` : null,
            '',
            '📥 *𝗥𝗘𝗣𝗟𝗬 𝗪𝗜𝗧𝗛 𝗔 𝗡𝗨𝗠𝗕𝗘𝗥*',
            d.download.high ? '➽ *1* ▸ 🎬 Video (360p)' : '➽ *1* ▸ 🎬 Video (240p)',
            d.download.high ? '➽ *2* ▸ 📄 Document (360p)' : '➽ *2* ▸ 📄 Document (240p)',
            d.download.low && d.download.high ? '➽ *3* ▸ 📉 Small video (240p)' : null
        );

        const card = await m.reply({ text: caption });
        const cardId = card?.key?.id;
        if (!cardId) throw new Error('Could not send the options menu');

        sweep();
        pending.set(cardId, {
            chat: m.from,
            sender: m.sender,
            title: d.title || 'video',
            high: d.download.high || '',
            low: d.download.low || '',
            expires: Date.now() + PENDING_TTL
        });

        await m.react('✅');
    } catch (err) {
        console.error('[XNXX] Error:', err.message);
        await m.react('❌').catch(() => {});
        await m.reply(box('❌ *𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗘𝗥𝗥𝗢𝗥*', `➽ ${err.message}`, '➽ Please try again.'));
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
            await deliver(m, choice, entry);
            await m.react('✅');
        } catch (err) {
            console.error('[XNXX] Delivery error:', err.message);
            pending.set(cardId, entry);            // let them reply again to retry
            await m.react('❌').catch(() => {});
            await m.reply(box('❌ *𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗙𝗔𝗜𝗟𝗘𝗗*', `➽ ${err.message}`, '➽ Reply 1, 2 or 3 again to retry.'));
        }

        return true;
    } catch (err) {
        console.error('[XNXX] onMessage error:', err.message);
        return false;
    }
};
