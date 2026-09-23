'use strict';

const { cmd } = require('../arslan');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   LOGO STYLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const LOGO_STYLES = {
    advancedglow:   { style: 'neon',       color: '#00ff88', bg: '#000000' },
    americanflag:   { style: 'flag',       color: '#B22234', bg: '#3C3B6E' },
    blackpinklogo:  { style: 'blackpink',  color: '#FF1493', bg: '#000000' },
    blackpinkstyle: { style: 'blackpink2', color: '#FF69B4', bg: '#111111' },
    cartoonstyle:   { style: 'cartoon',    color: '#FFD700', bg: '#FF4500' },
    deletingtext:   { style: 'delete',     color: '#FF0000', bg: '#000000' },
    effectclouds:   { style: 'clouds',     color: '#87CEEB', bg: '#FFFFFF' },
    galaxy:         { style: 'galaxy',     color: '#9B59B6', bg: '#000011' },
    galaxystyle:    { style: 'galaxy2',    color: '#E8D5FF', bg: '#000022' },
    glitchtext:     { style: 'glitch',     color: '#FF0000', bg: '#000000' },
    glossysilver:   { style: 'glossy',     color: '#C0C0C0', bg: '#222222' },
    glowingtext:    { style: 'glow',       color: '#FFFF00', bg: '#000000' },
    gradienttext:   { style: 'gradient',   color: '#FF0080', bg: '#FFFFFF' },
    lighteffect:    { style: 'light',      color: '#FFFFFF', bg: '#003366' },
    logo1917:       { style: 'retro',      color: '#C0A000', bg: '#1A1A1A' },
    luxurygold:     { style: 'gold',       color: '#FFD700', bg: '#1A0A00' },
    makingneon:     { style: 'neon2',      color: '#00FFFF', bg: '#000000' },
    neonglitch:     { style: 'neonglitch', color: '#FF00FF', bg: '#000000' },
    nigerianflag:   { style: 'flag2',      color: '#008751', bg: '#FFFFFF' },
    papercut:       { style: 'paper',      color: '#333333', bg: '#F5F5DC' },
    pixelglitch:    { style: 'pixel',      color: '#00FF00', bg: '#000000' },
    sandsummer:     { style: 'sand',       color: '#DEB887', bg: '#87CEEB' },
    summerbeach:    { style: 'beach',      color: '#FF6B35', bg: '#00CED1' },
    texteffect:     { style: 'effect',     color: '#FF4500', bg: '#FFFFFF' },
    typographytext: { style: 'typography', color: '#2C3E50', bg: '#ECF0F1' },
    underwater:     { style: 'underwater', color: '#00BFFF', bg: '#006994' },
    writetext:      { style: 'handwriting',color: '#1A1A1A', bg: '#FFFFF0' },
    logomaker:      { style: 'logo',       color: '#FF6600', bg: '#FFFFFF' }
};


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   UNICODE MAPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const UNICODE_MAPS = {

    bold: c => {
        const code = c.charCodeAt(0);

        if (code >= 65 && code <= 90)
            return String.fromCodePoint(code + 0x1D3BF);

        if (code >= 97 && code <= 122)
            return String.fromCodePoint(code + 0x1D3B9);

        return c;
    },

    italic: c => {
        const code = c.charCodeAt(0);

        if (code >= 65 && code <= 90)
            return String.fromCodePoint(code + 0x1D3F3);

        if (code >= 97 && code <= 122)
            return String.fromCodePoint(code + 0x1D3ED);

        return c;
    },

    bolditalic: c => {
        const code = c.charCodeAt(0);

        if (code >= 65 && code <= 90)
            return String.fromCodePoint(code + 0x1D427);

        if (code >= 97 && code <= 122)
            return String.fromCodePoint(code + 0x1D421);

        return c;
    },

    mono: c => {
        const code = c.charCodeAt(0);

        if (code >= 65 && code <= 90)
            return String.fromCodePoint(code + 0x1D62F);

        if (code >= 97 && code <= 122)
            return String.fromCodePoint(code + 0x1D629);

        return c;
    },

    script: c => {
        const map = {
            a:'𝒶', b:'𝒷', c:'𝒸', d:'𝒹', e:'𝑒',
            f:'𝒻', g:'𝑔', h:'𝒽', i:'𝒾', j:'𝒿',
            k:'𝓀', l:'𝓁', m:'𝓂', n:'𝓃', o:'𝑜',
            p:'𝓅', q:'𝓆', r:'𝓇', s:'𝓈', t:'𝓉',
            u:'𝓊', v:'𝓋', w:'𝓌', x:'𝓍', y:'𝓎',
            z:'𝓏',

            A:'𝒜', B:'ℬ', C:'𝒞', D:'𝒟', E:'ℰ',
            F:'ℱ', G:'𝒢', H:'ℋ', I:'ℐ', J:'𝒥',
            K:'𝒦', L:'ℒ', M:'ℳ', N:'𝒩', O:'𝒪',
            P:'𝒫', Q:'𝒬', R:'ℛ', S:'𝒮', T:'𝒯',
            U:'𝒰', V:'𝒱', W:'𝒲', X:'𝒳', Y:'𝒴',
            Z:'𝒵'
        };

        return map[c] || c;
    },

    bubble: c => {
        const map = {
            a:'ⓐ', b:'ⓑ', c:'ⓒ', d:'ⓓ', e:'ⓔ',
            f:'ⓕ', g:'ⓖ', h:'ⓗ', i:'ⓘ', j:'ⓙ',
            k:'ⓚ', l:'ⓛ', m:'ⓜ', n:'ⓝ', o:'ⓞ',
            p:'ⓟ', q:'ⓠ', r:'ⓡ', s:'ⓢ', t:'ⓣ',
            u:'ⓤ', v:'ⓥ', w:'ⓦ', x:'ⓧ', y:'ⓨ',
            z:'ⓩ',

            A:'Ⓐ', B:'Ⓑ', C:'Ⓒ', D:'Ⓓ', E:'Ⓔ',
            F:'Ⓕ', G:'Ⓖ', H:'Ⓗ', I:'Ⓘ', J:'Ⓙ',
            K:'Ⓚ', L:'Ⓛ', M:'Ⓜ', N:'Ⓝ', O:'Ⓞ',
            P:'Ⓟ', Q:'Ⓠ', R:'Ⓡ', S:'Ⓢ', T:'Ⓣ',
            U:'Ⓤ', V:'Ⓥ', W:'Ⓦ', X:'Ⓧ', Y:'Ⓨ',
            Z:'Ⓩ'
        };

        return map[c] || c;
    },

    square: c => {
        const map = {
            a:'🄰', b:'🄱', c:'🄲', d:'🄳', e:'🄴',
            f:'🄵', g:'🄶', h:'🄷', i:'🄸', j:'🄹',
            k:'🄺', l:'🄻', m:'🄼', n:'🄽', o:'🄾',
            p:'🄿', q:'🅀', r:'🅁', s:'🅂', t:'🅃',
            u:'🅄', v:'🅅', w:'🅆', x:'🅇', y:'🅈',
            z:'🅉',

            A:'🄰', B:'🄱', C:'🄲', D:'🄳', E:'🄴',
            F:'🄵', G:'🄶', H:'🄷', I:'🄸', J:'🄹',
            K:'🄺', L:'🄻', M:'🄼', N:'🄽', O:'🄾',
            P:'🄿', Q:'🅀', R:'🅁', S:'🅂', T:'🅃',
            U:'🅄', V:'🅅', W:'🅆', X:'🅇', Y:'🅈',
            Z:'🅉'
        };

        return map[c] || c;
    },

    vaporwave: c => {
        const code = c.charCodeAt(0);

        if (code >= 33 && code <= 126)
            return String.fromCodePoint(code + 0xFEE0);

        return c;
    }
};


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   STYLE → UNICODE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const STYLE_UNICODE = {
    neon: 'bold',
    flag: 'bold',
    blackpink: 'script',
    blackpink2: 'italic',
    cartoon: 'bubble',
    delete: 'bold',
    clouds: 'italic',
    galaxy: 'bolditalic',
    galaxy2: 'italic',
    glitch: 'vaporwave',
    glossy: 'mono',
    glow: 'bold',
    gradient: 'script',
    light: 'bolditalic',
    retro: 'mono',
    gold: 'bold',
    neon2: 'italic',
    neonglitch: 'vaporwave',
    flag2: 'bubble',
    paper: 'script',
    pixel: 'mono',
    sand: 'italic',
    beach: 'bubble',
    effect: 'bold',
    typography: 'bolditalic',
    underwater: 'italic',
    handwriting: 'script',
    logo: 'bold'
};


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DECORATORS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const DECORATORS = {
    neon: '⚡',
    blackpink: '🌸',
    galaxy: '🌌',
    glitch: '⚠️',
    gold: '✨',
    glow: '💡',
    gradient: '🌈',
    logo: '🎯',
    underwater: '🌊',
    beach: '🏖️',
    flag: '🇺🇸',
    flag2: '🇳🇬',
    cartoon: '🎨',
    default: '🎨'
};


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   HELPERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function transform(text, mapName) {
    const fn = UNICODE_MAPS[mapName] || UNICODE_MAPS.bold;

    return [...text]
        .map(fn)
        .join('');
}

