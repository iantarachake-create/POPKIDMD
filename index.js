'use strict';

require('./config');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    generateWAMessageContent,
    generateWAMessageFromContent,
    generateMessageID,
    prepareWAMessageMedia,
    fetchLatestWaWebVersion,
    proto,
    generateProfilePicture,
    getContentType
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const fs = require('fs');
const path = require('path');
const http = require('http');
const QRCode = require('qrcode');
const { Boom } = require('@hapi/boom');
const { sendButtons, sendInteractiveMessage } = require('gifted-btns');
const serializeMessage = require('./handler.js');
const { decodeSessionId } = require('./lib/sessionLoader');
const { AntideleteHandler } = require('./lib/antidelete');
const { handleChatbotResponse } = require('./lib/chatbot');
const { handleLinkDetection } = require('./lib/antilink');
const JimpImport = require('jimp');


/* =========================================================
   JIMP
========================================================= */

const Jimp =
    JimpImport.read
        ? JimpImport
        : JimpImport.Jimp
        ? JimpImport.Jimp
        : JimpImport.default;


/* =========================================================
   GLOBALS
========================================================= */

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
   SESSION RESTORATION
========================================================= */

if (
    !fs.existsSync(
        path.join(__dirname, 'session', 'creds.json')
    ) &&
    global.sessionid
) {
    const result = decodeSessionId(global.sessionid);

    if (result.ok) {
        try {
            fs.mkdirSync(
                path.join(__dirname, 'session'),
                {
                    recursive: true
                }
            );

            fs.writeFileSync(
                path.join(__dirname, 'session', 'creds.json'),
                result.data
            );

            console.log(
                '✅ Session restored from SESSION_ID'
            );

        } catch (err) {
            console.error(
                'Error writing restored session:',
                err.message
            );
        }

    } else {
        console.error(
            '❌ Failed to restore session from SESSION_ID:',
            result.reason
        );

        console.warn(
            '⚠️ Make sure you copied the FULL session string (e.g. POPKID~...).'
        );
    }
}


/* =========================================================
   CONFIG
========================================================= */

const AUTH_FOLDER =
    path.join(__dirname, 'session');

const PLUGIN_FOLDER =
    path.join(__dirname, 'plugins');

/*
 * IMPORTANT:
 *
 * Always prefer the hosting platform's PORT.
 * 3000 is only the fallback for local usage.
 */

const PORT =
    Number(process.env.PORT) || 3000;

const HOST =
    '0.0.0.0';


/* =========================================================
   STATE
========================================================= */

let latestQR = '';

let botStatus =
    'disconnected';

let pairingCodes =
    new Map();

let presenceInterval =
    null;

let sock =
    null;

let isConnecting =
    false;

let lastStatusReactTime =
    0;

let reconnectTimer =
    null;

let shuttingDown =
    false;

let serverStarted =
    false;

const BOOT_TIME =
    Date.now();


/* =========================================================
   BOX FORMATTING
========================================================= */

function box(title, lines) {

    const body =
        lines
            .map(line => `┃${line}`)
            .join('\n');

    return `┏▣ ◈ *${title}* ◈\n┃\n${body}\n┃\n┗▣`;
}


/* =========================================================
   BOLD SANS
========================================================= */

function toBoldSans(str) {

    return String(str)
        .split('')
        .map(ch => {

            const code =
                ch.charCodeAt(0);

            if (
                code >= 65 &&
                code <= 90
            ) {
                return String.fromCodePoint(
                    0x1D5D4 +
                    (code - 65)
                );
            }

            if (
                code >= 97 &&
                code <= 122
            ) {
                return String.fromCodePoint(
                    0x1D5EE +
                    (code - 97)
                );
            }

            if (
                code >= 48 &&
                code <= 57
            ) {
                return String.fromCodePoint(
                    0x1D7EC +
                    (code - 48)
                );
            }

            return ch;

        })
        .join('');
}


/* =========================================================
   WHATSAPP BOX
========================================================= */

function waBox(title, lines) {

    return box(
        toBoldSans(title),
        lines
    );
}


/* =========================================================
   UPTIME
========================================================= */

function formatUptime(ms) {

    const totalSec =
        Math.floor(ms / 1000);

    const h =
        Math.floor(totalSec / 3600);

    const m =
        Math.floor(
            (totalSec % 3600) / 60
        );

    const s =
        totalSec % 60;

    return `${h}h ${m}m ${s}s`;
}


/* =========================================================
   FEATURE STATE
========================================================= */

function getFeatureState() {

    return {

        mode:
            global.botMode === 'private'
                ? '🔒 PRIVATE'
                : '🌐 PUBLIC',

        power:
            global.botStatus2 === 'off'
                ? '🔴 OFF'
                : '🟢 ON',

        cmdReact:
            global.cmdReactEnabled
                ? '✅ ON'
                : '❌ OFF'
    };
}


/* =========================================================
   STATUS LID CACHE
========================================================= */

const lidPhoneCache =
    new Map();


