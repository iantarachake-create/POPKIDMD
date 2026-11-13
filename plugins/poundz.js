const { cmd } = require('../arslan');

// ───────────── edit here ─────────────
const NAME = 'POUNDZ';
const ROLE = 'Bot Helper';
const PHONE = '+263776196948';
// ────────────────────────────────────

const TITLE = '┏▣ ◈ *𝗣𝗢𝗨𝗡𝗗𝗭* ◈';
const FOOTER = '> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗';
const waid = PHONE.replace(/\D/g, '');

const card = [
    TITLE,
    '┃',
    `┃👤 *${NAME}*`,
    `┃➽ 🏷️ ${ROLE}`,
    `┃➽ 📞 ${PHONE}`,
    `┃➽ 💬 wa.me/${waid}`,
    '┃',
    '┃📇 *Tap the contact card below to save him.*',
    '┃',
    '┗▣',
    FOOTER
].join('\n');

const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${NAME} (Popkid MD)`,
    'ORG:Popkid MD;',
    `TITLE:${ROLE}`,
    `TEL;type=CELL;type=VOICE;waid=${waid}:${PHONE}`,
    'END:VCARD'
].join('\n');

cmd({
    pattern: 'poundz',
    name: 'poundz',
    category: 'Info',
    aliases: ['pounds'],
    description: "Get Poundz's phone number",
    filename: __filename
}, async (sock, m) => {
    try {
        await m.react('📞').catch(() => {});
        await m.reply(card);
        await m.reply({
            contacts: {
                displayName: `${NAME} (Popkid MD)`,
                contacts: [{ displayName: `${NAME} (Popkid MD)`, vcard }]
            }
        });
        await m.react('✅').catch(() => {});
    } catch (err) {
        console.error('[POUNDZ] Error:', err.message);
        await m.react('❌').catch(() => {});
        await m.reply(`📞 ${NAME}: ${PHONE}`).catch(() => {});
    }
});
