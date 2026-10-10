const axios = require('axios');
const { cmd } = require('../arslan');

const TT_API = 'https://api.delirius.online/download/tiktok';
const TT_REGEX = /https?:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\/\S+/i;
const MAX_IMAGES = 10;

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchTikTok(url, retries = 2) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const { data } = await axios.get(TT_API, {
                params: { url },
                timeout: 60000
            });

            if (!data?.status || !data?.data) {
                throw new Error('TikTok not found (is it public?)');
            }
            if (!Array.isArray(data.data.meta?.media) || !data.data.meta.media.length) {
                throw new Error('No media found in this TikTok');
            }
            return data.data;
        } catch (err) {
            lastErr = err;
            if (i < retries) await wait(3000);
        }
    }
    throw lastErr;
}

// Best available video link: HD > original > watermarked
function pickVideoUrl(item) {
    return item.hd || item.org || item.wm || null;
}

// Slideshow items: be tolerant about which field holds the image link
function pickImageUrl(item) {
    return item.url || item.image || item.org || item.hd || item.wm || null;
}

function buildCaption(d) {
    const lines = [
        '🎵 *TikTok Downloader*',
        '',
        d.title ? `📝 *Title:* ${String(d.title).trim().slice(0, 200)}` : null,
        d.author?.username ? `👤 *Author:* ${d.author.username}` : null,
        d.duration ? `⏱️ *Duration:* ${d.duration}s` : null,
        d.repro ? `▶️ *Views:* ${d.repro}` : null,
        d.like ? `❤️ *Likes:* ${d.like}` : null,
        d.comment ? `💬 *Comments:* ${d.comment}` : null,
        d.music?.title ? `🎶 *Sound:* ${d.music.title}` : null,
        '',
        '> *_Downloaded by popkid_*'
    ];
    return lines.filter(l => l !== null).join('\n');
}

async function sendVideo(m, videoUrl, caption) {
    try {
        // Fast path: let WhatsApp pull straight from the URL
        await m.reply({ video: { url: videoUrl }, mimetype: 'video/mp4', caption });
    } catch (e) {
        // Fallback: download to a buffer first, then upload
        const res = await axios.get(videoUrl, {
            responseType: 'arraybuffer',
            timeout: 120000,
            maxContentLength: 100 * 1024 * 1024,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }
        });
        await m.reply({ video: Buffer.from(res.data), mimetype: 'video/mp4', caption });
    }
}

cmd({
    pattern: 'tiktok',
    name: 'tiktok',
    category: 'Downloaders',
    aliases: ['tt', 'ttdl', 'tiktokdl'],
    description: 'Download TikTok videos & slideshows by link',
    filename: __filename
}, async (sock, m, args) => {
    const prefix = global.BOT_PREFIX || '.';

    // Accept a link in the command text OR in a replied-to message
    const source = `${args.join(' ')} ${m.quoted?.body || ''}`;
    const url = source.match(TT_REGEX)?.[0];

    if (!url) {
        return m.reply(
            `🎵 *TikTok Downloader*\n\nSend a TikTok link.\nExample:\n${prefix}tiktok https://vt.tiktok.com/xxxxx/\n\nTip: you can also reply to a message that has a TikTok link.`
        );
    }

    try {
        await m.react('⏳');

        const d = await fetchTikTok(url);
        const caption = buildCaption(d);
        const media = d.meta.media;

        const videos = media.filter(x => x.type === 'video');
        const images = media.filter(x => x.type === 'image');

        if (videos.length) {
            const videoUrl = pickVideoUrl(videos[0]);
            if (!videoUrl) throw new Error('No video link returned');
            await sendVideo(m, videoUrl, caption);
        } else if (images.length) {
            // Photo slideshow: first image carries the caption
            const urls = images.map(pickImageUrl).filter(Boolean).slice(0, MAX_IMAGES);
            if (!urls.length) throw new Error('No image links returned');

            for (let i = 0; i < urls.length; i++) {
                await m.reply({
                    image: { url: urls[i] },
                    caption: i === 0 ? caption : ''
                });
                await wait(800); // avoid rate limits
            }
        } else {
            throw new Error('Unsupported TikTok media type');
        }

        await m.react('✅');
    } catch (err) {
        console.error('[TIKTOK] Error:', err.message);
        await m.react('❌');
        await m.reply(`❌ Download failed!\nReason: ${err.message}`);
    }
});
