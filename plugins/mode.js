const fs = require('fs');
const path = require('path');
const { cmd } = require('../arslan');

const DATA_DIR = path.join(process.cwd(), 'data');
const MODE_FILE = path.join(DATA_DIR, 'bot-mode.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadMode() {
    try {
        if (!fs.existsSync(MODE_FILE)) {
            fs.writeFileSync(
                MODE_FILE,
                JSON.stringify({ mode: 'public' }, null, 2)
            );
            return 'public';
        }

        const data = JSON.parse(
            fs.readFileSync(MODE_FILE, 'utf8')
        );

        return data.mode === 'private' ? 'private' : 'public';
    } catch (err) {
        return 'public';
    }
}

function saveMode(mode) {
    fs.writeFileSync(
        MODE_FILE,
        JSON.stringify({ mode }, null, 2)
    );
}

function normalizeJid(jid) {
    if (!jid) return '';

    return jid
        .split('@')[0]
        .split(':')[0]
        .replace(/[^\d]/g, '');
}

function isOwnerSync(jid) {
    const sender = normalizeJid(jid);

    return Array.isArray(global.owners) &&
        global.owners.some(owner =>
            normalizeJid(owner) === sender
        );
}

// FIX: WhatsApp sometimes reports m.sender as an @lid (linked-device id)
// instead of the real @s.whatsapp.net phone number. normalizeJid alone
// can't fix that — an @lid's digits are NOT the phone number, so a plain
// digit-strip comparison against global.owners will never match, and the
// real owner gets locked out under private mode. When the sync check
// fails and the JID looks like an @lid, try to resolve it via Baileys'
// own lid-mapping store (same approach already used in index.js for
// status reactions) before giving up.
async function isOwner(sock, jid) {
    if (isOwnerSync(jid)) return true;

    if (!jid || !jid.endsWith('@lid') || !sock?.signalRepository?.lidMapping?.getPNForLID) {
        return false;
    }

    try {
        const pn = await sock.signalRepository.lidMapping.getPNForLID(jid);
        if (pn && typeof pn === 'string') {
            return isOwnerSync(pn);
        }
    } catch (err) {
        // fall through
    }

    return false;
}

let currentMode = loadMode();

global.botMode = currentMode;

/*
|--------------------------------------------------------------------------
| PRIVATE MODE PROTECTION
|--------------------------------------------------------------------------
| Your index.js does:
|
| const plugin = plugins.get(commandName)
| await plugin.execute(...)
|
| We intercept .get() here, so index.js does not need to be modified.
|--------------------------------------------------------------------------
*/

function installModeProtection() {
    if (!global.plugins) return;

    const plugins = global.plugins;

    if (plugins.__popkidModeProtection) return;

    const originalGet = plugins.get.bind(plugins);

    plugins.get = function (commandName) {
        const plugin = originalGet(commandName);

        if (!plugin) return plugin;

        // Don't wrap the mode command itself
        if (
            plugin.__popkidModeWrapped ||
            commandName === 'mode'
        ) {
            return plugin;
        }

        const originalExecute = plugin.execute;

        if (typeof originalExecute !== 'function') {
            return plugin;
        }

        const wrappedPlugin = Object.create(plugin);

        wrappedPlugin.execute = async function (sock, m, args) {

            if (currentMode === 'private') {
                const owner = await isOwner(sock, m.sender);
                if (!owner) {
                    return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗥𝗜𝗩𝗔𝗧𝗘* ◈
┃
┃🔒 *𝗕𝗢𝗧 𝗜𝗦 𝗣𝗥𝗜𝗩𝗔𝗧𝗘*
┃
┃➽ You are not authorized
┃   to use this bot.
┃
┃👑 *OWNER ONLY*
┃
┗▣`);
                }
            }

            return originalExecute.call(
                this,
                sock,
                m,
                args
            );
        };

        wrappedPlugin.__popkidModeWrapped = true;

        return wrappedPlugin;
    };

    plugins.__popkidModeProtection = true;
}

cmd({
    pattern: 'mode',
    name: 'mode',
    category: 'Admin',
    aliases: ['botmode'],
    description: 'Switch bot between public and private mode',
    filename: __filename
}, async (sock, m, args) => {

    if (!(await isOwner(sock, m.sender))) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗢𝗗𝗘* ◈
┃
┃❌ *𝗔𝗖𝗖𝗘𝗦𝗦 𝗗𝗘𝗡𝗜𝗘𝗗*
┃
┃➽ Only the bot owner
┃   can change bot mode.
┃
┗▣`);
    }

    const action = (args[0] || 'status').toLowerCase();

    // PUBLIC
    if (action === 'public' || action === 'on') {

        currentMode = 'public';
        global.botMode = 'public';
        saveMode('public');

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗢𝗗𝗘* ◈
┃
┃🌐 *PUBLIC MODE*
┃
┃➽ Everyone can use
┃   the bot commands.
┃
┃🟢 *STATUS* : PUBLIC
┃
┗▣`);
    }

    // PRIVATE
    if (action === 'private' || action === 'off') {

        currentMode = 'private';
        global.botMode = 'private';
        saveMode('private');

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗢𝗗𝗘* ◈
┃
┃🔒 *PRIVATE MODE*
┃
┃➽ Only the bot owner
┃   can use commands.
┃
┃🔴 *STATUS* : PRIVATE
┃
┗▣`);
    }

    // STATUS
    if (
        action === 'status' ||
        action === 'check'
    ) {

        const status =
            currentMode === 'private'
                ? '🔒 PRIVATE'
                : '🌐 PUBLIC';

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗢𝗗𝗘* ◈
┃
┃⚙️ *BOT MODE*
┃
┃➽ *STATUS* : ${status}
┃
┃📌 *COMMANDS*
┃➽ .mode public
┃➽ .mode private
┃➽ .mode status
┃
┗▣`);
    }

    return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗢𝗗𝗘* ◈
┃
┃📖 *USAGE*
┃
┃➽ .mode public
┃➽ .mode private
┃➽ .mode status
┃
┗▣`);
});

// Install protection after the command has registered.
installModeProtection();

module.exports = {
    getMode: () => currentMode,

    setMode: (mode) => {
        if (mode !== 'public' && mode !== 'private') {
            return false;
        }

        currentMode = mode;
        global.botMode = mode;
        saveMode(mode);

        return true;
    }
};