function cacheLidPhone(
    lidNum,
    phoneNum
) {

    if (
        !lidNum ||
        !phoneNum ||
        lidNum === phoneNum
    ) {
        return;
    }

    lidPhoneCache.set(
        lidNum,
        phoneNum
    );
}


/* =========================================================
   RESOLVE STATUS PARTICIPANT
========================================================= */

async function resolveStatusParticipant(
    sockInstance,
    rawMsg
) {

    const rawParticipant =
        rawMsg.key.participant;

    if (
        !rawParticipant ||
        !rawParticipant.endsWith('@lid')
    ) {
        return rawParticipant;
    }

    const lidNum =
        rawParticipant
            .split('@')[0]
            .split(':')[0];


    /* -----------------------------------------------------
       CACHE
    ----------------------------------------------------- */

    const cached =
        lidPhoneCache.get(lidNum);

    if (cached) {
        return `${cached}@s.whatsapp.net`;
    }


    /* -----------------------------------------------------
       DIRECT PN
    ----------------------------------------------------- */

    const rawPn =
        rawMsg.key?.participantPn ||
        rawMsg.key?.senderPn ||
        rawMsg.participantPn;

    if (rawPn) {

        const resolved =
            rawPn.includes('@')
                ? rawPn
                : `${rawPn}@s.whatsapp.net`;

        const phoneNum =
            resolved
                .split('@')[0]
                .split(':')[0];

        cacheLidPhone(
            lidNum,
            phoneNum
        );

        return resolved;
    }


    /* -----------------------------------------------------
       BAILEYS LID MAPPING
    ----------------------------------------------------- */

    if (
        sockInstance.signalRepository?.lidMapping?.getPNForLID
    ) {

        const variants = [
            rawParticipant,
            `${lidNum}:0@lid`,
            `${lidNum}@lid`
        ];

        for (
            const variant of variants
        ) {

            try {

                const pn =
                    await sockInstance
                        .signalRepository
                        .lidMapping
                        .getPNForLID(
                            variant
                        );

                if (
                    pn &&
                    typeof pn === 'string'
                ) {

                    const phoneNum =
                        pn
                            .split('@')[0]
                            .split(':')[0]
                            .replace(
                                /[^0-9]/g,
                                ''
                            );

                    if (
                        phoneNum.length >= 7 &&
                        phoneNum !== lidNum
                    ) {

                        cacheLidPhone(
                            lidNum,
                            phoneNum
                        );

                        return `${phoneNum}@s.whatsapp.net`;
                    }
                }

            } catch (err) {
                // Try next variant.
            }
        }
    }


    /* -----------------------------------------------------
       LEGACY FALLBACK
    ----------------------------------------------------- */

    if (
        typeof sockInstance.getJidFromLid ===
        'function'
    ) {

        try {

            const resolved =
                await sockInstance
                    .getJidFromLid(
                        rawParticipant
                    );

            if (resolved) {

                const phoneNum =
                    resolved
                        .split('@')[0]
                        .split(':')[0];

                cacheLidPhone(
                    lidNum,
                    phoneNum
                );

                return resolved;
            }

        } catch (err) {}
    }


    return rawParticipant;
}


/* =========================================================
   PREFIX
========================================================= */

function loadPrefix() {

    const configPath =
        path.join(
            __dirname,
            'config.json'
        );

    if (
        fs.existsSync(configPath)
    ) {

        try {

            const config =
                JSON.parse(
                    fs.readFileSync(
                        configPath,
                        'utf8'
                    )
                );

            if (config.prefix) {

                global.BOT_PREFIX =
                    config.prefix;

                console.log(
                    `✅ Loaded prefix: ${global.BOT_PREFIX}`
                );
            }

        } catch (err) {

            console.error(
                'Error loading config:',
                err
            );
        }
    }

    startBot();
}


/* =========================================================
   CLEAR RECONNECT TIMER
========================================================= */

function clearReconnectTimer() {

    if (reconnectTimer) {

        clearTimeout(
            reconnectTimer
        );

        reconnectTimer =
            null;
    }
}


/* =========================================================
   START BOT
========================================================= */

