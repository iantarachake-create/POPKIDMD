'use strict';

const fs = require('fs');
const path = require('path');
const { cmd } = require('../arslan');

const SETTINGS_DIR = path.join(__dirname, '../data');
const SETTINGS_PATH = path.join(SETTINGS_DIR, 'anti-call-settings.json');

const DEFAULT_SETTINGS = {
    rejectCalls: true,
    blockCaller: false,
    notifyAdmin: true,
    autoReply: "🚫 I don't accept calls. Please send a text message instead.",
    blockedUsers: []
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SETTINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function loadSettings() {
    try {
        if (!fs.existsSync(SETTINGS_DIR)) {
            fs.mkdirSync(SETTINGS_DIR, { recursive: true });
        }

        if (!fs.existsSync(SETTINGS_PATH)) {
            fs.writeFileSync(
                SETTINGS_PATH,
                JSON.stringify(DEFAULT_SETTINGS, null, 2)
            );

            return { ...DEFAULT_SETTINGS };
        }

        const data = JSON.parse(
            fs.readFileSync(SETTINGS_PATH, 'utf8')
        );

        return {
            ...DEFAULT_SETTINGS,
            ...data,
            blockedUsers: Array.isArray(data.blockedUsers)
                ? data.blockedUsers
                : []
        };

    } catch (error) {
        console.error('[POPKID ANTICALL] Failed to load settings:', error);
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings(settings) {
    try {
        if (!fs.existsSync(SETTINGS_DIR)) {
            fs.mkdirSync(SETTINGS_DIR, { recursive: true });
        }

        fs.writeFileSync(
            SETTINGS_PATH,
            JSON.stringify(settings, null, 2)
        );

        return true;
    } catch (error) {
        console.error('[POPKID ANTICALL] Failed to save settings:', error);
        return false;
    }
}

const settings = loadSettings();

/* Prevent duplicate call listeners */
const initializedSockets = new WeakSet();

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   NUMBER FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function formatJid(number) {
    const clean = String(number || '').replace(/\D/g, '');

    if (!clean) return null;

    return `${clean}@s.whatsapp.net`;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   CALL HANDLER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function initAntiCall(sock, ownerJid) {

    if (!sock || !sock.ev) {
        console.error('[POPKID ANTICALL] Invalid socket.');
        return;
    }

    /* Don't register the listener twice */
    if (initializedSockets.has(sock)) {
        return;
    }

    initializedSockets.add(sock);

    sock.ev.on('call', async (calls) => {

        if (!Array.isArray(calls)) return;

        for (const call of calls) {

            try {
                /* Only process incoming call offers */
                if (call.status !== 'offer') continue;

                const caller = call.from;

                if (!caller) continue;

                const isBlocked =
                    settings.blockedUsers.includes(caller);

                /*
                 * Reject if:
                 * 1. Anti-call is enabled
                 * 2. Caller is manually blocked
                 */
                if (settings.rejectCalls || isBlocked) {

                    try {
                        await sock.rejectCall(
                            call.id,
                            caller
                        );
                    } catch (error) {
                        console.error(
                            '[POPKID ANTICALL] Reject error:',
                            error?.message || error
                        );
                    }
                }

                /* ━━━━━━━━━━━━━━━━━━━━━━━
                   AUTO REPLY
                ━━━━━━━━━━━━━━━━━━━━━━━ */

                if (settings.autoReply) {

                    try {
                        await sock.sendMessage(caller, {
                            text: `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* ◈
┃
┃🚫 *𝗖𝗔𝗟𝗟 𝗥𝗘𝗝𝗘𝗖𝗧𝗘𝗗*
┃
┃${settings.autoReply}
┃
┗▣`
                        });
                    } catch (error) {
                        console.error(
                            '[POPKID ANTICALL] Reply error:',
                            error?.message || error
                        );
                    }
                }

                /* ━━━━━━━━━━━━━━━━━━━━━━━
                   OWNER NOTIFICATION
                ━━━━━━━━━━━━━━━━━━━━━━━ */

                if (settings.notifyAdmin && ownerJid) {

                    try {
                        await sock.sendMessage(ownerJid, {
                            text: `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* ◈
┃
┃📞 *𝗜𝗡𝗖𝗢𝗠𝗜𝗡𝗚 𝗖𝗔𝗟𝗟*
┃
┃➽ *𝗙𝗥𝗢𝗠* : ${caller}
┃➽ *𝗧𝗬𝗣𝗘* : ${call.isVideo ? '𝗩𝗜𝗗𝗘𝗢' : '𝗩𝗢𝗜𝗖𝗘'}
┃➽ *𝗦𝗧𝗔𝗧𝗨𝗦* : 𝗥𝗘𝗝𝗘𝗖𝗧𝗘𝗗
┃
┗▣`
                        });
                    } catch (error) {
                        console.error(
                            '[POPKID ANTICALL] Owner notification error:',
                            error?.message || error
                        );
                    }
                }

                /* ━━━━━━━━━━━━━━━━━━━━━━━
                   AUTO BLOCK
                ━━━━━━━━━━━━━━━━━━━━━━━ */

                if (
                    settings.blockCaller &&
                    !settings.blockedUsers.includes(caller)
                ) {

                    settings.blockedUsers.push(caller);
                    saveSettings(settings);
                }

            } catch (error) {
                console.error(
                    '[POPKID ANTICALL] Call handler error:',
                    error?.message || error
                );
            }
        }
    });

    console.log('[POPKID ANTICALL] Call handler registered.');
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ANTICALL COMMAND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

cmd({
    pattern: "anticall",
    name: "anticall",
    category: "Admin",
    aliases: ["ac"],
    description: "Manage anti-call protection",
    filename: __filename
}, async (sock, m, args) => {

    if (!global.owners.includes(m.sender)) {
        return;
    }

    /* Make sure the listener is active */
    initAntiCall(sock, m.sender);

    const action = (args[0] || '').toLowerCase();

    /* ━━━━━━━━━━━━━━━━━━━━━━━
       STATUS
    ━━━━━━━━━━━━━━━━━━━━━━━ */

    if (!action || action === 'status') {

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* ◈
┃
┃📞 *𝗣𝗥𝗢𝗧𝗘𝗖𝗧𝗜𝗢𝗡* : ${settings.rejectCalls ? '🟢 𝗢𝗡' : '🔴 𝗢𝗙𝗙'}
┃🚫 *𝗕𝗟𝗢𝗖𝗞 𝗖𝗔𝗟𝗟𝗘𝗥* : ${settings.blockCaller ? '🟢 𝗢𝗡' : '🔴 𝗢𝗙𝗙'}
┃💬 *𝗔𝗨𝗧𝗢 𝗥𝗘𝗣𝗟𝗬* : ${settings.autoReply ? '🟢 𝗢𝗡' : '🔴 𝗢𝗙𝗙'}
┃👤 *𝗕𝗟𝗢𝗖𝗞𝗘𝗗* : ${settings.blockedUsers.length}
┃
┃➽ .anticall on
┃➽ .anticall off
┃➽ .anticall block 2547XXXXXXXX
┃➽ .anticall unblock 2547XXXXXXXX
┃➽ .anticall status
┃
┗▣`);
    }


    /* ━━━━━━━━━━━━━━━━━━━━━━━
       ON
    ━━━━━━━━━━━━━━━━━━━━━━━ */

    if (action === 'on') {

        settings.rejectCalls = true;
        saveSettings(settings);

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* ◈
┃
┃🟢 *𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* : 𝗘𝗡𝗔𝗕𝗟𝗘𝗗
┃
┃📞 Incoming calls will be rejected.
┃
┗▣`);
    }


    /* ━━━━━━━━━━━━━━━━━━━━━━━
       OFF
    ━━━━━━━━━━━━━━━━━━━━━━━ */

    if (action === 'off') {

        settings.rejectCalls = false;
        saveSettings(settings);

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* ◈
┃
┃🔴 *𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* : 𝗗𝗜𝗦𝗔𝗕𝗟𝗘𝗗
┃
┃📞 Incoming calls will no longer be
┃➽ automatically rejected.
┃
┗▣`);
    }


    /* ━━━━━━━━━━━━━━━━━━━━━━━
       BLOCK
    ━━━━━━━━━━━━━━━━━━━━━━━ */

    if (action === 'block') {

        const number = args[1];

        if (!number) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* ◈
┃
┃❌ *𝗡𝗨𝗠𝗕𝗘𝗥 𝗠𝗜𝗦𝗦𝗜𝗡𝗚*
┃
┃➽ .anticall block 2547XXXXXXXX
┃
┗▣`);
        }

        const jid = formatJid(number);

        if (!jid) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* ◈
┃
┃❌ *𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗡𝗨𝗠𝗕𝗘𝗥*
┃
┗▣`);
        }

        if (settings.blockedUsers.includes(jid)) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* ◈
┃
┃⚠️ *𝗔𝗟𝗥𝗘𝗔𝗗𝗬 𝗕𝗟𝗢𝗖𝗞𝗘𝗗*
┃➽ ${number}
┃
┗▣`);
        }

        settings.blockedUsers.push(jid);
        saveSettings(settings);

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* ◈
┃
┃🔒 *𝗖𝗔𝗟𝗟𝗘𝗥 𝗕𝗟𝗢𝗖𝗞𝗘𝗗*
┃➽ ${number}
┃
┗▣`);
    }


    /* ━━━━━━━━━━━━━━━━━━━━━━━
       UNBLOCK
    ━━━━━━━━━━━━━━━━━━━━━━━ */

    if (action === 'unblock') {

        const number = args[1];

        if (!number) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* ◈
┃
┃❌ *𝗡𝗨𝗠𝗕𝗘𝗥 𝗠𝗜𝗦𝗦𝗜𝗡𝗚*
┃
┃➽ .anticall unblock 2547XXXXXXXX
┃
┗▣`);
        }

        const jid = formatJid(number);

        if (!jid) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* ◈
┃
┃❌ *𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗡𝗨𝗠𝗕𝗘𝗥*
┃
┗▣`);
        }

        settings.blockedUsers =
            settings.blockedUsers.filter(user => user !== jid);

        saveSettings(settings);

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* ◈
┃
┃🔓 *𝗖𝗔𝗟𝗟𝗘𝗥 𝗨𝗡𝗕𝗟𝗢𝗖𝗞𝗘𝗗*
┃➽ ${number}
┃
┗▣`);
    }


    /* ━━━━━━━━━━━━━━━━━━━━━━━
       INVALID COMMAND
    ━━━━━━━━━━━━━━━━━━━━━━━ */

    return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗡𝗧𝗜-𝗖𝗔𝗟𝗟* ◈
┃
┃❌ *𝗨𝗡𝗞𝗡𝗢𝗪𝗡 𝗢𝗣𝗧𝗜𝗢𝗡*
┃
┃➽ .anticall on
┃➽ .anticall off
┃➽ .anticall block 2547XXXXXXXX
┃➽ .anticall unblock 2547XXXXXXXX
┃➽ .anticall status
┃
┗▣`);
});


/* Export for your main connection/startup file */
module.exports = {
    initAntiCall
};
