const axios = require('axios');
const cheerio = require('cheerio');

const { cmd } = require('../arslan');

async function mediafireDl(url) {
    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });

        const $ = cheerio.load(data);

        const link = $('#downloadButton').attr('href');

        const name =
            $('div.dl-info > div.promo-text').text().trim() ||
            $('.dl-btn-label').attr('title') ||
            'Unknown File';

        const size =
            $('#downloadButton')
                .text()
                .replace(/Download|[()]|\s/g, '')
                .trim() || 'Unknown';

        const ext = name.includes('.')
            ? name.split('.').pop().toLowerCase()
            : 'bin';

        if (!link) return null;

        return {
            name,
            size,
            link,
            ext
        };

    } catch (error) {
        console.error('MediaFire Parse Error:', error.message);
        return null;
    }
}

cmd({
    pattern: 'mediafire',
    name: 'mediafire',
    category: 'Downloaders',
    aliases: ['mfire', 'mf'],
    description: 'Download files from MediaFire',
    filename: __filename
}, async (sock, m, args) => {

    const url = args.join(' ').trim();

    if (!url) {
        return await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗘𝗗𝗜𝗔𝗙𝗜𝗥𝗘* ◈
┃
┃❌ *𝗠𝗜𝗦𝗦𝗜𝗡𝗚 𝗨𝗥𝗟*
┃
┃➽ Send a MediaFire download link.
┃
┃📌 *𝗘𝗫𝗔𝗠𝗣𝗟𝗘*
┃➽ .mfire https://www.mediafire.com/file/...
┃
┗▣`);
    }

    if (!/^https?:\/\/(www\.)?mediafire\.com\//i.test(url)) {
        return await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗘𝗗𝗜𝗔𝗙𝗜𝗥𝗘* ◈
┃
┃❌ *𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗟𝗜𝗡𝗞*
┃➽ Please provide a valid
┃MediaFire URL.
┃
┗▣`);
    }

    try {

        await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗘𝗗𝗜𝗔𝗙𝗜𝗥𝗘* ◈
┃
┃🔎 *𝗣𝗥𝗢𝗖𝗘𝗦𝗦𝗜𝗡𝗚...*
┃➽ Getting file information.
┃
┗▣`);

        const data = await mediafireDl(url);

        if (!data || !data.link) {
            return await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗘𝗗𝗜𝗔𝗙𝗜𝗥𝗘* ◈
┃
┃❌ *𝗙𝗔𝗜𝗟𝗘 𝗡𝗢𝗧 𝗙𝗢𝗨𝗡𝗗*
┃
┃➽ The MediaFire link may be
┃private, expired or invalid.
┃
┗▣`);
        }

        await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗘𝗗𝗜𝗔𝗙𝗜𝗥𝗘* ◈
┃
┃📁 *𝗙𝗜𝗟𝗘* : ${data.name}
┃📦 *𝗦𝗜𝗭𝗘* : ${data.size}
┃📄 *𝗧𝗬𝗣𝗘* : ${data.ext}
┃
┃⏳ *𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗜𝗡𝗚...*
┃➽ Please wait.
┃
┗▣`);

        const response = await axios.get(data.link, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Referer': url
            },
            timeout: 120000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        const buffer = Buffer.from(response.data);

        if (!buffer.length || buffer.length < 10000) {
            return await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗘𝗗𝗜𝗔𝗙𝗜𝗥𝗘* ◈
┃
┃❌ *𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗙𝗔𝗜𝗟𝗘𝗗*
┃➽ The downloaded file is invalid
┃or appears to be corrupted.
┃
┗▣`);
        }

        const mimes = {
            zip: 'application/zip',
            rar: 'application/vnd.rar',
            '7z': 'application/x-7z-compressed',
            pdf: 'application/pdf',
            apk: 'application/vnd.android.package-archive',
            mp4: 'video/mp4',
            mkv: 'video/x-matroska',
            mp3: 'audio/mpeg',
            m4a: 'audio/mp4',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            webp: 'image/webp',
            txt: 'text/plain'
        };

        const mimeType =
            mimes[data.ext] || 'application/octet-stream';

        await sock.sendMessage(
            m.from,
            {
                document: buffer,
                fileName: data.name,
                mimetype: mimeType,
                caption: `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗘𝗗𝗜𝗔𝗙𝗜𝗥𝗘* ◈
┃
┃✅ *𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗖𝗢𝗠𝗣𝗟𝗘𝗧𝗘*
┃
┃📁 *𝗙𝗜𝗟𝗘* : ${data.name}
┃📦 *𝗦𝗜𝗭𝗘* : ${data.size}
┃📄 *𝗧𝗬𝗣𝗘* : ${data.ext}
┃
┗▣`
            },
            {
                quoted: m
            }
        );

    } catch (error) {

        console.error('MediaFire Download Error:', error);

        await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗘𝗗𝗜𝗔𝗙𝗜𝗥𝗘* ◈
┃
┃❌ *𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗘𝗥𝗥𝗢𝗥*
┃
┃➽ ${error.message}
┃
┗▣`);
    }
});
