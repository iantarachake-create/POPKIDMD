const fs = require('fs');
const path = require('path');
const { cmd } = require('../arslan');

const DATA_DIR = path.join(process.cwd(), 'data');
const SUDO_FILE = path.join(DATA_DIR, 'sudo.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadSudo() {
    try {
        if (!fs.existsSync(SUDO_FILE)) {
            fs.writeFileSync(SUDO_FILE, JSON.stringify([], null, 2));
            return [];
        }

        const data = JSON.parse(fs.readFileSync(SUDO_FILE, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function saveSudo(users) {
    fs.writeFileSync(SUDO_FILE, JSON.stringify(users, null, 2));
}

function cleanJid(jid) {
    if (!jid) return null;

    const number = jid
        .split('@')[0]
        .split(':')[0]
        .replace(/[^\d]/g, '');

    return number ? `${number}@s.whatsapp.net` : null;
}

// FIX: normalize both sides (strip @lid/@s.whatsapp.net suffix, strip
// :device suffix, keep only digits) before comparing. Previously this
// did a raw owners.includes(jid) exact-string match, which almost never
// matched because global.owners stores sock.user.id WITH the device
// suffix (e.g. 2547...:31@s.whatsapp.net) while m.sender is bare
// (2547...@s.whatsapp.net) — so the real owner was always denied.
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

function getTarget(m, args) {
    // Mentioned user
    if (m.mentionedJid?.length) {
        return cleanJid(m.mentionedJid[0]);
    }

    // Replied user
    const participant =
        m.message?.extendedTextMessage?.contextInfo?.participant;

    if (participant) {
        return cleanJid(participant);
    }

    // Number
    const number = args.join('').replace(/[^\d]/g, '');

    if (number.length >= 7) {
        return `${number}@s.whatsapp.net`;
    }

    return null;
}

function formatNumber(jid) {
    return jid
        .replace('@s.whatsapp.net', '')
        .replace(/^/, '+');
}

cmd({
    pattern: 'sudo',
    name: 'sudo',
    category: 'Admin',
    aliases: ['sudolist', 'sudousers'],
    description: 'Manage bot sudo users',
    filename: __filename
}, async (sock, m, args) => {

    if (!isOwner(m.sender)) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗦𝗨𝗗𝗢* ◈
┃
┃❌ *𝗔𝗖𝗖𝗘𝗦𝗦 𝗗𝗘𝗡𝗜𝗘𝗗*
┃
┃➽ Only the bot owner can
┃   manage sudo users.
┃
┗▣`);
    }

    const action = (args[0] || 'list').toLowerCase();
    let sudoUsers = loadSudo();

    // LIST
    if (action === 'list') {
        if (!sudoUsers.length) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗦𝗨𝗗𝗢* ◈
┃
┃📋 *𝗦𝗨𝗗𝗢 𝗟𝗜𝗦𝗧*
┃
┃➽ No sudo users added.
┃
┗▣`);
        }

        const list = sudoUsers
            .map((jid, i) => `┃${i + 1}. 👤 ${formatNumber(jid)}`)
            .join('\n');

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗦𝗨𝗗𝗢* ◈
┃
┃👑 *𝗦𝗨𝗗𝗢 USERS*
┃
${list}
┃
┃➽ *TOTAL* : ${sudoUsers.length}
┃
┗▣`);
    }

    // ADD
    if (['add', 'on'].includes(action)) {
        const target = getTarget(m, args.slice(1));

        if (!target) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗦𝗨𝗗𝗢* ◈
┃
┃❌ *NUMBER REQUIRED*
┃
┃➽ Mention or reply to a user
┃   or provide their number.
┃
┃📌 Example:
┃➽ .sudo add 254712345678
┃
┗▣`);
        }

        if (sudoUsers.includes(target)) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗦𝗨𝗗𝗢* ◈
┃
┃⚠️ *ALREADY SUDO*
┃
┃➽ ${formatNumber(target)}
┃   is already a sudo user.
┃
┗▣`);
        }

        sudoUsers.push(target);
        saveSudo(sudoUsers);

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗦𝗨𝗗𝗢* ◈
┃
┃✅ *SUDO ADDED*
┃
┃👤 *USER* : ${formatNumber(target)}
┃
┃➽ This user can now use
┃   sudo-level commands.
┃
┗▣`);
    }

    // REMOVE
    if (['remove', 'del', 'delete', 'off'].includes(action)) {
        const target = getTarget(m, args.slice(1));

        if (!target) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗦𝗨𝗗𝗢* ◈
┃
┃❌ *NUMBER REQUIRED*
┃
┃➽ Mention, reply or provide
┃   the user's number.
┃
┗▣`);
        }

        if (!sudoUsers.includes(target)) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗦𝗨𝗗𝗢* ◈
┃
┃⚠️ *NOT A SUDO USER*
┃
┃➽ ${formatNumber(target)}
┃   is not in the sudo list.
┃
┗▣`);
        }

        sudoUsers = sudoUsers.filter(jid => jid !== target);
        saveSudo(sudoUsers);

        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗦𝗨𝗗𝗢* ◈
┃
┃✅ *SUDO REMOVED*
┃
┃👤 *USER* : ${formatNumber(target)}
┃
┗▣`);
    }

    return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗦𝗨𝗗𝗢* ◈
┃
┃📖 *USAGE*
┃
┃➽ .sudo list
┃➽ .sudo add 254712345678
┃➽ .sudo remove 254712345678
┃
┃💡 You can also mention
┃   or reply to a user.
┃
┗▣`);
});

module.exports = {
    loadSudo,
    isSudo: (jid) => {
        return loadSudo().includes(cleanJid(jid));
    }
};
