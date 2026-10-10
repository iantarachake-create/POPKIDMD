const axios = require('axios');
const { cmd } = require('../arslan');

// ───────────── settings ─────────────
const BASE_URL = 'https://popkid3-2026.onrender.com';
const REQUEST_TIMEOUT = 90000;     // Render free servers can take ~50s to wake up
const WAKE_NOTICE_MS = 10000;      // tell the user if the server is slow
const COOLDOWN_MS = 30000;         // per-user wait between requests
const RETRIES = 1;

// Ways the pair server might expose its code. They are tried in order and the
// first one that works is remembered. If you know the exact one, keep only it.
const ENDPOINTS = [
    { method: 'get',  path: '/code', query: (n) => ({ number: n }) },
    { method: 'get',  path: '/pair', query: (n) => ({ number: n }) },
    { method: 'post', path: '/pair', form:  (n) => ({ number: n }) },
    { method: 'get',  path: '/api/pair', query: (n) => ({ number: n }) }
];
// ───────────────────────────────────────

const TITLE = '┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗔𝗜𝗥* ◈';
const FOOTER = '> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗣𝗢𝗣𝗞𝗜𝗗';
const box = (...lines) =>
    `${TITLE}\n┃\n${lines.filter(l => l !== null && l !== undefined).map(l => `┃${l}`).join('\n')}\n┃\n┗▣\n${FOOTER}`;

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const lastUsed = new Map();   // sender -> timestamp
let workingIndex = 0;         // endpoint that last worked

// ───────────── helpers ─────────────
const CODE_REGEX = /\b([A-Z0-9]{4})-?([A-Z0-9]{4})\b/;
const CODE_KEYS = ['code', 'pair_code', 'paircode', 'pairing_code', 'pairingCode', 'pairCode', 'result', 'data'];

function formatCode(raw) {
    const m = String(raw || '').toUpperCase().match(CODE_REGEX);
    return m ? `${m[1]}-${m[2]}` : null;
}

// Pull a pairing code out of JSON, text or HTML
function extractCode(body) {
    if (body === null || body === undefined) return null;

    if (typeof body === 'object') {
        for (const key of CODE_KEYS) {
            const v = body[key];
            if (typeof v === 'string') { const c = formatCode(v); if (c) return c; }
            if (v && typeof v === 'object') { const c = extractCode(v); if (c) return c; }
        }
        return null;
    }

    const text = String(body);
    if (/<!doctype html|<html/i.test(text)) {
        // A whole web page: only trust an explicit "code: XXXX-XXXX" style line
        const m = text.match(/(?:pair(?:ing)?\s*code|code)\s*(?:is)?\s*[:\-]?\s*<?[^A-Z0-9]*([A-Z0-9]{4}-?[A-Z0-9]{4})\b/i);
        return m ? formatCode(m[1]) : null;
    }
    return formatCode(text);
}

function errorFromBody(body) {
    if (body && typeof body === 'object') {
        const msg = body.error || body.message || body.msg;
        if (typeof msg === 'string' && msg.length < 200) return msg;
    }
    return null;
}

