require('./config')
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, generateWAMessageContent, generateWAMessageFromContent, generateMessageID, prepareWAMessageMedia, fetchLatestWaWebVersion, proto,generateProfilePicture, getContentType } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const http = require('http');
const axios = require('axios');
const QRCode = require('qrcode');
const { Boom } = require('@hapi/boom');
const { sendButtons, sendInteractiveMessage } = require('gifted-btns');
const serializeMessage = require('./handler.js');
const { decodeSessionId } = require('./lib/sessionLoader');
const { AntideleteHandler } = require('./lib/antidelete');
const { handleChatbotResponse } = require('./lib/chatbot');
const { handleLinkDetection } = require('./lib/antilink');
const JimpImport = require('jimp');
const AdmZip = require('adm-zip');

// Optional dependency — sticker maker degrades gracefully if not installed.
let sharp;
try {
    sharp = require('sharp');
} catch {
    sharp = null;
}

const Jimp =
  JimpImport.read
    ? JimpImport
    : JimpImport.Jimp
    ? JimpImport.Jimp
    : JimpImport.default;

global.generateWAMessageContent = generateWAMessageContent;
global.generateWAMessageFromContent = generateWAMessageFromContent;
global.generateMessageID = generateMessageID;
global.prepareWAMessageMedia = prepareWAMessageMedia;
global.proto = proto;
global.Jimp = Jimp;
global.generateProfilePicture = generateProfilePicture;
global.downloadMediaMessage = downloadMediaMessage;
global.bannedChats = global.bannedChats || [];

/* =========================================================
ADVANCED FEATURE STATE (moderation / anti-spam / warn system)
========================================================= */
global.antiCall = global.antiCall ?? false;
global.antiSpamEnabled = global.antiSpamEnabled ?? false;
global.antiSpamLimit = global.antiSpamLimit ?? 5;        // messages
global.antiSpamWindowMs = global.antiSpamWindowMs ?? 10000; // per 10s

const spamTracker = new Map(); // jid -> [timestamps]
const warnCounts = global.warnCounts instanceof Map ? global.warnCounts : new Map();
global.warnCounts = warnCounts;
const MAX_WARNINGS = 3;
// Note: warnCounts is in-memory only — it resets whenever the bot process
// restarts. Persist it to a file/DB yourself if you need it to survive restarts.

if (!fs.existsSync(__dirname + '/session/creds.json') && global.sessionid) {
    const result = decodeSessionId(global.sessionid);
    if (result.ok) {
        try {
            fs.mkdirSync(__dirname + '/session', { recursive: true });
            fs.writeFileSync(__dirname + '/session/creds.json', result.data);
            console.log('✅ Session restored from SESSION_ID');
        } catch (err) {
            console.error('Error writing restored session:', err.message);
        }
    } else {
        console.error('❌ Failed to restore session from SESSION_ID:', result.reason);
        console.warn('⚠️ Make sure you copied the FULL session string (e.g. POPKID~...).');
    }
}

const AUTH_FOLDER = './session';
const PLUGIN_FOLDER = './plugins';
const PORT = process.env.PORT || 3000;

let latestQR = '';
let botStatus = 'disconnected';
let pairingCodes = new Map();
let presenceInterval = null;
let sock = null;
let isConnecting = false;
let lastStatusReactTime = 0;
const BOOT_TIME = Date.now();

/*
|--------------------------------------------------------------------------
| BOX FORMATTING HELPER
|--------------------------------------------------------------------------
| Same ┏▣ ◈ ... ┗▣ style already used by mode.js / sudo.js / bot-status.js /
| cmdreact.js, so console output and WhatsApp messages share one look.
| Pure formatting — doesn't touch any existing logic.
|--------------------------------------------------------------------------
*/
function box(title, lines) {
    const body = lines.map(line => `┃${line}`).join('\n');
    return `┏▣ ◈ *${title}* ◈\n┃\n${body}\n┃\n┗▣`;
}

// Converts plain ASCII into the same bold sans-serif unicode style used
// by mode.js / sudo.js / bot-status.js / cmdreact.js (e.g. 𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗢𝗗𝗘),
// so titles sent to WhatsApp match your plugin branding exactly.
function toBoldSans(str) {
    return str.split('').map(ch => {
        const code = ch.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D5D4 + (code - 65));  // A-Z
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D5EE + (code - 97)); // a-z
        if (code >= 48 && code <= 57) return String.fromCodePoint(0x1D7EC + (code - 48));  // 0-9
        return ch;
    }).join('');
}

