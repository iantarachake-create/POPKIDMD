'use strict';

const axios = require('axios');
const playdl = require('play-dl');
const { cmd } = require('../arslan');

const BASE = 'https://apis.davidcyriltech.my.id';

async function searchYoutube(query) {
    const isUrl =
        /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/i.test(query);

    // YouTube URL
    if (isUrl) {
        try {
            const info = await playdl.video_info(query);
            const d = info.video_details;

            return {
                url: query,
                title: d.title || 'Unknown',
                artist: d.channel?.name || 'Unknown',
                thumbnail: d.thumbnails?.slice(-1)[0]?.url || '',
                duration: d.durationRaw || ''
            };
        } catch {}

        const id = query.match(
            /(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/
        )?.[1];

        return {
            url: query,
            title: 'Unknown',
            artist: 'Unknown',
            thumbnail: id
                ? `https://img.youtube.com/vi/${id}/hqdefault.jpg`
                : '',
            duration: ''
        };
    }

    // Search YouTube
    const results = await playdl.search(query, {
        source: { youtube: 'video' },
        limit: 1
    });

    if (!results?.length) {
        throw new Error('No results found for: ' + query);
    }

    const v = results[0];

    return {
        url: v.url,
        title: v.title || 'Unknown',
        artist: v.channel?.name || 'Unknown',
        thumbnail: v.thumbnails?.slice(-1)[0]?.url || '',
        duration: v.durationRaw || ''
    };
}

async function downloadMp3(videoUrl) {
    const { data } = await axios.get(
        `${BASE}/download/ytmp3?url=${encodeURIComponent(videoUrl)}`,
        {
            timeout: 30000
        }
    );

    const link =
        data?.result?.download_url ||
        data?.result?.downloadUrl ||
        data?.result?.url ||
        data?.url ||
        data?.link;

    if (!link) {
        throw new Error('No download link returned by API');
    }

    return link;
}

cmd({
    pattern: 'play2',
    name: 'play',
    category: 'Downloader',
    aliases: [
        'music2',
        'song2',
        '2ytmp3',
        'ytsong2',
        'ytaudio2'
    ],
    description: 'Search and download music from YouTube',
    filename: __filename
}, async (sock, m, args) => {

    const query = args.join(' ').trim();

    if (!query) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗟𝗔𝗬* ◈
┃
┃🎵 *𝗨𝗦𝗔𝗚𝗘*
┃➽ ${global.BOT_PREFIX}play <song name>
┃
┃📌 *𝗘𝗫𝗔𝗠𝗣𝗟𝗘*
┃➽ ${global.BOT_PREFIX}play Blinding Lights
┃
┗▣`);
    }

    await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗟𝗔𝗬* ◈
┃
┃🔍 *𝗦𝗘𝗔𝗥𝗖𝗛𝗜𝗡𝗚*
┃
┃➽ ${query}
┃
┃⏳ Please wait...
┃
┗▣`);

    try {
        const track = await searchYoutube(query);

        await sock.sendMessage(m.from, {
            image: {
                url: track.thumbnail ||
                    'https://files.catbox.moe/5uli5p.jpeg'
            },
            caption: `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗨𝗦𝗜𝗖* ◈
┃
┃🎵 *𝗧𝗜𝗧𝗟𝗘* : ${track.title}
┃🎤 *𝗔𝗥𝗧𝗜𝗦𝗧* : ${track.artist}
┃⏱️ *𝗗𝗨𝗥𝗔𝗧𝗜𝗢𝗡* : ${track.duration || 'Unknown'}
┃
┃⬇️ *𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗜𝗡𝗚...*
┃
┗▣`
        }, {
            quoted: m
        });

        const audioUrl = await downloadMp3(track.url);

        // Send audio
        await sock.sendMessage(m.from, {
            audio: {
                url: audioUrl
            },
            mimetype: 'audio/mpeg',
            ptt: false
        }, {
            quoted: m
        });

        // Send MP3 document
        const safeName =
            track.title
                .replace(/[^\w\s-]/g, '')
                .trim()
                .slice(0, 50) || 'POPKID-MUSIC';

        await sock.sendMessage(m.from, {
            document: {
                url: audioUrl
            },
            mimetype: 'audio/mpeg',
            fileName: `${safeName}.mp3`
        }, {
            quoted: m
        });

    } catch (err) {
        console.error('❌ Play command error:', err);

        await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗟𝗔𝗬* ◈
┃
┃❌ *𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗙𝗔𝗜𝗟𝗘𝗗*
┃
┃➽ ${err.message || 'Something went wrong'}
┃
┗▣`);
    }
});