async function requestCode(number) {
    const order = [workingIndex, ...ENDPOINTS.map((_, i) => i).filter(i => i !== workingIndex)];
    let lastErr = new Error('The pair server did not return a code');

    for (const i of order) {
        const ep = ENDPOINTS[i];
        const url = `${BASE_URL}${ep.path}`;

        try {
            const res = ep.method === 'post'
                ? await axios.post(url, new URLSearchParams(ep.form(number)).toString(), {
                    timeout: REQUEST_TIMEOUT,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    validateStatus: () => true
                })
                : await axios.get(url, {
                    params: ep.query(number),
                    timeout: REQUEST_TIMEOUT,
                    validateStatus: () => true
                });

            const code = extractCode(res.data);
            if (code) { workingIndex = i; return code; }

            const serverMsg = errorFromBody(res.data);
            if (serverMsg) lastErr = new Error(serverMsg);
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr;
}

async function getCode(number) {
    let lastErr;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
        try {
            return await requestCode(number);
        } catch (err) {
            lastErr = err;
            if (attempt < RETRIES) await wait(3000);
        }
    }
    throw lastErr;
}

// "+254 111-385-747" -> "254111385747" (or null + reason)
function parseNumber(input) {
    const raw = String(input || '').trim();
    if (!raw) return { error: 'empty' };

    const cleaned = raw.replace(/[\s\-().]/g, '');
    if (!/^\+?\d+$/.test(cleaned)) return { error: 'format' };

    const number = cleaned.replace(/^\+/, '');
    if (number.startsWith('0')) return { error: 'local' };
    if (number.length < 10 || number.length > 15) return { error: 'length' };
    return { number };
}

// ───────────── command ─────────────
cmd({
    pattern: 'pair',
    name: 'pair',
    category: 'Tools',
    aliases: ['paircode', 'getcode', 'pairing'],
    description: 'Get a WhatsApp pairing code for a number',
    filename: __filename
}, async (sock, m, args) => {
    const prefix = global.BOT_PREFIX || '.';

    const usage = box(
        '🔗 *𝗣𝗔𝗜𝗥 𝗖𝗢𝗗𝗘*',
        '➽ Get a code to link WhatsApp.',
        '',
        '📌 *𝗘𝗫𝗔𝗠𝗣𝗟𝗘*',
        `➽ ${prefix}pair +254111385747`,
        '',
        '💡 Use your full number with the country code, no leading 0.'
    );

    const parsed = parseNumber(args.join(' '));

    if (parsed.error === 'empty') return m.reply(usage);

    if (parsed.error) {
        await m.react('❌').catch(() => {});
        const reason = {
            format: 'Numbers only, please (a + at the start is fine).',
            local: 'Start with the country code, not 0. Example: +254… not 07…',
            length: 'That number looks too short or too long (10–15 digits).'
        }[parsed.error];
        return m.reply(box('❌ *𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗡𝗨𝗠𝗕𝗘𝗥*', `➽ ${reason}`, '', `📌 Example: ${prefix}pair +254111385747`));
    }

    // Cooldown so nobody hammers the pair server
    const now = Date.now();
    const sinceLast = now - (lastUsed.get(m.sender) || 0);
    if (sinceLast < COOLDOWN_MS) {
        const left = Math.ceil((COOLDOWN_MS - sinceLast) / 1000);
        return m.reply(box('⏳ *𝗣𝗟𝗘𝗔𝗦𝗘 𝗪𝗔𝗜𝗧*', `➽ Try again in ${left}s.`));
    }
    lastUsed.set(m.sender, now);

    let wakeTimer;
    try {
        await m.react('⏳').catch(() => {});

        // Free hosting sleeps when idle: let the user know it is just waking up
        wakeTimer = setTimeout(() => {
            m.reply(box('🛰️ *𝗪𝗔𝗞𝗜𝗡𝗚 𝗨𝗣 𝗦𝗘𝗥𝗩𝗘𝗥*', '➽ This can take up to a minute. Hold on…')).catch(() => {});
        }, WAKE_NOTICE_MS);

        const code = await getCode(parsed.number);
        clearTimeout(wakeTimer);

        await m.reply(box(
            '✅ *𝗣𝗔𝗜𝗥𝗜𝗡𝗚 𝗖𝗢𝗗𝗘 𝗥𝗘𝗔𝗗𝗬*',
            `➽ 📱 Number: +${parsed.number}`,
            '',
            '📲 *𝗛𝗢𝗪 𝗧𝗢 𝗟𝗜𝗡𝗞*',
            '➽ 1. Open WhatsApp → Settings',
            '➽ 2. Tap *Linked devices*',
            '➽ 3. Tap *Link a device*',
            '➽ 4. Choose *Link with phone number instead*',
            '➽ 5. Enter the code below',
            '',
            '⏱️ The code expires quickly, so use it right away.'
        ));

        // Code alone in its own message: long-press to copy
        await m.reply(code);
        await m.react('✅').catch(() => {});
    } catch (err) {
        clearTimeout(wakeTimer);
        lastUsed.delete(m.sender);   // let them retry straight away
        console.error('[PAIR] Error:', err.message);
        await m.react('❌').catch(() => {});

        const timedOut = /timeout|ECONNABORTED/i.test(err.message);
        await m.reply(box(
            '❌ *𝗖𝗢𝗨𝗟𝗗 𝗡𝗢𝗧 𝗚𝗘𝗧 𝗖𝗢𝗗𝗘*',
            `➽ ${timedOut ? 'The pair server took too long to answer.' : err.message}`,
            '➽ Please try again in a moment.',
            '',
            `🌐 Or use the website: ${BASE_URL}/pair`
        ));
    }
});