// Same box, but with a branded bold-unicode title — use this for anything
// sent TO WhatsApp (chat messages). Keep plain box() for console logs,
// since terminals often can't render these unicode glyphs cleanly.
function waBox(title, lines) {
    return box(toBoldSans(title), lines);
}

function formatUptime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h}h ${m}m ${s}s`;
}

// Pulls live state from mode.js / bot-status.js / cmdreact.js if those
// plugins are loaded, with safe fallbacks if they aren't.
function getFeatureState() {
    return {
        mode: global.botMode === 'private' ? '🔒 PRIVATE' : '🌐 PUBLIC',
        power: global.botStatus2 === 'off' ? '🔴 OFF' : '🟢 ON',
        cmdReact: global.cmdReactEnabled ? '✅ ON' : '❌ OFF'
    };
}

// --- Status-reaction LID resolution -----------------------------------
// WhatsApp sometimes reports a status poster as an @lid (linked-device id)
// instead of their real @s.whatsapp.net JID. Reacting to a status with the
// wrong JID in `key.participant` fails silently, which is why "auto like
// status" can look broken even though the code runs without errors.
// This cache + resolver mirrors the approach used by Toxic-MD: cache any
// LID→phone mapping we learn, and try several real resolution paths
// (Baileys' own lid-mapping store first) before falling back to whatever
// Baileys handed us.
const lidPhoneCache = new Map();

function cacheLidPhone(lidNum, phoneNum) {
    if (!lidNum || !phoneNum || lidNum === phoneNum) return;
    lidPhoneCache.set(lidNum, phoneNum);
}

async function resolveStatusParticipant(sock, rawMsg) {
    const rawParticipant = rawMsg.key.participant;
    if (!rawParticipant || !rawParticipant.endsWith('@lid')) {
        return rawParticipant;
    }

    const lidNum = rawParticipant.split('@')[0].split(':')[0];

    // 1) Already resolved this LID before in this session.
    const cached = lidPhoneCache.get(lidNum);
    if (cached) {
        return `${cached}@s.whatsapp.net`;
    }

    // 2) Baileys sometimes attaches the real number directly on the event.
    const rawPn = rawMsg.key?.participantPn || rawMsg.key?.senderPn || rawMsg.participantPn;
    if (rawPn) {
        const resolved = rawPn.includes('@') ? rawPn : `${rawPn}@s.whatsapp.net`;
        const phoneNum = resolved.split('@')[0].split(':')[0];
        cacheLidPhone(lidNum, phoneNum);
        return resolved;
    }

    // 3) Ask Baileys' own LID↔PN mapping store, trying a couple of formats
    //    since the stored key isn't always exactly what we received.
    if (sock.signalRepository?.lidMapping?.getPNForLID) {
        const variants = [rawParticipant, `${lidNum}:0@lid`, `${lidNum}@lid`];
        for (const variant of variants) {
            try {
                const pn = await sock.signalRepository.lidMapping.getPNForLID(variant);
                if (pn && typeof pn === 'string') {
                    const phoneNum = pn.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
                    if (phoneNum.length >= 7 && phoneNum !== lidNum) {
                        cacheLidPhone(lidNum, phoneNum);
                        return `${phoneNum}@s.whatsapp.net`;
                    }
                }
            } catch (err) {
                // try the next variant
            }
        }
    }

    // 4) Legacy fallback some Baileys builds exposed.
    if (typeof sock.getJidFromLid === 'function') {
        const resolved = await sock.getJidFromLid(rawParticipant).catch(() => null);
        if (resolved) {
            const phoneNum = resolved.split('@')[0].split(':')[0];
            cacheLidPhone(lidNum, phoneNum);
            return resolved;
        }
    }

    // Nothing worked — return the raw @lid, same as before, so the caller
    // keeps its existing "best effort" behavior instead of crashing.
    return rawParticipant;
}
// -----------------------------------------------------------------------

/* =========================================================
ADVANCED FEATURES — MODERATION / MEDIA / ADMIN TOOLS
========================================================= */

// --- Toggle helper for owner-only on/off commands (.anticall, .antispam) ---
async function handleToggle(m, args, stateKey, label) {
    if (!(m.isOwner || m.isDev)) {
        return m.reply('❌ Owner only.');
    }
    const value = (args[0] || '').toLowerCase();
    if (value !== 'on' && value !== 'off') {
        return m.reply(`❌ Usage: ${global.BOT_PREFIX}${label.toLowerCase().replace(/\s+/g, '')} on|off`);
    }
    global[stateKey] = value === 'on';
    return m.reply(`✅ ${label} turned ${value.toUpperCase()}.`);
}

// --- Warn system: .warn (reply or @mention) [reason] ---
async function handleWarn(sock, m, rawMsg, args) {
    if (!(m.isAdmin || m.isOwner || m.isDev)) {
        return m.reply('❌ Admins only.');
    }

    const mentioned = rawMsg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    const quotedParticipant = rawMsg.message?.extendedTextMessage?.contextInfo?.participant;
    const target = mentioned || quotedParticipant;

    if (!target) {
        return m.reply('❌ Tag or reply to the user you want to warn.');
    }

    const reason = args.filter(a => !a.startsWith('@')).join(' ') || 'No reason given';
    const count = (warnCounts.get(target) || 0) + 1;
    warnCounts.set(target, count);

    if (count >= MAX_WARNINGS) {
        warnCounts.set(target, 0);
        try {
            await sock.groupParticipantsUpdate(m.from, [target], 'remove');
            await sock.sendMessage(m.from, {
                text: waBox('WARN SYSTEM', [
                    `🚫 @${target.split('@')[0]} reached ${MAX_WARNINGS} warnings and was removed.`
                ]),
                mentions: [target]
            });
        } catch (err) {
            await m.reply(`⚠️ Warning limit reached but I couldn't remove them (am I an admin?): ${err.message}`);
        }
    } else {
        await sock.sendMessage(m.from, {
            text: waBox('WARN SYSTEM', [
                `⚠️ @${target.split('@')[0]} warned (${count}/${MAX_WARNINGS})`,
                `📝 Reason: ${reason}`
            ]),
            mentions: [target]
        });
    }
}

