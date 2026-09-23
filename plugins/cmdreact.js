const fs = require('fs');
const path = require('path');
const { cmd } = require('../arslan');

const DATA_DIR = path.join(process.cwd(), 'data');
const REACT_FILE = path.join(DATA_DIR, 'cmdreact.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadReactState() {
    try {
        if (!fs.existsSync(REACT_FILE)) {
            fs.writeFileSync(
                REACT_FILE,
                JSON.stringify({ enabled: false }, null, 2)
            );
            return false;
        }

        const data = JSON.parse(fs.readFileSync(REACT_FILE, 'utf8'));
        return data.enabled === true;
    } catch (err) {
        return false;
    }
}

function saveReactState(enabled) {
    fs.writeFileSync(
        REACT_FILE,
        JSON.stringify({ enabled }, null, 2)
    );
}

function normalizeJid(jid) {
    if (!jid) return '';

    return jid
        .split('@')[0]
        .split(':')[0]
        .replace(/[^\d]/g, '');
}

function isOwner(jid) {
    const sender = normalizeJid(jid);

    return Array.isArray(global.owners) &&
        global.owners.some(owner =>
            normalizeJid(owner) === sender
        );
}

let reactEnabled = loadReactState();

global.cmdReactEnabled = reactEnabled;

// Emojis used for the "received" / "success" / "error" states. Change
// these freely — they're just plain strings.
const REACT_PROCESSING = '⏳';
const REACT_SUCCESS = '✅';
const REACT_ERROR = '❌';

async function sendReaction(sock, m, emoji) {
    if (!m?.key) return; // no message key to react to — skip silently

    try {
        await sock.sendMessage(m.from, {
            react: { text: emoji, key: m.key }
        });
    } catch (err) {
        // reacting can fail on some chat types (e.g. status, some group
        // configs) — never let that break the actual command
    }
}

/*
|--------------------------------------------------------------------------
| COMMAND REACTION HOOK
|--------------------------------------------------------------------------
| Wraps plugins.get() the same way mode.js and bot-status.js do, so
| index.js needs no changes. When enabled, every command gets a ⏳
| reaction the moment it's picked up, then that reaction is replaced
| with ✅ on success or ❌ if the command throws.
|
| Load-order note: this file's own gate sits wherever it lands relative
| to mode.js / bot-status.js in the plugins folder's alphabetical order.
| If the bot is in private mode or powered off and a non-owner is
| blocked by one of those BEFORE reaching this wrapper, no reaction is
| sent for them either — which is the correct behavior. The one edge
| case worth knowing: if this file's gate ends up wrapped *inside*
| bot-status.js's off-check (i.e. loads before it alphabetically), a
| non-owner could still get a ⏳ reaction with no reply while the bot is
| off. Renaming this file to sort after "bot-status.js" and "mode.js"
| avoids that.
|--------------------------------------------------------------------------
*/

function installReactHook() {
    if (!global.plugins) return;

    const plugins = global.plugins;

    if (plugins.__popkidReactHook) return;

    const originalGet = plugins.get.bind(plugins);

    plugins.get = function (commandName) {
        const plugin = originalGet(commandName);

        if (!plugin) return plugin;

        if (
            plugin.__popkidReactWrapped ||
            commandName === 'cmdreact'
        ) {
            return plugin;
        }

        const originalExecute = plugin.execute;

        if (typeof originalExecute !== 'function') {
            return plugin;
        }

        const wrappedPlugin = Object.create(plugin);

        wrappedPlugin.execute = async function (sock, m, args) {

            if (!reactEnabled) {
                return originalExecute.call(this, sock, m, args);
            }

            await sendReaction(sock, m, REACT_PROCESSING);

            try {
                const result = await originalExecute.call(this, sock, m, args);
                await sendReaction(sock, m, REACT_SUCCESS);
                return result;
            } catch (err) {
                await sendReaction(sock, m, REACT_ERROR);
                throw err;
            }
        };

        wrappedPlugin.__popkidReactWrapped = true;

        return wrappedPlugin;
    };

    plugins.__popkidReactHook = true;
}

cmd({
    pattern: 'cmdreact',
    name: 'cmdreact',
    category: 'Admin',
    aliases: ['creact', 'commandreact'],
    description: 'Toggle command reactions (⏳ / ✅ / ❌ on every command)',
    filename: __filename
}, async (sock, m, args) => {

    if (!isOwner(m.sender)) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗖𝗠𝗗𝗥𝗘𝗔𝗖𝗧* ◈
┃
┃❌ *𝗔𝗖𝗖𝗘𝗦𝗦 𝗗𝗘𝗡𝗜𝗘𝗗*
┃
┃➽ Only the bot owner can
┃   toggle command reactions.
┃
┗▣`);
    }

    const action = (args[0] || '').toLowerCase();

    if (!['on', 'off'].includes(action)) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗖𝗠𝗗𝗥𝗘𝗔𝗖𝗧* ◈
┃
┃📖 *USAGE*
┃➽ .cmdreact on
┃➽ .cmdreact off
┃
┃⚙️ *CURRENT* : ${reactEnabled ? '✅ ON' : '❌ OFF'}
┃💾 *STORAGE* : File System
┃
┗▣`);
    }

    if (action === 'on') {
        reactEnabled = true;
        global.cmdReactEnabled = true;
        saveReactState(true);

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗖𝗠𝗗𝗥𝗘𝗔𝗖𝗧* ◈
┃
┃✅ *𝗖𝗢𝗠𝗠𝗔𝗡𝗗 𝗥𝗘𝗔𝗖𝗧𝗜𝗢𝗡𝗦 𝗘𝗡𝗔𝗕𝗟𝗘𝗗*
┃
┃💾 *STORAGE* : File System
┃
┗▣`);
    }

    reactEnabled = false;
    global.cmdReactEnabled = false;
    saveReactState(false);

    return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗖𝗠𝗗𝗥𝗘𝗔𝗖𝗧* ◈
┃
┃❌ *𝗖𝗢𝗠𝗠𝗔𝗡𝗗 𝗥𝗘𝗔𝗖𝗧𝗜𝗢𝗡𝗦 𝗗𝗜𝗦𝗔𝗕𝗟𝗘𝗗*
┃
┃💾 *STORAGE* : File System
┃
┗▣`);
});

// Install after the command has registered.
installReactHook();

module.exports = {
    isEnabled: () => reactEnabled,

    setEnabled: (enabled) => {
        reactEnabled = !!enabled;
        global.cmdReactEnabled = reactEnabled;
        saveReactState(reactEnabled);
        return true;
    }
};
