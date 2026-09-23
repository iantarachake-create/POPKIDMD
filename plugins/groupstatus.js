"use strict";

const crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const { PassThrough } = require("stream");
const baileys = require("@whiskeysockets/baileys");
const { cmd } = require("../arslan");

// ─── COLOR MAP ──────────────────────────────────────────────────────────────
const COLORS = {
    blue: "#34B7F1",
    green: "#25D366",
    yellow: "#FFD700",
    orange: "#FF8C00",
    red: "#FF3B30",
    purple: "#9C27B0",
    gray: "#9E9E9E",
    black: "#000000",
    white: "#FFFFFF",
    cyan: "#00BCD4",
};

cmd({
    pattern: "togstatus",
    name: "togstatus",
    category: "Group",
    aliases: ["swgc", "groupstatus"],
    description: "Send text, image, video or audio as group status",
    filename: __filename
}, async (sock, m, args) => {

    const jid = m.from;

    const reply = (text) => m.reply(text);

    try {
        // Parse args: caption|color|groupUrl
        const raw = args.join(" ").trim();

        let [caption, color, groupUrl] = raw
            .split("|")
            .map((v) => v?.trim());

        // Resolve target group
        let targetGroupId = jid;

        if (groupUrl) {
            try {
                const code = groupUrl.split("/").pop().split("?")[0];
                const info = await sock.groupGetInviteInfo(code);

                targetGroupId = info.id;

                await reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦* ◈
┃
┃🎯 *𝗧𝗔𝗥𝗚𝗘𝗧 𝗚𝗥𝗢𝗨𝗣*
┃➽ ${info.subject}
┃
┗▣`);

            } catch {
                return reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦* ◈
┃
┃❌ *𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗚𝗥𝗢𝗨𝗣*
┃➽ Invalid group link or bot is not in that group.
┃
┗▣`);
            }
        }

        // Detect quoted message / direct media
        const quoted =
            m.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
            (m.message?.imageMessage ? m.message : null) ||
            (m.message?.videoMessage ? m.message : null) ||
            (m.message?.audioMessage ? m.message : null);

        // ── MEDIA DETECTION ────────────────────────────────────────────────
        const hasMedia =
            quoted &&
            (
                quoted.imageMessage ||
                quoted.videoMessage ||
                quoted.audioMessage
            );

        // ── TEXT STATUS ────────────────────────────────────────────────────
        if (!hasMedia) {

            if (!caption) {
                return reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦* ◈
┃
┃📝 *𝗨𝗦𝗔𝗚𝗘*
┃➽ .togstatus caption|color
┃➽ .togstatus |blue
┃
┃📌 *𝗠𝗘𝗗𝗜𝗔*
┃➽ Reply to an image
┃➽ Reply to a video
┃➽ Reply to an audio
┃
┃🎨 *𝗖𝗢𝗟𝗢𝗥𝗦*
┃➽ blue, green, yellow
┃➽ orange, red, purple
┃➽ gray, black, white
┃➽ cyan
┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`);
            }

            const bgHex =
                COLORS[color?.toLowerCase()] || COLORS.blue;

            await groupStatus(sock, targetGroupId, {
                extendedTextMessage: {
                    text: caption,
                    backgroundArgb: hexToArgb(bgHex),
                    font: 0,
                },
            });

            return reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦* ◈
┃
┃📝 *𝗧𝗬𝗣𝗘* : 𝗧𝗘𝗫𝗧
┃➽ ${caption}
┃
┃🎨 *𝗖𝗢𝗟𝗢𝗥* : ${color?.toUpperCase() || "BLUE"}
┃
┃✅ *𝗦𝗧𝗔𝗧𝗨𝗦* : 𝗦𝗘𝗡𝗧
┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`);
        }

        // ── IMAGE STATUS ───────────────────────────────────────────────────
        if (quoted.imageMessage) {

            const buf = await baileys.downloadMediaMessage(
                buildMsgObj(m, quoted),
                "buffer",
                {},
                {
                    reuploadRequest: sock.updateMediaMessage,
                }
            );

            const content =
                await baileys.generateWAMessageContent(
                    {
                        image: buf,
                        caption: caption || "",
                    },
                    {
                        upload: sock.waUploadToServer,
                    }
                );

            await groupStatus(
                sock,
                targetGroupId,
                content
            );

            return reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦* ◈
┃
┃🖼️ *𝗧𝗬𝗣𝗘* : 𝗜𝗠𝗔𝗚𝗘
┃
┃✅ *𝗦𝗧𝗔𝗧𝗨𝗦* : 𝗦𝗘𝗡𝗧
┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`);
        }

        // ── VIDEO STATUS ───────────────────────────────────────────────────
        if (quoted.videoMessage) {

            const buf = await baileys.downloadMediaMessage(
                buildMsgObj(m, quoted),
                "buffer",
                {},
                {
                    reuploadRequest: sock.updateMediaMessage,
                }
            );

            const content =
                await baileys.generateWAMessageContent(
                    {
                        video: buf,
                        caption: caption || "",
                    },
                    {
                        upload: sock.waUploadToServer,
                    }
                );

            await groupStatus(
                sock,
                targetGroupId,
                content
            );

            return reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦* ◈
┃
┃🎥 *𝗧𝗬𝗣𝗘* : 𝗩𝗜𝗗𝗘𝗢
┃
┃✅ *𝗦𝗧𝗔𝗧𝗨𝗦* : 𝗦𝗘𝗡𝗧
┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`);
        }

        // ── AUDIO STATUS ───────────────────────────────────────────────────
        if (quoted.audioMessage) {

            const buf = await baileys.downloadMediaMessage(
                buildMsgObj(m, quoted),
                "buffer",
                {},
                {
                    reuploadRequest: sock.updateMediaMessage,
                }
            );

            const vn = await toVN(buf);
            const waveform = await generateWaveform(buf);

            const content =
                await baileys.generateWAMessageContent(
                    {
                        audio: vn,
                        mimetype: "audio/ogg; codecs=opus",
                        ptt: true,
                    },
                    {
                        upload: sock.waUploadToServer,
                    }
                );

            if (content.audioMessage) {
                content.audioMessage.waveform =
                    Buffer.from(waveform, "base64");
            }

            await groupStatus(
                sock,
                targetGroupId,
                content
            );

            return reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦* ◈
┃
┃🎙️ *𝗧𝗬𝗣𝗘* : 𝗔𝗨𝗗𝗜𝗢
┃
┃✅ *𝗦𝗧𝗔𝗧𝗨𝗦* : 𝗦𝗘𝗡𝗧
┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`);
        }

        return reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦* ◈
┃
┃❌ *𝗨𝗡𝗦𝗨𝗣𝗣𝗢𝗥𝗧𝗘𝗗 𝗠𝗘𝗗𝗜𝗔*
┃➽ Reply to an image, video or audio.
┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`);

    } catch (err) {

        console.error("[togstatus]", err);

        return reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗨𝗦* ◈
┃
┃❌ *𝗦𝗧𝗔𝗧𝗨𝗦 𝗘𝗥𝗥𝗢𝗥*
┃➽ ${err.message}
┃
┗▣
> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗`);
    }
});


// ─── HELPERS ────────────────────────────────────────────────────────────────

function hexToArgb(hex) {
    const h = hex.replace("#", "");

    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);

    return ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
}


function buildMsgObj(originalMessage, quotedContent) {

    const ctxInfo =
        originalMessage.message
            ?.extendedTextMessage
            ?.contextInfo;

    return {
        key: {
            remoteJid: originalMessage.key.remoteJid,
            fromMe: false,
            id: ctxInfo?.stanzaId || originalMessage.key.id,
            participant: ctxInfo?.participant,
        },

        message: quotedContent,
    };
}


async function groupStatus(conn, jid, content) {

    const secret = crypto.randomBytes(32);

    const innerMsg =
        typeof content.toJSON === "function"
            ? content.toJSON()
            : content;

    const fullContent = {
        messageContextInfo: {
            messageSecret: secret,
        },

        groupStatusMessageV2: {
            message: {
                ...innerMsg,

                messageContextInfo: {
                    messageSecret: secret,
                },
            },
        },
    };

    const msg =
        baileys.generateWAMessageFromContent(
            jid,
            fullContent,
            {}
        );

    await conn.relayMessage(
        jid,
        msg.message,
        {
            messageId: msg.key.id,
        }
    );

    return msg;
}


function toVN(buffer) {

    return new Promise((resolve, reject) => {

        const input = new PassThrough();
        const output = new PassThrough();

        const chunks = [];

        input.end(buffer);

        ffmpeg(input)
            .noVideo()
            .audioCodec("libopus")
            .format("ogg")
            .audioChannels(1)
            .audioFrequency(48000)
            .on("error", reject)
            .on("end", () =>
                resolve(Buffer.concat(chunks))
            )
            .pipe(output);

        output.on("data", (c) =>
            chunks.push(c)
        );

        output.on("error", reject);
    });
}


function generateWaveform(buffer, bars = 64) {

    return new Promise((resolve, reject) => {

        const input = new PassThrough();
        const output = new PassThrough();

        const chunks = [];

        input.end(buffer);

        ffmpeg(input)
            .audioChannels(1)
            .audioFrequency(16000)
            .format("s16le")
            .on("error", reject)
            .on("end", () => {

                const raw = Buffer.concat(chunks);

                const samples = raw.length / 2;
                const amps = [];

                for (let i = 0; i < samples; i++) {
                    amps.push(
                        Math.abs(
                            raw.readInt16LE(i * 2)
                        ) / 32768
                    );
                }

                const size = Math.max(
                    1,
                    Math.floor(amps.length / bars)
                );

                const avg = Array.from(
                    { length: bars },
                    (_, i) => {

                        const slice = amps.slice(
                            i * size,
                            (i + 1) * size
                        );

                        return slice.length
                            ? slice.reduce(
                                (a, b) => a + b,
                                0
                            ) / slice.length
                            : 0;
                    }
                );

                const max =
                    Math.max(...avg) || 1;

                resolve(
                    Buffer.from(
                        avg.map(
                            (v) =>
                                Math.floor(
                                    (v / max) * 100
                                )
                        )
                    ).toString("base64")
                );
            })
            .pipe(output);

        output.on("data", (c) =>
            chunks.push(c)
        );

        output.on("error", reject);
    });
}