// --- .resetwarn (reply or @mention) ---
async function handleResetWarn(m, rawMsg) {
    if (!(m.isAdmin || m.isOwner || m.isDev)) {
        return m.reply('❌ Admins only.');
    }
    const target = rawMsg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
        || rawMsg.message?.extendedTextMessage?.contextInfo?.participant;
    if (!target) {
        return m.reply('❌ Tag or reply to a user.');
    }
    warnCounts.set(target, 0);
    return m.reply('✅ Warnings reset.');
}

// --- Sticker maker: .sticker / .s (reply to an image, or caption an image) ---
async function handleSticker(sock, m, rawMsg) {
    if (!sharp) {
        return m.reply('❌ Sticker maker needs the "sharp" package. Run: npm install sharp');
    }

    const ctx = rawMsg.message?.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;
    let targetMsg;

    if (quoted?.imageMessage) {
        targetMsg = {
            message: quoted,
            key: {
                remoteJid: m.from,
                id: ctx.stanzaId,
                fromMe: false,
                participant: ctx.participant
            }
        };
    } else if (rawMsg.message?.imageMessage) {
        targetMsg = rawMsg;
    } else {
        return m.reply('❌ Reply to an image with .sticker (or send an image captioned .sticker).');
    }

    try {
        const buffer = await downloadMediaMessage(targetMsg, 'buffer', {});
        const webp = await sharp(buffer)
            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp()
            .toBuffer();
        await sock.sendMessage(m.from, { sticker: webp });
    } catch (err) {
        await m.reply(`❌ Sticker failed: ${err.message}`);
    }
}

// --- Broadcast: .broadcast <message> (owner only) ---
async function handleBroadcast(sock, m, args) {
    const text = args.join(' ');
    if (!text) {
        return m.reply('❌ Usage: .broadcast <message>');
    }
    try {
        const groups = await sock.groupFetchAllParticipating();
        const ids = Object.keys(groups);
        let sent = 0;
        for (const gid of ids) {
            try {
                await sock.sendMessage(gid, { text: waBox('BROADCAST', [text]) });
                sent++;
                await new Promise(resolve => setTimeout(resolve, 1500)); // avoid WA rate limits
            } catch {}
        }
        await m.reply(`✅ Broadcast sent to ${sent}/${ids.length} groups.`);
    } catch (err) {
        await m.reply(`❌ Broadcast failed: ${err.message}`);
    }
}