function startBot() {

    if (shuttingDown) {
        return;
    }

    /*
     * Prevent multiple simultaneous WhatsApp
     * connection attempts.
     */

    if (isConnecting) {

        console.log(
            'ℹ️ WhatsApp connection attempt already running.'
        );

        return;
    }

    console.log(
        box(
            'POPKID BOT',
            ['🚀 Starting WhatsApp Bot...']
        )
    );

    isConnecting =
        true;


    /* -----------------------------------------------------
       AUTH FOLDER
    ----------------------------------------------------- */

    if (
        !fs.existsSync(AUTH_FOLDER)
    ) {

        fs.mkdirSync(
            AUTH_FOLDER,
            {
                recursive: true
            }
        );
    }


    /* -----------------------------------------------------
       SESSION CHECK
    ----------------------------------------------------- */

    const credsPath =
        path.join(
            AUTH_FOLDER,
            'creds.json'
        );

    if (
        fs.existsSync(credsPath)
    ) {

        try {

            const creds =
                JSON.parse(
                    fs.readFileSync(
                        credsPath,
                        'utf8'
                    )
                );

            if (
                creds.noiseKey &&
                creds.noiseKey.private
            ) {

                console.log(
                    '📁 Using existing session...'
                );

            } else {

                console.log(
                    '⚠️ Invalid session detected, will create new one...'
                );
            }

        } catch (err) {

            console.log(
                '⚠️ Corrupted session, will create new one...'
            );
        }
    }


    /* -----------------------------------------------------
       ASYNC START
    ----------------------------------------------------- */

    (async () => {

        try {

            const {
                version,
                isLatest
            } =
                await fetchLatestWaWebVersion();

            console.log(
                `📱 Using WA v${version.join('.')}, isLatest: ${isLatest}`
            );


            const {
                state,
                saveCreds
            } =
                await useMultiFileAuthState(
                    AUTH_FOLDER
                );


            /* -------------------------------------------------
               CREATE SOCKET
            ------------------------------------------------- */

            sock =
                makeWASocket({

                    version,

                    logger:
                        pino({
                            level: 'silent'
                        }),

                    auth:
                        state,

                    printQRInTerminal:
                        true,

                    keepAliveIntervalMs:
                        10000,

                    markOnlineOnConnect:
                        true,

                    syncFullHistory:
                        false,

                    browser:
                        [
                            'Bot',
                            'Chrome',
                            '1.0.0'
                        ]
                });


            /* -------------------------------------------------
               CONNECTION UPDATE
            ------------------------------------------------- */

            sock.ev.on(
                'connection.update',
                async update => {

                    const {
                        connection,
                        lastDisconnect,
                        qr
                    } = update;


                    /* -----------------------------------------
                       QR
                    ----------------------------------------- */

                    if (qr) {

                        QRCode.toDataURL(
                            qr,
                            (err, url) => {

                                if (!err) {
                                    latestQR =
                                        url;
                                }
                            }
                        );
                    }


                    /* -----------------------------------------
                       CLOSED
                    ----------------------------------------- */

                    if (
                        connection === 'close'
                    ) {

                        botStatus =
                            'disconnected';

                        isConnecting =
                            false;


                        if (
                            presenceInterval
                        ) {

                            clearInterval(
                                presenceInterval
                            );

                            presenceInterval =
                                null;
                        }


                        const statusCode =
                            (
                                lastDisconnect?.error
                                instanceof Boom
                            )
                                ? lastDisconnect
                                    .error
                                    .output
                                    .statusCode
                                : 0;


                        const shouldReconnect =
                            statusCode !==
                            DisconnectReason.loggedOut;


                        if (
                            shouldReconnect
                        ) {

                            console.log(
                                box(
                                    'POPKID BOT',
                                    [
                                        '⚠️ Connection closed',
                                        '🔁 Reconnecting in 5s...'
                                    ]
                                )
                            );


                            clearReconnectTimer();


                            reconnectTimer =
                                setTimeout(
                                    () => {

                                        reconnectTimer =
                                            null;

                                        if (
                                            !shuttingDown
                                        ) {
                                            startBot();
                                        }

                                    },
                                    5000
                                );


                        } else {

                            console.log(
                                box(
                                    'POPKID BOT',
                                    [
                                        '🚪 Logged out',
                                        '🗑️ Clearing session...'
                                    ]
                                )
                            );


                            if (
                                fs.existsSync(
                                    AUTH_FOLDER
                                )
                            ) {

                                fs.rmSync(
                                    AUTH_FOLDER,
                                    {
                                        recursive:
                                            true,
                                        force:
                                            true
                                    }
                                );
                            }


                            clearReconnectTimer();


                            reconnectTimer =
                                setTimeout(
                                    () => {

                                        reconnectTimer =
                                            null;

                                        if (
                                            !shuttingDown
                                        ) {
                                            startBot();
                                        }

                                    },
                                    3000
                                );
                        }


                        return;
                    }


                    /* -----------------------------------------
                       OPEN
                    ----------------------------------------- */

                    if (
                        connection === 'open'
                    ) {

                        botStatus =
                            'connected';

                        isConnecting =
                            false;


                        if (
                            !global.owners
                        ) {
                            global.owners =
                                [];
                        }


                        if (
                            sock.user?.id &&
                            !global.owners.includes(
                                sock.user.id
                            )
                        ) {

                            global.owners.push(
                                sock.user.id
                            );
                        }


                        if (
                            presenceInterval
                        ) {

                            clearInterval(
                                presenceInterval
                            );
                        }


                        presenceInterval =
                            setInterval(
                                () => {

                                    if (
                                        sock?.ws?.readyState ===
                                        1
                                    ) {

                                        sock
                                            .sendPresenceUpdate(
                                                'available'
                                            )
                                            .catch(
                                                () => {}
                                            );
                                    }

                                },
                                10000
                            );


                        await new Promise(
                            resolve =>
                                setTimeout(
                                    resolve,
                                    1500
                                )
                        );


                        if (
                            !sock.user?.id
                        ) {
                            return;
                        }


                        const botNumber =
                            sock.user.id
                                .split(':')[0] +
                            '@s.whatsapp.net';


                        console.log(
                            box(
                                'POPKID BOT',
                                [
                                    '✅ Connected and ready!'
                                ]
                            )
                        );


                        /* -------------------------------------
                           NEWSLETTER
                        ------------------------------------- */

                        try {

                            await sock
                                .newsletterFollow(
                                    '120363426778975572@newsletter'
                                );

                            console.log(
                                '📡 Auto-followed Official Newsletter'
                            );

                        } catch (err) {

                            console.log(
                                'Newsletter follow verified.'
                            );
                        }


                        /* -------------------------------------
                           CONNECTION MESSAGE
                        ------------------------------------- */

                        try {

                            const feat =
                                getFeatureState();

                            await sock.sendMessage(
                                botNumber,
                                {

                                    text:
                                        waBox(
                                            'POPKID BOT CONNECTED',
                                            [

                                                `➽ ⏰ *Time* : ${new Date().toLocaleString()}`,

                                                `➽ ✅ *Status* : Online and Ready!`,

                                                `➽ 📝 *Prefix* : ${global.BOT_PREFIX}`,

                                                `➽ 👑 *Owners* : ${global.owners.length}`,

                                                `➽ ⚙️ *Mode* : ${feat.mode}`,

                                                `➽ 🔌 *Power* : ${feat.power}`,

                                                `➽ 💬 *Cmd Reactions* : ${feat.cmdReact}`,

                                                '',

                                                '➽ Make sure to join below channel'
                                            ]
                                        ),

                                    contextInfo: {

                                        forwardingScore:
                                            1,

                                        isForwarded:
                                            true,

                                        forwardedNewsletterMessageInfo:
                                            {
                                                newsletterJid:
                                                    '120363426778975572@newsletter',

                                                newsletterName:
                                                    'Popkid',

                                                serverMessageId:
                                                    -1
                                            }
                                    }
                                }
                            );

                        } catch (err) {

                            console.log(
                                '❌ Connection message error:',
                                err.message
                            );
                        }

                        return;
                    }


                    /* -----------------------------------------
                       CONNECTING
                    ----------------------------------------- */

                    if (
                        connection === 'connecting'
                    ) {

                        botStatus =
                            'connecting';

                        isConnecting =
                            true;
                    }

                }
            );


            /* -------------------------------------------------
               CREDENTIALS
            ------------------------------------------------- */

            sock.ev.on(
                'creds.update',
                async () => {

                    try {

                        await saveCreds();

                        console.log(
                            '💾 Credentials updated'
                        );

                    } catch (err) {

                        console.error(
                            '❌ Credential save error:',
                            err.message
                        );
                    }
                }
            );


            /* -------------------------------------------------
               PLUGINS
            ------------------------------------------------- */

            global.plugins =
                global.plugins instanceof Map
                    ? global.plugins
                    : new Map();

            const plugins =
                global.plugins;

            const pluginPath =
                PLUGIN_FOLDER;


            if (
                fs.existsSync(pluginPath)
            ) {

                try {

                    const pluginFiles =
                        fs
                            .readdirSync(
                                pluginPath
                            )
                            .filter(
                                file =>
                                    file.endsWith(
                                        '.js'
                                    )
                            );


                    for (
                        const file
                        of pluginFiles
                    ) {

                        try {

                            const beforeCount =
                                plugins.size;

                            const plugin =
                                require(
                                    path.join(
                                        pluginPath,
                                        file
                                    )
                                );


                            if (
                                plugins.size >
                                beforeCount
                            ) {

                                console.log(
                                    `✅ Loaded command plugin: ${file}`
                                );

                            } else if (
                                plugin &&
                                plugin.name &&
                                typeof plugin.execute ===
                                    'function'
                            ) {

                                plugins.set(
                                    plugin.name.toLowerCase(),
                                    plugin
                                );


                                if (
                                    Array.isArray(
                                        plugin.aliases
                                    )
                                ) {

                                    plugin.aliases
                                        .forEach(
                                            alias => {

                                                plugins.set(
                                                    alias.toLowerCase(),
                                                    plugin
                                                );

                                            }
                                        );
                                }


                                console.log(
                                    `✅ Loaded plugin: ${plugin.name}`
                                );

                            } else {

                                console.warn(
                                    `⚠️ Invalid plugin structure in ${file}`
                                );
                            }

                        } catch (error) {

                            console.error(
                                `❌ Failed to load plugin ${file}:`,
                                error.message
                            );
                        }
                    }


                    console.log(
                        `📦 Total plugins loaded: ${plugins.size}`
                    );

                    global.plugins =
                        plugins;

                } catch (error) {

                    console.error(
                        '❌ Error loading plugins:',
                        error
                    );
                }

            } else {

                console.log(
                    '📁 No plugins folder found'
                );
            }


            /* -------------------------------------------------
               MESSAGES
            ------------------------------------------------- */

            sock.ev.on(
                'messages.upsert',
                async ({
                    messages,
                    type
                }) => {

                    if (
                        type !== 'notify' &&
                        type !== 'append'
                    ) {
                        return;
                    }


                    const CHANNEL_ID =
                        '120363426778975572@newsletter';


                    /* -----------------------------------------
                       CHANNEL REACTIONS
                    ----------------------------------------- */

                    for (
                        const rawMsg
                        of messages
                    ) {

                        if (
                            rawMsg.key?.remoteJid ===
                                CHANNEL_ID &&
                            rawMsg.key?.server_id
                        ) {

                            const emojis = [
                                '❤️',
                                '💛',
                                '👍',
                                '💜',
                                '😮',
                                '🤍',
                                '💙',
                                '🔥',
                                '💯',
                                '⚡'
                            ];


                            const emoji =
                                emojis[
                                    Math.floor(
                                        Math.random() *
                                        emojis.length
                                    )
                                ];


                            try {

                                await sock
                                    .newsletterReactMessage(
                                        CHANNEL_ID,
                                        rawMsg.key.server_id.toString(),
                                        emoji
                                    );


                                console.log(
                                    `✅ Channel reaction: ${emoji} to message ${rawMsg.key.server_id}`
                                );

                            } catch (err) {

                                console.log(
                                    '❌ Channel React Error:',
                                    err.message
                                );
                            }


                            continue;
                        }
                    }


                    /* -----------------------------------------
                       STATUS
                    ----------------------------------------- */

                    for (
                        const rawMsg
                        of messages
                    ) {

                        if (
                            rawMsg.key?.remoteJid ===
                                'status@broadcast' &&
                            rawMsg.key?.participant
                        ) {

                            /* ---------------------------------
                               AUTO VIEW
                            --------------------------------- */

                            if (
                                global.autoView
                            ) {

                                try {

                                    console.log(
                                        `📱 Status detected from: ${rawMsg.key.participant}`
                                    );

                                    await sock.readMessages(
                                        [rawMsg.key]
                                    );

                                } catch (err) {

                                    console.log(
                                        '❌ Status viewer error:',
                                        err.message
                                    );
                                }
                            }


                            /* ---------------------------------
                               AUTO LIKE
                            --------------------------------- */

                            if (
                                global.autoLike
                            ) {

                                try {

                                    const now =
                                        Date.now();


                                    if (
                                        now -
                                        lastStatusReactTime <
                                        (
                                            global.statusReactThrottleMs ??
                                            5000
                                        )
                                    ) {

                                        // Throttled.

                                    } else {

                                        const realJid =
                                            await resolveStatusParticipant(
                                                sock,
                                                rawMsg
                                            );


                                        const resolvedKey = {

                                            remoteJid:
                                                'status@broadcast',

                                            id:
                                                rawMsg.key.id,

                                            participant:
                                                realJid
                                        };


                                        const contentType =
                                            getContentType(
                                                rawMsg.message
                                            );


                                        const reactable = [
                                            'imageMessage',
                                            'videoMessage',
                                            'extendedTextMessage',
                                            'conversation',
                                            'audioMessage'
                                        ];


                                        if (
                                            reactable.includes(
                                                contentType
                                            )
                                        ) {

                                            const emojis = [
                                                '❤️',
                                                '🩶',
                                                '🔥',
                                                '🤍',
                                                '♦️',
                                                '🎉',
                                                '💚',
                                                '💯',
                                                '✨',
                                                '😍',
                                                '🎊'
                                            ];


                                            const emoji =
                                                emojis[
                                                    Math.floor(
                                                        Math.random() *
                                                        emojis.length
                                                    )
                                                ];


                                            const botId =
                                                sock.user?.id
                                                    ? sock.user.id
                                                        .split(':')[0] +
                                                      '@s.whatsapp.net'
                                                    : sock.user?.id;


                                            await sock.sendMessage(
                                                'status@broadcast',
                                                {
                                                    react: {
                                                        text:
                                                            emoji,
                                                        key:
                                                            resolvedKey
                                                    }
                                                },
                                                {
                                                    statusJidList:
                                                        [
                                                            realJid,
                                                            botId
                                                        ].filter(
                                                            Boolean
                                                        )
                                                }
                                            );


                                            lastStatusReactTime =
                                                Date.now();


                                            await new Promise(
                                                resolve =>
                                                    setTimeout(
                                                        resolve,
                                                        global.statusReactDelayMs ??
                                                        2000
                                                    )
                                            );
                                        }
                                    }

                                } catch (err) {

                                    console.log(
                                        '❌ Status like error:',
                                        err.message
                                    );
                                }
                            }


                            continue;
                        }
                    }


                    /* -----------------------------------------
                       ANTIDELETE
                    ----------------------------------------- */

                    for (
                        const rm
                        of messages
                    ) {

                        AntideleteHandler(
                            sock,
                            rm
                        ).catch(
                            err =>
                                console.error(
                                    'Antidelete hook error:',
                                    err.message
                                )
                        );
                    }


                    /* -----------------------------------------
                       MAIN MESSAGE
                    ----------------------------------------- */

                    const rawMsg =
                        messages[0];

                    if (
                        !rawMsg?.message
                    ) {
                        return;
                    }


                    const m =
                        await serializeMessage(
                            sock,
                            rawMsg
                        );


                    /* -----------------------------------------
                       AUTO READ
                    ----------------------------------------- */

                    if (
                        global.autoRead
                    ) {

                        try {

                            await sock.readMessages(
                                [rawMsg.key]
                            );

                        } catch (err) {}
                    }


                    /* -----------------------------------------
                       PRESENCE
                    ----------------------------------------- */

                    if (
                        global.presenceMode &&
                        global.presenceMode !== 'none' &&
                        m.from
                    ) {

                        try {

                            if (
                                global.presenceMode ===
                                'typing'
                            ) {

                                await sock.sendPresenceUpdate(
                                    'composing',
                                    m.from
                                );

                            } else if (
                                global.presenceMode ===
                                'recording'
                            ) {

                                await sock.sendPresenceUpdate(
                                    'recording',
                                    m.from
                                );

                            } else if (
                                global.presenceMode ===
                                'online'
                            ) {

                                await sock.sendPresenceUpdate(
                                    'available',
                                    m.from
                                );
                            }

                        } catch (err) {}
                    }


                    /* -----------------------------------------
                       GROUP CHATBOT + ANTILINK
                    ----------------------------------------- */

                    if (
                        m.isGroup &&
                        !rawMsg.key.fromMe
                    ) {

                        handleChatbotResponse(
                            sock,
                            m.from,
                            rawMsg,
                            m.body || '',
                            m.sender
                        ).catch(
                            err =>
                                console.error(
                                    'Chatbot hook error:',
                                    err.message
                                )
                        );


                        const isExempt =
                            m.isAdmin ||
                            m.isOwner ||
                            m.isDev;


                        handleLinkDetection(
                            sock,
                            m.from,
                            rawMsg,
                            m.body || '',
                            m.sender,
                            isExempt
                        ).catch(
                            err =>
                                console.error(
                                    'Antilink hook error:',
                                    err.message
                                )
                        );
                    }


                    /* -----------------------------------------
                       PLUGIN onMessage
                    ----------------------------------------- */

                    for (
                        const plugin
                        of plugins.values()
                    ) {

                        if (
                            typeof plugin.onMessage ===
                            'function'
                        ) {

                            try {

                                const blocked =
                                    await plugin.onMessage(
                                        sock,
                                        m
                                    );

                                if (
                                    blocked === true
                                ) {
                                    return;
                                }

                            } catch (err) {

                                console.error(
                                    `❌ onMessage error (${plugin.name}):`,
                                    err
                                );
                            }
                        }
                    }


                    /* -----------------------------------------
                       COMMANDS
                    ----------------------------------------- */

                    if (
                        m.body &&
                        global.BOT_PREFIX &&
                        m.body.startsWith(
                            global.BOT_PREFIX
                        )
                    ) {

                        const args =
                            m.body
                                .slice(
                                    global.BOT_PREFIX.length
                                )
                                .trim()
                                .split(/\s+/);


                        const commandName =
                            args
                                .shift()
                                ?.toLowerCase();


                        if (!commandName) {
                            return;
                        }


                        const plugin =
                            plugins.get(
                                commandName
                            );


                        if (
                            plugin
                        ) {

                            try {

                                await plugin.execute(
                                    sock,
                                    m,
                                    args
                                );

                            } catch (err) {

                                console.error(
                                    `❌ Plugin error (${commandName}):`,
                                    err
                                );


                                try {

                                    await m.reply(
                                        '❌ Error running command.'
                                    );

                                } catch (replyErr) {}
                            }
                        }
                    }

                }
            );


            /* -------------------------------------------------
               GROUP PARTICIPANTS
            ------------------------------------------------- */

            sock.ev.on(
                'group-participants.update',
                async update => {

                    try {

                        if (
                            !global.welcomeConfig?.enabled
                        ) {
                            return;
                        }


                        const groupId =
                            update.id;


                        for (
                            const participant
                            of update.participants
                        ) {

                            const userId =
                                typeof participant ===
                                'string'
                                    ? participant
                                    : participant.phoneNumber ||
                                      participant.id;


                            if (!userId) {
                                continue;
                            }


                            const memberName =
                                userId.split('@')[0];


                            if (
                                update.action ===
                                'add'
                            ) {

                                if (
                                    sock.user?.id &&
                                    userId ===
                                    sock.user.id
                                ) {
                                    continue;
                                }


                                const text =
                                    `👋 Welcome @${memberName}!\n🎉 Glad to have you in this group!`;


                                await sock.sendMessage(
                                    groupId,
                                    {
                                        text,
                                        mentions:
                                            [userId]
                                    }
                                );


                            } else if (
                                update.action ===
                                'remove'
                            ) {

                                const text =
                                    `ya @${memberName} has left the group.\nWe are not gonna miss you!`;


                                await sock.sendMessage(
                                    groupId,
                                    {
                                        text,
                                        mentions:
                                            [userId]
                                    }
                                );
                            }
                        }

                    } catch (err) {

                        console.error(
                            '❌ group-participants.update error:',
                            err
                        );
                    }
                }
            );


            /* -------------------------------------------------
               REACTIONS
            ------------------------------------------------- */

            sock.ev.on(
                'messages.reaction',
                async reactions => {

                    console.log(
                        '💖 Reaction update:',
                        reactions
                    );
                }
            );


        } catch (error) {

            console.error(
                '❌ Bot startup error:',
                error
            );


            isConnecting =
                false;


            if (
                !shuttingDown
            ) {

                clearReconnectTimer();

                reconnectTimer =
                    setTimeout(
                        () => {

                            reconnectTimer =
                                null;

                            startBot();

                        },
                        5000
                    );
            }
        }

    })();
}


