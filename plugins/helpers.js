const { cmd } = require('../arslan');

// ───────────── edit your helpers here ─────────────
const HELPERS = [
    { name: 'POUNDZ', role: 'Bot Helper', phone: '+263776196948' },
    { name: 'POPKID', role: 'Bot Helper', phone: '+254111385747' }
];
// ─────────────────────────────────────────────────

const TITLE = '┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗠𝗗 𝗛𝗘𝗟𝗣𝗘𝗥𝗦* ◈';
const FOOTER = '> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗';

const waid = (phone) => String(phone).replace(/\D/g, '');

function buildCard() {
    const lines = [
        TITLE,
        '┃',
        '┃🤝 *𝗪𝗘 𝗔𝗥𝗘 𝗛𝗘𝗥𝗘 𝗧𝗢 𝗛𝗘𝗟𝗣*',
        '┃➽ Need help with the bot? Reach out!'
    ];

    HELPERS.forEach((h, i) => {
        lines.push(
            '┃',
            `┃👤 *${h.name}*`,
            `┃➽ 🏷️ ${h.role}`,
            `┃➽ 📞 ${h.phone}`,
            `┃➽ 💬 wa.me/${waid(h.phone)}`
        );
    });

    lines.push(
        '┃',
        '┃📇 *Tap the contact cards below to save them.*',
        '┃',
        '┗▣',
        FOOTER
    );
    return lines.join('\n');
}

function buildVCard(h) {
    const id = waid(h.phone);
    return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${h.name} (Popkid MD)`,
        `ORG:Popkid MD;`,
        `TITLE:${h.role}`,
        `TEL;type=CELL;type=VOICE;waid=${id}:${h.phone}`,
        'END:VCARD'
    ].join('\n');
}

cmd({
    pattern: 'helpers',
    name: 'helpers',
    category: 'Info',
    aliases: ['helper', 'support', 'contact', 'devs'],
    description: 'Contact the Popkid MD helpers',
    filename: __filename
}, async (sock, m) => {
    try {
        await m.react('🤝').catch(() => {});

        // 1) Info card
        await m.reply(buildCard());

        // 2) Tap-to-save contact cards
        await m.reply({
            contacts: {
                displayName: 'Popkid MD Helpers',
                contacts: HELPERS.map(h => ({
                    displayName: `${h.name} (Popkid MD)`,
                    vcard: buildVCard(h)
                }))
            }
        });

        await m.react('✅').catch(() => {});
    } catch (err) {
        console.error('[HELPERS] Error:', err.message);
        await m.react('❌').catch(() => {});
        await m.reply('❌ Could not load the helpers list. Please try again.');
    }
});