// --- Session backup: .backup (owner only, DM recommended) ---
async function handleBackup(sock, m) {
    if (!fs.existsSync(AUTH_FOLDER)) {
        return m.reply('❌ No session folder found to back up.');
    }
    try {
        const zip = new AdmZip();
        zip.addLocalFolder(AUTH_FOLDER);
        const buffer = zip.toBuffer();
        await sock.sendMessage(m.from, {
            document: buffer,
            fileName: `session-backup-${Date.now()}.zip`,
            mimetype: 'application/zip',
            caption: waBox('SESSION BACKUP', [
                '🗄️ Keep this file safe.',
                '⚠️ Anyone with it can access your WhatsApp session.'
            ])
        });
    } catch (err) {
        await m.reply(`❌ Backup failed: ${err.message}`);
    }
}

// --- Session restore: reply to a .zip backup with .restore (owner only) ---
async function handleRestore(sock, m, rawMsg) {
    const ctx = rawMsg.message?.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;
    const docMsg = quoted?.documentMessage;

    if (!docMsg) {
        return m.reply('❌ Reply to a session backup .zip file with .restore');
    }

    try {
        const targetMsg = {
            message: quoted,
            key: {
                remoteJid: m.from,
                id: ctx.stanzaId,
                fromMe: false,
                participant: ctx.participant
            }
        };
        const buffer = await downloadMediaMessage(targetMsg, 'buffer', {});
        const zip = new AdmZip(buffer);

        fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        fs.mkdirSync(AUTH_FOLDER, { recursive: true });
        zip.extractAllTo(AUTH_FOLDER, true);

        await m.reply('✅ Session restored. Reconnecting...');

        if (sock) {
            try { sock.end(); } catch {}
        }
        setTimeout(() => startBot(), 2000);
    } catch (err) {
        await m.reply(`❌ Restore failed: ${err.message}`);
    }
}

// --- Native command dispatcher — checked before the plugin registry ---
async function handleNativeCommand(sock, m, rawMsg, commandName, args) {
    switch (commandName) {
        case 'anticall':
            await handleToggle(m, args, 'antiCall', 'Anti-call');
            return true;
        case 'antispam':
            await handleToggle(m, args, 'antiSpamEnabled', 'Anti-spam');
            return true;
        case 'warn':
            await handleWarn(sock, m, rawMsg, args);
            return true;
        case 'resetwarn':
            await handleResetWarn(m, rawMsg);
            return true;
        case 'sticker':
        case 's':
            await handleSticker(sock, m, rawMsg);
            return true;
        case 'broadcast':
            if (!(m.isOwner || m.isDev)) { await m.reply('❌ Owner only.'); return true; }
            await handleBroadcast(sock, m, args);
            return true;
        case 'backup':
            if (!(m.isOwner || m.isDev)) { await m.reply('❌ Owner only.'); return true; }
            await handleBackup(sock, m);
            return true;
        case 'restore':
            if (!(m.isOwner || m.isDev)) { await m.reply('❌ Owner only.'); return true; }
            await handleRestore(sock, m, rawMsg);
            return true;
        default:
            return false;
    }
}
// -----------------------------------------------------------------------

function loadPrefix() {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.prefix) {
                global.BOT_PREFIX = config.prefix;
                console.log(`✅ Loaded prefix: ${global.BOT_PREFIX}`);
            }
        } catch (err) {
            console.error('Error loading config:', err);
        }
    }
    startBot();
}