/* =========================================================
   REQUEST BODY
========================================================= */

function collectRequestBody(
    req
) {

    return new Promise(
        (resolve, reject) => {

            let body = '';

            req.on(
                'data',
                chunk => {

                    body += chunk;

                    if (
                        body.length >
                        1e6
                    ) {

                        req.destroy();

                        reject(
                            new Error(
                                'Request body too large'
                            )
                        );
                    }
                }
            );


            req.on(
                'end',
                () => resolve(body)
            );


            req.on(
                'error',
                reject
            );
        }
    );
}


/* =========================================================
   HTTP SERVER
========================================================= */

const server =
    http.createServer(
        async (req, res) => {

            try {

                const urlPath =
                    req.url;


                /* ---------------------------------------------
                   HOME / QR
                --------------------------------------------- */

                if (
                    urlPath === '/' ||
                    urlPath === '/qr'
                ) {

                    res.writeHead(
                        200,
                        {
                            'Content-Type':
                                'text/html; charset=utf-8'
                        }
                    );


                    if (latestQR) {

                        res.end(
                            `<html>
                                <body style="background:#111;color:white;text-align:center;font-family:Arial;padding:30px">
                                    <h2>POPKID BOT</h2>
                                    <img src="${latestQR}" style="max-width:100%;height:auto;" />
                                </body>
                            </html>`
                        );

                    } else {

                        res.end(
                            `<html>
                                <body style="background:#111;color:white;text-align:center;font-family:Arial;padding:30px">
                                    <h2>POPKID BOT</h2>
                                    <p>QR code is not available.</p>
                                    <p>Status: ${botStatus}</p>
                                </body>
                            </html>`
                        );
                    }


                    return;
                }


                /* ---------------------------------------------
                   STATUS
                --------------------------------------------- */

                if (
                    urlPath === '/status' &&
                    req.method === 'GET'
                ) {

                    const feat =
                        getFeatureState();


                    res.writeHead(
                        200,
                        {
                            'Content-Type':
                                'application/json'
                        }
                    );


                    res.end(
                        JSON.stringify({

                            status:
                                botStatus,

                            connecting:
                                isConnecting,

                            uptime:
                                formatUptime(
                                    Date.now() -
                                    BOOT_TIME
                                ),

                            mode:
                                feat.mode,

                            power:
                                feat.power,

                            cmdReact:
                                feat.cmdReact,

                            port:
                                PORT,

                            pid:
                                process.pid

                        })
                    );


                    return;
                }


                /* ---------------------------------------------
                   PAIR GET
                --------------------------------------------- */

                if (
                    urlPath === '/pair' &&
                    req.method === 'GET'
                ) {

                    res.writeHead(
                        200,
                        {
                            'Content-Type':
                                'text/html; charset=utf-8'
                        }
                    );


                    res.end(
                        `<html>
                            <body style="background:#111;color:white;font-family:Arial;padding:30px">
                                <h2>POPKID BOT</h2>
                                <p>Pairing endpoint is available.</p>
                                <p>Status: ${botStatus}</p>
                            </body>
                        </html>`
                    );


                    return;
                }


                /* ---------------------------------------------
                   PAIR POST
                --------------------------------------------- */

                if (
                    urlPath === '/pair' &&
                    req.method === 'POST'
                ) {

                    try {

                        const body =
                            await collectRequestBody(
                                req
                            );


                        const params =
                            new URLSearchParams(
                                body
                            );


                        const number =
                            (
                                params.get(
                                    'number'
                                ) || ''
                            ).replace(
                                /[^0-9]/g,
                                ''
                            );


                        if (!number) {

                            res.writeHead(
                                400,
                                {
                                    'Content-Type':
                                        'application/json'
                                }
                            );


                            return res.end(
                                JSON.stringify({
                                    error:
                                        'Number required'
                                })
                            );
                        }


                        if (
                            !sock
                        ) {

                            res.writeHead(
                                400,
                                {
                                    'Content-Type':
                                        'application/json'
                                }
                            );


                            return res.end(
                                JSON.stringify({
                                    error:
                                        'Bot not ready'
                                })
                            );
                        }


                        const code =
                            await sock.requestPairingCode(
                                number
                            );


                        pairingCodes.set(
                            number,
                            code
                        );


                        res.writeHead(
                            200,
                            {
                                'Content-Type':
                                    'text/html; charset=utf-8'
                            }
                        );


                        res.end(
                            'Pairing code: ' +
                            code
                        );


                    } catch (err) {

                        console.error(
                            'Pairing error:',
                            err.message
                        );


                        res.writeHead(
                            500,
                            {
                                'Content-Type':
                                    'application/json'
                            }
                        );


                        res.end(
                            JSON.stringify({
                                error:
                                    err.message
                            })
                        );
                    }


                    return;
                }


                /* ---------------------------------------------
                   NOT FOUND
                --------------------------------------------- */

                res.writeHead(
                    404,
                    {
                        'Content-Type':
                            'application/json'
                    }
                );


                res.end(
                    JSON.stringify({
                        error:
                            'Not found'
                    })
                );

            } catch (err) {

                console.error(
                    '❌ HTTP request error:',
                    err.message
                );


                if (
                    !res.headersSent
                ) {

                    res.writeHead(
                        500,
                        {
                            'Content-Type':
                                'application/json'
                        }
                    );

                    res.end(
                        JSON.stringify({
                            error:
                                'Internal server error'
                        })
                    );
                }
            }
        }
    );