function makeResponse(command, text) {

    const styleInfo = LOGO_STYLES[command] || {
        style: 'logo',
        color: '#FF6600',
        bg: '#FFFFFF'
    };

    const mapName =
        STYLE_UNICODE[styleInfo.style] || 'bold';

    const styled = transform(text, mapName);

    const icon =
        DECORATORS[styleInfo.style] || DECORATORS.default;

    return `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 ${command.toUpperCase()}* ◈
┃
┃${icon} *𝗦𝗧𝗬𝗟𝗘* : ${command.toUpperCase()}
┃
┃✨ *${styled}*
┃
┃➽ *𝗧𝗘𝗫𝗧* : ${text}
┃➽ *𝗖𝗢𝗟𝗢𝗥* : ${styleInfo.color}
┃➽ *𝗕𝗔𝗖𝗞𝗚𝗥𝗢𝗨𝗡𝗗* : ${styleInfo.bg}
┃
┗▣`;
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   LOGO STYLE COMMANDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

for (const command of Object.keys(LOGO_STYLES)) {

    const styleInfo = LOGO_STYLES[command];

    cmd({
        pattern: command,
        name: command,
        category: 'Fun',
        description: `Create ${command} text style`,
        filename: __filename
    }, async (sock, m, args) => {

        const text = args.join(' ').trim();

        if (!text) {
            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 ${command.toUpperCase()}* ◈
┃
┃❌ *𝗧𝗘𝗫𝗧 𝗠𝗜𝗦𝗦𝗜𝗡𝗚*
┃
┃➽ 𝗨𝗦𝗔𝗚𝗘 :
┃➽ .${command} <your text>
┃
┃📌 *𝗘𝗫𝗔𝗠𝗣𝗟𝗘* :
┃➽ .${command} POPKID
┃
┃🎨 Use *.logolist* to see all styles.
┃
┗▣`);
        }

        try {
            return await m.reply(
                makeResponse(command, text)
            );
        } catch (error) {

            console.error(
                `[POPKID ${command}]`,
                error
            );

            return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 ${command.toUpperCase()}* ◈
┃
┃❌ *𝗙𝗔𝗜𝗟𝗘𝗗*
┃➽ Unable to generate the text style.
┃
┗▣`);
        }
    });
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   LOGO LIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

cmd({
    pattern: "logolist",
    name: "logolist",
    category: "Fun",
    aliases: ["logostyles", "styles"],
    description: "Show all available logo styles",
    filename: __filename
}, async (sock, m) => {

    const styles = Object.keys(LOGO_STYLES).sort();

    const half = Math.ceil(styles.length / 2);

    const first = styles
        .slice(0, half)
        .map(style => `┃➽ .${style}`)
        .join('\n');

    const second = styles
        .slice(half)
        .map(style => `┃➽ .${style}`)
        .join('\n');

    return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗟𝗢𝗚𝗢 𝗦𝗧𝗬𝗟𝗘𝗦* ◈
┃
┃🎨 *𝗔𝗩𝗔𝗜𝗟𝗔𝗕𝗟𝗘 𝗦𝗧𝗬𝗟𝗘𝗦* : ${styles.length}
┃
${first}
┃
${second}
┃
┃📌 *𝗨𝗦𝗔𝗚𝗘*
┃➽ .logomaker POPKID
┃
┗▣`);
});
