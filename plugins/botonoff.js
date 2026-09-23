const fs = require('fs');
const path = require('path');
const { cmd } = require('../arslan');

const DATA_DIR = path.join(process.cwd(), 'data');
const STATUS_FILE = path.join(DATA_DIR, 'bot-status.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadStatus() {
    try {
        if (!fs.existsSync(STATUS_FILE)) {
            fs.writeFileSync(
                STATUS_FILE,
                JSON.stringify({ status: 'on' }, null, 2)
            );
            return 'on';
        }

        const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
        return data.status === 'off' ? 'off' : 'on';
    } catch (err) {
        return 'on';
    }
}

function saveStatus(status) {
    fs.writeFileSync(
        STATUS_FILE,
        JSON.stringify({ status }, null, 2)
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

// Same @lid resolution fallback used in mode.js — a sender JID can come
// through as an internal @lid instead of the real phone number, which
// would otherwise lock the real owner out.
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

let currentStatus = loadStatus();

global.botStatus2 = currentStatus; // note: index.js already uses global botStatus for connection state, so this uses a distinct name

/*
|--------------------------------------------------------------------------
| BOT ON/OFF PROTECTION
|--------------------------------------------------------------------------
| Wraps plugins.get() the same way mode.js does, so index.js needs no
| changes. When the bot is "off":
|   - the owner can still run every command, including .on
|   - everyone else is silently ignored (no reply at all)
| This stacks fine alongside mode.js's own wrapping — both are
| independent gates and whichever fires first blocks the call.
|--------------------------------------------------------------------------
*/

function installStatusProtection() {
    if (!global.plugins) return;

    const plugins = global.plugins;

    if (plugins.__popkidStatusProtection) return;

    const originalGet = plugins.get.bind(plugins);

    plugins.get = function (commandName) {
        const plugin = originalGet(commandName);

        if (!plugin) return plugin;

        // Never block the on/off command itself
        if (
            plugin.__popkidStatusWrapped ||
            commandName === 'on' ||
            commandName === 'off'
        ) {
            return plugin;
        }

        const originalExecute = plugin.execute;

        if (typeof originalExecute !== 'function') {
            return plugin;
        }

        const wrappedPlugin = Object.create(plugin);

        wrappedPlugin.execute = async function (sock, m, args) {

            if (currentStatus === 'off') {
                const owner = await isOwner(sock, m.sender);
                if (!owner) {
                    // Silent — no reply, bot is "asleep" to everyone but the owner
                    return;
                }
            }

            return originalExecute.call(
                this,
                sock,
                m,
                args
            );
        };

        wrappedPlugin.__popkidStatusWrapped = true;

        return wrappedPlugin;
    };

    plugins.__popkidStatusProtection = true;
}

cmd({
    pattern: 'on',
    name: 'on',
    category: 'Admin',
    aliases: ['bot-on', 'botup'],
    description: 'Turn the bot on (resume responding to everyone)',
    filename: __filename
}, async (sock, m, args) => {

    if (!(await isOwner(sock, m.sender))) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗢𝗪𝗘𝗥* ◈
┃
┃❌ *𝗔𝗖𝗖𝗘𝗦𝗦 𝗗𝗘𝗡𝗜𝗘𝗗*
┃
┃➽ Only the bot owner
┃   can power the bot on.
┃
┗▣`);
    }

    if (currentStatus === 'on') {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗢𝗪𝗘𝗥* ◈
┃
┃⚠️ *ALREADY ON*
┃
┃➽ The bot is already
┃   powered on.
┃
┗▣`);
    }

    currentStatus = 'on';
    global.botStatus2 = 'on';
    saveStatus('on');

    return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗢𝗪𝗘𝗥* ◈
┃
┃🟢 *𝗕𝗢𝗧 𝗜𝗦 𝗡𝗢𝗪 𝗢𝗡*
┃
┃➽ Responding to
┃   everyone again.
┃
┗▣`);
});

cmd({
    pattern: 'off',
    name: 'off',
    category: 'Admin',
    aliases: ['bot-off', 'botdown'],
    description: 'Turn the bot off (only the owner can still use it)',
    filename: __filename
}, async (sock, m, args) => {

    if (!(await isOwner(sock, m.sender))) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗢𝗪𝗘𝗥* ◈
┃
┃❌ *𝗔𝗖𝗖𝗘𝗦𝗦 𝗗𝗘𝗡𝗜𝗘𝗗*
┃
┃➽ Only the bot owner
┃   can power the bot off.
┃
┗▣`);
    }

    if (currentStatus === 'off') {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗢𝗪𝗘𝗥* ◈
┃
┃⚠️ *ALREADY OFF*
┃
┃➽ The bot is already
┃   powered off.
┃
┗▣`);
    }

    currentStatus = 'off';
    global.botStatus2 = 'off';
    saveStatus('off');

    return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗢𝗪𝗘𝗥* ◈
┃
┃🔴 *𝗕𝗢𝗧 𝗜𝗦 𝗡𝗢𝗪 𝗢𝗙𝗙*
┃
┃➽ Only you (the owner)
┃   can still use commands.
┃
┃💤 Send .on to resume.
┃
┗▣`);
});

// Install protection after both commands have registered.
installStatusProtection();

module.exports = {
    getStatus: () => currentStatus,

    setStatus: (status) => {
        if (status !== 'on' && status !== 'off') {
            return false;
        }

        currentStatus = status;
        global.botStatus2 = status;
        saveStatus(status);

        return true;
    }
};