/* =========================================================
   HTTP SERVER ERROR HANDLING
========================================================= */

server.on(
    'error',
    err => {

        if (
            err.code ===
            'EADDRINUSE'
        ) {

            console.error('');
            console.error(
                '╔══════════════════════════════════════╗'
            );
            console.error(
                '║          ⚠️ PORT ALREADY USED       ║'
            );
            console.error(
                '╚══════════════════════════════════════╝'
            );
            console.error('');

            console.error(
                `❌ Port ${PORT} is already in use.`
            );

            console.error(
                '⚠️ Another POPKID process may already be running.'
            );

            console.error(
                '⚠️ This process will NOT start another server.'
            );

            /*
             * Do NOT throw here.
             *
             * Throwing would kill this process and make
             * the external launcher restart it repeatedly.
             */

            serverStarted =
                false;

            return;
        }


        console.error(
            '❌ HTTP server error:',
            err
        );
    }
);


/* =========================================================
   HTTP SERVER LISTEN
========================================================= */

server.once(
    'listening',
    () => {

        serverStarted =
            true;

        console.log('');

        console.log(
            box(
                'POPKID BOT',
                [
                    `🌐 Server listening on port ${PORT}`,
                    `📡 Host: ${HOST}`,
                    `🆔 PID: ${process.pid}`
                ]
            )
        );

        console.log('');
    }
);


