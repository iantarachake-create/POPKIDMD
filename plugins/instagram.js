const axios = require('axios');
const { cmd } = require('../arslan');

const IG_API = 'https://api.delirius.online/download/instagram';
const IG_REGEX = /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/\S+/i;
const MAX_ITEMS = 10;

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchInstagram(url, retries = 2) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const { data } = await axios.get(IG_API, {
                params: { url },
                timeout: 60000
            });

            if (!data?.status || !Array.isArray(data.data) || !data.data.length) {
                throw new Error('No media found (is the post public?)');
            }

            const items = data.data.filter(x => x && x.url);
            if (!items.length) throw new Error('No downloadable media returned');
            return items;
        } catch (err) {
            lastErr = err;
            if (i < retries) await wait(3000);
        }
    }
    throw lastErr;
}

const isVideo = (item) =>
    String(item.type || '').toLowerCase() === 'video' || /\.mp4(\?|$)/i.test(item.url);

async function getBuffer(url, max = 100 * 1024 * 1024) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 120000,
        maxContentLength: max,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }
    });
    return Buffer.from(res.data);
}

async function sendItem(m, item, caption) {
    const video = isVideo(item);

    try {
        // Fast path: let WhatsApp pull straight from the URL
        await m.reply(
            video
                ? { video: { url: item.url }, mimetype: 'video/mp4', caption }
                : { image: { url: item.url }, caption }
        );
    } catch (e) {
        // Fallback: download to a buffer first, then upload
        const buffer = await getBuffer(item.url);
        await m.reply(
            video
                ? { video: buffer, mimetype: 'video/mp4', caption }
                : { image: buffer, caption }
        );
    }
}

cmd({
    pattern: 'instagram',
    name: 'instagram',
    category: 'Downloaders',
    aliases: ['ig', 'igdl', 'insta'],
    description: 'Download Instagram posts, reels & carousels by link',
    filename: __filename
}, async (sock, m, args) => {
    const prefix = global.BOT_PREFIX || '.';

    // Accept a link in the command text OR in a replied-to message
    const source = `${args.join(' ')} ${m.quoted?.body || ''}`;
    const url = source.match(IG_REGEX)?.[0];

    if (!url) {
        return m.reply(
            `📸 *Instagram Downloader*\n\nSend an Instagram post, reel or carousel link.\nExample:\n${prefix}ig https://www.instagram.com/p/xxxxx/\n\nTip: you can also reply to a message that has an Instagram link.`
        );
    }

    try {
        await m.react('⏳');

        const items = await fetchInstagram(url);
        const total = items.length;
        const list = items.slice(0, MAX_ITEMS);

        for (let i = 0; i < list.length; i++) {
            const caption =
                i === 0
                    ? `📸 *Instagram Downloader*\n` +
                      (total > 1 ? `🗂️ *Items:* ${total}${total > MAX_ITEMS ? ` (sending first ${MAX_ITEMS})` : ''}\n` : '') +
                      `\n> *_Downloaded by popkid_*`
                    : '';

            await sendItem(m, list[i], caption);
            if (i < list.length - 1) await wait(800); // avoid rate limits
        }

        await m.react('✅');
    } catch (err) {
        console.error('[INSTAGRAM] Error:', err.message);
        await m.react('❌');
        await m.reply(`❌ Download failed!\nReason: ${err.message}`);
    }
});
