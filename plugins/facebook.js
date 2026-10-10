const axios = require('axios');
const { cmd } = require('../arslan');

const FB_API = 'https://api.delirius.online/download/facebook';
const FB_REGEX = /https?:\/\/(?:www\.|m\.|web\.|mbasic\.)?(?:facebook\.com|fb\.watch|fb\.com)\/\S+/i;

// "720p (HD)" -> 720
const qualityNum = (q = '') => parseInt(String(q).match(/\d+/)?.[0] || '0', 10);

async function fetchFacebook(url, retries = 2) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const { data } = await axios.get(FB_API, {
                params: { url },
                timeout: 60000
            });

            if (!data?.status || !Array.isArray(data.list) || !data.list.length) {
                throw new Error('No downloadable video found (is it public?)');
            }
            return data;
        } catch (err) {
            lastErr = err;
            if (i < retries) await new Promise(r => setTimeout(r, 3000));
        }
    }
    throw lastErr;
}

cmd({
    pattern: 'facebook',
    name: 'facebook',
    category: 'Downloaders',
    aliases: ['fb', 'fbdl', 'fbvideo'],
    description: 'Download Facebook videos by link',
    filename: __filename
}, async (sock, m, args) => {
    const prefix = global.BOT_PREFIX || '.';

    // Accept a link in the command text OR in a replied-to message
    const source = `${args.join(' ')} ${m.quoted?.body || ''}`;
    const url = source.match(FB_REGEX)?.[0];

    // Optional quality: .fb 360 <link>
    const wanted = args.map(a => a.replace(/p$/i, '')).find(a => /^\d{3,4}$/.test(a));

    if (!url) {
        return m.reply(
            `📘 *Facebook Downloader*\n\nSend a Facebook video link.\nExample:\n${prefix}fb https://www.facebook.com/share/v/xxxxx/\n\nTip: add a quality, e.g. ${prefix}fb 360 <link>`
        );
    }

    try {
        await m.react('⏳');

        const data = await fetchFacebook(url);

        // Sort best -> worst, then pick requested quality or the best one
        const list = [...data.list].sort((a, b) => qualityNum(b.quality) - qualityNum(a.quality));
        const chosen =
            (wanted && list.find(v => qualityNum(v.quality) === Number(wanted))) || list[0];

        const caption =
            `📘 *Facebook Video*\n` +
            `🎞️ *Quality:* ${chosen.quality}\n\n` +
            `> *_Downloaded by popkid_*`;

        try {
            // Fast path: let WhatsApp pull straight from the URL
            await sock.sendMessage(m.from, {
                video: { url: chosen.url },
                mimetype: 'video/mp4',
                caption
            });
        } catch (e) {
            // Fallback: download to a buffer first, then upload
            const res = await axios.get(chosen.url, {
                responseType: 'arraybuffer',
                timeout: 120000,
                maxContentLength: 100 * 1024 * 1024
            });
            await sock.sendMessage(m.from, {
                video: Buffer.from(res.data),
                mimetype: 'video/mp4',
                caption
            });
        }

        await m.react('✅');
    } catch (err) {
        console.error('[FACEBOOK] Error:', err.message);
        await m.react('❌');
        await m.reply(`❌ Download failed!\nReason: ${err.message}`);
    }
});