function startBot() {
    console.log(box('POPKID BOT', ['🚀 Starting WhatsApp Bot...']));
    isConnecting = true;

    if (!fs.existsSync(AUTH_FOLDER)) {
        fs.mkdirSync(AUTH_FOLDER, { recursive: true });
    }

    const credsPath = path.join(AUTH_FOLDER, 'creds.json');
    if (fs.existsSync(credsPath)) {
        try {
            const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
            if (creds.noiseKey && creds.noiseKey.private) {

                console.log('📁 Using existing session...');
            } else {
                console.log('⚠️ Invalid session detected, will create new one...');
            }
        } catch (err) {
            console.log('⚠️ Corrupted session, will create new one...');
        }
    }

    (async () => {
        try {
            const { version, isLatest } = await fetchLatestWaWebVersion();
            console.log(`📱 Using WA v${version.join(".")}, isLatest: ${isLatest}`);

            const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

            sock = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                auth: state,
                printQRInTerminal: true,
                keepAliveIntervalMs: 10000,
                markOnlineOnConnect: true,
                syncFullHistory: false,
                browser: ['Bot', 'Chrome', '1.0.0']
            });

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    QRCode.toDataURL(qr, (err, url) => {
                        if (!err) {
                            latestQR = url;
                        }
                    });
                }

                if (connection === 'close') {
                    botStatus = 'disconnected';
                    isConnecting = false;

                    if (presenceInterval) {
                        clearInterval(presenceInterval);
                        presenceInterval = null;
                    }

                    const statusCode = (lastDisconnect?.error instanceof Boom)
                        ? lastDisconnect.error.output.statusCode
                        : 0;

                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                    if (shouldReconnect) {
                        console.log(box('POPKID BOT', ['⚠️ Connection closed', '🔁 Reconnecting in 5s...']));
                        setTimeout(() => startBot(), 5000);
                    } else {
                        console.log(box('POPKID BOT', ['🚪 Logged out', '🗑️ Clearing session...']));
                        if (fs.existsSync(AUTH_FOLDER)) {
                            fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
                        }
                        setTimeout(() => startBot(), 3000);
                    }
                }

                else if (connection === 'open') {
                    botStatus = 'connected';
                    isConnecting = false;

                    if (!global.owners) global.owners = [];
                    if (!global.owners.includes(sock.user.id)) {
                        global.owners.push(sock.user.id);
                    }

                    presenceInterval = setInterval(() => {
                        if (sock?.ws?.readyState === 1) {
                            sock.sendPresenceUpdate('available');
                        }
                    }, 10000);

                    // Small delay so the socket is fully ready before sending
                    await new Promise(resolve => setTimeout(resolve, 1500));

                    // Clean self-JID (strip :device suffix) so the DM actually lands
                    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

                    console.log(box('POPKID BOT', ['✅ Connected and ready!']));

                    try {
                        await sock.newsletterFollow('120363426778975572@newsletter');
                        console.log('📡 Auto-followed Official Newsletter');
                    } catch (err) {
                        console.log('Newsletter follow verified.');
                    }

                    try {
                        const feat = getFeatureState();
                        await sock.sendMessage(botNumber, {
                            text: waBox('POPKID BOT CONNECTED', [
                                `➽ ⏰ *Time* : ${new Date().toLocaleString()}`,
                                `➽ ✅ *Status* : Online and Ready!`,
                                `➽ 📝 *Prefix* : ${global.BOT_PREFIX}`,
                                `➽ 👑 *Owners* : ${global.owners.length}`,
                                `➽ ⚙️ *Mode* : ${feat.mode}`,
                                `➽ 🔌 *Power* : ${feat.power}`,
                                `➽ 💬 *Cmd Reactions* : ${feat.cmdReact}`,
                                ``,
                                `➽ Make sure to join below channel`
                            ]),
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363426778975572@newsletter',
                                    newsletterName: 'Popkid',
                                    serverMessageId: -1
                                }
                            }
                        });
                    } catch (err) {
                        console.log('❌ Connection message error:', err.message);
                    }
                }

                else if (connection === 'connecting') {
                    botStatus = 'connecting';
                    isConnecting = true;
                }
            });

            sock.ev.on('creds.update', async () => {
                await saveCreds();
                console.log('💾 Credentials updated');
            });

            // --- Anti-call: reject incoming calls when enabled ---
            sock.ev.on('call', async (calls) => {
                if (!global.antiCall) return;
                for (const call of calls) {
                    try {
                        if (call.status === 'offer') {
                            await sock.rejectCall(call.id, call.from);
                            console.log(`📵 Rejected call from ${call.from}`);
                            try {
                                await sock.sendMessage(call.from, {
                                    text: waBox('ANTI CALL', ['🚫 Calls are disabled for this bot.'])
                                });
                            } catch {}
                        }
                    } catch (err) {
                        console.log('❌ Anti-call error:', err.message);
                    }
                }
            });

            // global.plugins is shared with arslan.js's cmd() registry, so a
            // command-style plugin (const { cmd } = require('../arslan')) and a
            // legacy { name, execute } plugin land in the exact same Map.
            global.plugins = global.plugins instanceof Map ? global.plugins : new Map();
            const plugins = global.plugins;
            const pluginPath = path.join(__dirname, PLUGIN_FOLDER);

            if (fs.existsSync(pluginPath)) {
                try {
                    const pluginFiles = fs.readdirSync(pluginPath).filter(file => file.endsWith('.js'));

                    for (const file of pluginFiles) {
                        try {
                            const beforeCount = plugins.size;
                            const plugin = require(path.join(pluginPath, file));

                            if (plugins.size > beforeCount) {
                                // Self-registered one or more commands via cmd() in ./arslan.js
                                console.log(`✅ Loaded command plugin: ${file}`);
                            } else if (plugin && plugin.name && typeof plugin.execute === 'function') {
                                plugins.set(plugin.name.toLowerCase(), plugin);
                                if (Array.isArray(plugin.aliases)) {
                                    plugin.aliases.forEach(alias => {
                                        plugins.set(alias.toLowerCase(), plugin);
                                    });
                                }
                                console.log(`✅ Loaded plugin: ${plugin.name}`);
                            } else {
                                console.warn(`⚠️ Invalid plugin structure in ${file}`);
                            }
                        } catch (error) {
                            console.error(`❌ Failed to load plugin ${file}:`, error.message);
                        }
                    }
                    console.log(`📦 Total plugins loaded: ${plugins.size}`);
                    global.plugins = plugins;
                } catch (error) {
                    console.error('❌ Error loading plugins:', error);
                }
            } else {
                console.log('📁 No plugins folder found');
            }

            sock.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify' && type !== 'append') return;

                const CHANNEL_ID = "120363426778975572@newsletter";

                for (const rawMsg of messages) {
                    if (rawMsg.key?.remoteJid === CHANNEL_ID && rawMsg.key?.server_id) {
                        const emojis = ["❤️", "💛", "👍", "💜", "😮", "🤍", "💙", "🔥", "💯", "⚡"];
                        const emoji = emojis[Math.floor(Math.random() * emojis.length)];

                        try {
                            await sock.newsletterReactMessage(
                                CHANNEL_ID,
                                rawMsg.key.server_id.toString(),
                                emoji
                            );
                            console.log(`✅ Channel reaction: ${emoji} to message ${rawMsg.key.server_id}`);
                        } catch (err) {
                            console.log("❌ Channel React Error:", err.message);
                        }
                        continue;
                    }
                }

                for (const rawMsg of messages) {
                    if (rawMsg.key.remoteJid === 'status@broadcast' && rawMsg.key.participant) {
                        if (global.autoView) {
                            try {
                                console.log(`📱 Status detected from: ${rawMsg.key.participant}`);
                                await sock.readMessages([rawMsg.key]);
                            } catch (err) {
                                console.log('❌ Status viewer error:', err.message);
                            }
                        }

                        if (global.autoLike) {
                            try {
                                const now = Date.now();
                                if (now - lastStatusReactTime < (global.statusReactThrottleMs ?? 5000)) {
                                    // Throttle: skip if we reacted too recently
                                } else {
                                    // Resolve the poster's real JID — WhatsApp sometimes reports
                                    // this as an @lid (linked-device id) instead of @s.whatsapp.net,
                                    // and status reactions silently fail if sent to an @lid.
                                    const realJid = await resolveStatusParticipant(sock, rawMsg);

                                    const resolvedKey = {
                                        remoteJid: 'status@broadcast',
                                        id: rawMsg.key.id,
                                        participant: realJid
                                    };

                                    const contentType = getContentType(rawMsg.message);
                                    const reactable = ['imageMessage', 'videoMessage', 'extendedTextMessage', 'conversation', 'audioMessage'];

                                    if (reactable.includes(contentType)) {
                                        const emojis = ["❤️", "🩶", "🔥", "🤍", "♦️", "🎉", "💚", "💯", "✨", "😍", "🎊"];
                                        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
                                        const botId = sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user?.id;

                                        await sock.sendMessage('status@broadcast',
                                            { react: { text: emoji, key: resolvedKey } },
                                            { statusJidList: [realJid, botId].filter(Boolean) }
                                        );

                                        lastStatusReactTime = Date.now();
                                        await new Promise(resolve => setTimeout(resolve, global.statusReactDelayMs ?? 2000));
                                    }
                                }
                            } catch (err) {
                                console.log('❌ Status like error:', err.message);
                            }
                        }

                        continue;
                    }
                }

                for (const rm of messages) {
                    AntideleteHandler(sock, rm).catch(err => console.error('Antidelete hook error:', err.message));
                }

                const rawMsg = messages[0];
                if (!rawMsg.message) return;

                const m = await serializeMessage(sock, rawMsg);

                // --- Anti-spam: rate-limit non-owner senders ---
                if (global.antiSpamEnabled && !rawMsg.key.fromMe && m.sender) {
                    const now = Date.now();
                    const timestamps = (spamTracker.get(m.sender) || []).filter(
                        t => now - t < global.antiSpamWindowMs
                    );
                    timestamps.push(now);
                    spamTracker.set(m.sender, timestamps);

                    if (timestamps.length > global.antiSpamLimit) {
                        spamTracker.set(m.sender, []);
                        try {
                            await m.reply(waBox('ANTI SPAM', [`⚠️ Please slow down, ${m.pushName || 'there'}.`]));
                        } catch {}
                    }
                }

                if (global.autoRead) {
                    try { await sock.readMessages([rawMsg.key]); } catch (err) {}
                }

                if (global.presenceMode && global.presenceMode !== 'none' && m.from) {
                    try {
                        if (global.presenceMode === 'typing') await sock.sendPresenceUpdate('composing', m.from);
                        else if (global.presenceMode === 'recording') await sock.sendPresenceUpdate('recording', m.from);
                        else if (global.presenceMode === 'online') await sock.sendPresenceUpdate('available', m.from);
                    } catch (err) {}
                }

                if (m.isGroup && !rawMsg.key.fromMe) {
                    handleChatbotResponse(sock, m.from, rawMsg, m.body || '', m.sender)
                        .catch(err => console.error('Chatbot hook error:', err.message));

                    const isExempt = m.isAdmin || m.isOwner || m.isDev;
                    handleLinkDetection(sock, m.from, rawMsg, m.body || '', m.sender, isExempt)
                        .catch(err => console.error('Antilink hook error:', err.message));
                }

                for (const plugin of plugins.values()) {
                    if (typeof plugin.onMessage === 'function') {
                        try {
                            const blocked = await plugin.onMessage(sock, m);
                            if (blocked === true) return;
                        } catch (err) {
                            console.error(`❌ onMessage error (${plugin.name}):`, err);
                        }
                    }
                }

                if (m.body && m.body.startsWith(global.BOT_PREFIX)) {
                    const args = m.body.slice(global.BOT_PREFIX.length).trim().split(/\s+/);
                    const commandName = args.shift().toLowerCase();

                    const nativeHandled = await handleNativeCommand(sock, m, rawMsg, commandName, args);
                    if (nativeHandled) return;

                    const plugin = plugins.get(commandName);

                    if (plugin) {
                        try {
                            await plugin.execute(sock, m, args);
                        } catch (err) {
                            console.error(`❌ Plugin error (${commandName}):`, err);
                            await m.reply('❌ Error running command.');
                        }
                    }
                }
            });

            sock.ev.on('group-participants.update', async (update) => {
                try {
                    if (!global.welcomeConfig?.enabled) return

                    const groupId = update.id

                    for (const participant of update.participants) {

                        const userId = typeof participant === 'string'
                            ? participant
                            : participant.phoneNumber || participant.id

                        if (!userId) continue

                        const memberName = userId.split('@')[0]

                        if (update.action === 'add') {

                            if (userId === sock.user.id) continue

                            const text = `👋 Welcome @${memberName}!\n🎉 Glad to have you in this group!`

                            await sock.sendMessage(groupId, {
                                text,
                                mentions: [userId]
                            })

                        } else if (update.action === 'remove') {

                            const text = `ya @${memberName} has left the group.\nWe are not gonna miss you!`

                            await sock.sendMessage(groupId, {
                                text,
                                mentions: [userId]
                            })

                        }
                    }

                } catch (err) {
                    console.error('❌ group-participants.update error:', err)
                }
            })

            sock.ev.on('messages.reaction', async (reactions) => {
                console.log('💖 Reaction update:', reactions);
            });

        } catch (error) {
            console.error('❌ Bot startup error:', error);
            isConnecting = false;
            setTimeout(() => startBot(), 5000);
        }
    })();
}

function collectRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 1e6) {
                req.destroy();
                reject(new Error('Request body too large'));
            }
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    const urlPath = req.url;

    if (urlPath === '/' || urlPath === '/qr') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<img src="${latestQR}" />`);
    } else if (urlPath === '/ping') {
        // Lightweight route for self-pings and external uptime monitors —
        // no work done, just proves the process is alive and accepting HTTP.
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('pong');
    } else if (urlPath === '/status' && req.method === 'GET') {
        // Enhanced: now also reports uptime and live mode/power/cmdreact
        // state from mode.js / bot-status.js / cmdreact.js, on top of the
        // original status/connecting fields.
        const feat = getFeatureState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: botStatus,
            connecting: isConnecting,
            uptime: formatUptime(Date.now() - BOOT_TIME),
            mode: feat.mode,
            power: feat.power,
            cmdReact: feat.cmdReact
        }));
    } else if (urlPath === '/pair' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('Pairing endpoint');
    } else if (urlPath === '/pair' && req.method === 'POST') {
        try {
            const body = await collectRequestBody(req);
            const params = new URLSearchParams(body);
            const number = (params.get('number') || '').replace(/[^0-9]/g, '');
            if (!number) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end('Number required');
            }
            if (!sock) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end('Bot not ready');
            }
            const code = await sock.requestPairingCode(number);
            pairingCodes.set(number, code);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('Pairing code: ' + code + '');
        } catch (err) {
            console.error('Pairing error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end('Error: ' + err.message);
        }
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('Not found');
    }
});

// -----------------------------------------------------------------------
// Self-heal EADDRINUSE + graceful shutdown.
//
// Without server.on('error', ...), a failed .listen() surfaces as an
// unhandled 'error' event, which the global uncaughtException handler
// below only logs — leaving the process alive with no HTTP server bound
// (the panel then shows "Nothing to show" even though the bot itself
// connects to WhatsApp fine). This retries instead.
//
// The gracefulShutdown() handler below is the other half: if the panel's
// restart/stop sends SIGTERM, this closes the socket cleanly so the NEXT
// process to start doesn't hit EADDRINUSE against a lingering one. If your
// panel force-kills (SIGKILL) instead of SIGTERM, this can't help — that's
// a panel-level setting, not something index.js can intercept.
// -----------------------------------------------------------------------
let listenRetryTimer = null;

function startServer() {
    server.listen(PORT, () => {
        console.log(box('POPKID BOT', [`🌐 Server listening on port ${PORT}`]));
    });
}

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(box('POPKID BOT', [
            `⚠️ Port ${PORT} already in use.`,
            `🔁 Retrying in 5s...`
        ]));

        if (listenRetryTimer) return;

        listenRetryTimer = setTimeout(() => {
            listenRetryTimer = null;
            try {
                server.close();
            } catch {}
            startServer();
        }, 5000);
    } else {
        console.error('❌ Server error:', err);
    }
});

function gracefulShutdown(signal) {
    console.log(box('POPKID BOT', [`🛑 Received ${signal}`, '🔒 Closing server...']));
    try {
        server.close(() => process.exit(0));
    } catch {
        process.exit(0);
    }
    // Force-exit if close() hangs (e.g. keep-alive sockets still open)
    setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/* =========================================================
KEEP-ALIVE — best-effort fix for hosts that sleep on inactivity
========================================================= */
// SELF_URL is your bot's public URL, e.g. https://yourapp.onrender.com
// Set it as an env var. Render also auto-provides RENDER_EXTERNAL_URL.
const SELF_URL = process.env.SELF_URL || process.env.RENDER_EXTERNAL_URL || '';

function pingSelf() {
    // Internal heartbeat — cheap, harmless, keeps the event loop busy.
    // Only helps on hosts that watch process activity rather than
    // external HTTP traffic.
    http.get(`http://127.0.0.1:${PORT}/ping`, res => res.resume()).on('error', () => {});

    // External-looking ping to the bot's own public URL — this is what
    // actually resets most hosts' "no traffic for N minutes → sleep" timer.
    if (SELF_URL) {
        axios.get(`${SELF_URL.replace(/\/$/, '')}/ping`, { timeout: 10000 }).catch(() => {});
    }
}

if (!SELF_URL) {
    console.log(box('KEEP-ALIVE', [
        '⚠️ SELF_URL not set — external self-ping is disabled.',
        '📌 Set SELF_URL to your public URL, e.g.',
        '   https://yourapp.onrender.com',
        '📌 Or use a free monitor (UptimeRobot, cron-job.org, Better Uptime)',
        '   hitting your /ping URL every 5 min — this is the most reliable',
        '   fix for hosts that sleep on inactivity.'
    ]));
} else {
    console.log(box('KEEP-ALIVE', [`✅ Self-ping enabled for ${SELF_URL}`]));
}

setInterval(pingSelf, 4 * 60 * 1000); // every 4 minutes

startServer();
global.server = server;
global.PORT = PORT;
loadPrefix();
process.on('uncaughtException', err => {
    console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', err => {
    console.error('Unhandled rejection:', err);
});