/*
 * IMPORTANT:
 *
 * Bind exactly once.
 */

server.listen(
    PORT,
    HOST
);


global.server =
    server;

global.PORT =
    PORT;


/* =========================================================
   SHUTDOWN
========================================================= */

async function shutdown(
    signal
) {

    if (
        shuttingDown
    ) {
        return;
    }


    shuttingDown =
        true;


    console.log('');

    console.log(
        `🛑 Received ${signal}. Shutting down...`
    );


    clearReconnectTimer();


    if (
        presenceInterval
    ) {

        clearInterval(
            presenceInterval
        );

        presenceInterval =
            null;
    }


    /* ---------------------------------------------
       Close WhatsApp socket
    --------------------------------------------- */

    try {

        if (
            sock?.ws
        ) {

            sock.ws.close();
        }

    } catch (err) {

        console.error(
            'Socket shutdown error:',
            err.message
        );
    }


    /* ---------------------------------------------
       Close HTTP server
    --------------------------------------------- */

    try {

        if (
            server &&
            server.listening
        ) {

            await new Promise(
                resolve => {

                    server.close(
                        () => resolve()
                    );
                }
            );
        }

    } catch (err) {

        console.error(
            'HTTP server shutdown error:',
            err.message
        );
    }


    console.log(
        '✅ POPKID BOT shutdown complete.'
    );


    process.exit(
        0
    );
}


/* =========================================================
   SIGNALS
========================================================= */

process.once(
    'SIGTERM',
    () => shutdown('SIGTERM')
);

process.once(
    'SIGINT',
    () => shutdown('SIGINT')
);


/* =========================================================
   PREFIX / BOT START
========================================================= */

loadPrefix();


/* =========================================================
   GLOBAL ERROR HANDLERS
========================================================= */

process.on(
    'uncaughtException',
    err => {

        console.error(
            '❌ Uncaught exception:',
            err
        );

        /*
         * Do not immediately terminate the process.
         *
         * This prevents harmless runtime/plugin errors
         * from killing the HTTP server and triggering the
         * external launcher restart cycle.
         */
    }
);


process.on(
    'unhandledRejection',
    err => {

        console.error(
            '❌ Unhandled rejection:',
            err
        );
    }
);
