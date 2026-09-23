const { cmd } = require('../arslan');

cmd({
    pattern: "play",
    name: 'play',
    category: 'Downloaders',
    aliases: ['ply', 'playy', 'pl'],
    description: 'Downloads songs from YouTube and sends audio',
    filename: __filename
}, async (sock, m, args) => {
    await m.react('⌛');

    try {
        const query = args && args.length ? args.join(' ').trim() : '';

        if (!query) {
            await m.react('❌').catch(() => {});
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗟𝗔𝗬* ◈
┃
┃🎵 *𝗠𝗨𝗦𝗜𝗖 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥*
┃➽ Enter a song name or YouTube link.
┃
┃📌 *𝗘𝗫𝗔𝗠𝗣𝗟𝗘𝗦*
┃➽ .play harlem shake
┃➽ .play https://youtu.be/dQw4w9WgXcQ
┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`);
        }

        const isYoutubeLink = /(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|v\/|embed\/|shorts\/|playlist\?list=)?[a-zA-Z0-9_-]{11})/gi.test(query);

        let audioUrl, filename, thumbnail, sourceUrl;

        if (isYoutubeLink) {
            const response = await fetch(`https://api.sidycoders.xyz/api/ytdl?url=${encodeURIComponent(query)}&format=mp3&apikey=memberdycoders`);
            const data = await response.json();

            if (!data.status || !data.cdn) {
                await m.react('❌').catch(() => {});
                return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗟𝗔𝗬* ◈
┃
┃❌ *𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗙𝗔𝗜𝗟𝗘𝗗*
┃➽ Unable to download this YouTube link.
┃➽ The link may be broken or private.
┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`);
            }

            audioUrl = data.cdn;
            filename = data.title || "Unknown YouTube Song";
            thumbnail = "";
            sourceUrl = query;

        } else {

            if (query.length > 100) {
                await m.react('❌').catch(() => {});
                return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗟𝗔𝗬* ◈
┃
┃❌ *𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗤𝗨𝗘𝗥𝗬*
┃➽ Song title must be 100 characters or less.
┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`);
            }

            const response = await fetch(`https://apiziaul.vercel.app/api/downloader/ytplaymp3?query=${encodeURIComponent(query)}`);
            const data = await response.json();

            if (!data.status || !data.result?.downloadUrl) {
                await m.react('❌').catch(() => {});
                return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗟𝗔𝗬* ◈
┃
┃❌ *𝗡𝗢𝗧 𝗙𝗢𝗨𝗡𝗗*
┃➽ No song was found for:
┃➽ ${query}
┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`);
            }

            audioUrl = data.result.downloadUrl;
            filename = data.result.title || "Unknown Song";
            thumbnail = data.result.thumbnail || "";
            sourceUrl = data.result.videoUrl || "";
        }

        await m.react('✅');

        await sock.sendMessage(m.from, {
            audio: { url: audioUrl },
            mimetype: "audio/mpeg",
            fileName: `${filename}.mp3`,
            contextInfo: thumbnail ? {
                externalAdReply: {
                    title: filename.substring(0, 30),
                    body: "Popkid Md",
                    thumbnailUrl: thumbnail,
                    sourceUrl: sourceUrl,
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            } : undefined
        });

        await sock.sendMessage(m.from, {
            document: { url: audioUrl },
            mimetype: "audio/mpeg",
            fileName: `${filename.replace(/[<>:"/\\|?*]/g, '_')}.mp3`,
            caption: `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗟𝗔𝗬* ◈
┃
┃🎵 *𝗦𝗢𝗡𝗚*
┃➽ ${filename}
┃
┃✅ *𝗦𝗧𝗔𝗧𝗨𝗦* : 𝗖𝗢𝗠𝗣𝗟𝗘𝗧𝗘
┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`
        });

    } catch (error) {
        console.error('Play error:', error);

        await m.react('❌').catch(() => {});

        await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗟𝗔𝗬* ◈
┃
┃❌ *𝗣𝗟𝗔𝗬 𝗘𝗥𝗥𝗢𝗥*
┃➽ Unable to process your request.
┃➽ Please try again.
┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`);
    }
});
