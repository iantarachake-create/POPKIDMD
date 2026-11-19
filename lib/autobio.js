'use strict';
/**
 * Autobio — automatically sets the connected user's WhatsApp "About" as soon as
 * they connect to the bot, then keeps it fresh (uptime + local time).
 *
 *   • Starts on every connection 'open' (first pairing AND every reconnect)
 *   • Retries with backoff if WhatsApp isn't ready yet (no silent failure)
 *   • Default text: "🟢 POPKID MD is running | ⏱️ 2h 5m | 🕐 09:41 PM (Nairobi) | Thu, 19 Nov"
 *   • Custom text with placeholders: {uptime} {time} {date} {city}
 * Settings persist in data/autobio.json (enabled, timezone, custom).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'autobio.json');
const MAX_LEN = 139;              // WhatsApp "About" limit
const REFRESH_MS = 2 * 60 * 1000; // keep clock/uptime fresh without spamming WhatsApp
const RETRY_DELAYS = [3000, 6000, 12000, 20000, 30000];

const DEFAULTS = { enabled: true, timezone: 'Africa/Nairobi', custom: '' };

let settings = load();
let timer = null;
let retryTimer = null;
let lastText = '';
let connectedAt = Date.now();
let session = 0; // bumps on every start/stop so stale retries die quietly

function load() {
    try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; }
    catch { return { ...DEFAULTS }; }
}

function save() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(settings, null, 2));
    } catch (err) {
        console.error('Autobio: could not save settings:', err.message);
    }
}

function isValidTimezone(tz) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
    catch { return false; }
}

function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return `${d}d ${h}h ${m}m`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
}

function buildBio() {
    const tz = isValidTimezone(settings.timezone) ? settings.timezone : DEFAULTS.timezone;
    const now = new Date();
    const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true }).format(now);
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short' }).format(now);
    const city = tz.split('/').pop().replace(/_/g, ' ');
    const uptime = formatUptime(Date.now() - connectedAt);

    if (settings.custom) {
        return settings.custom
            .replace(/\{uptime\}/gi, uptime)
            .replace(/\{time\}/gi, time)
            .replace(/\{date\}/gi, date)
            .replace(/\{city\}/gi, city)
            .slice(0, MAX_LEN);
    }
    return `🟢 POPKID MD is running | ⏱️ ${uptime} | 🕐 ${time} (${city}) | ${date}`.slice(0, MAX_LEN);
}

/** One update attempt. Doesn't depend on ws internals — just tries and reports. */
async function push(sock) {
    if (!sock?.user) return false;
    const text = buildBio();
    if (text === lastText) return true;
    try {
        await sock.updateProfileStatus(text);
        lastText = text;
        return true;
    } catch (err) {
        console.error('Autobio update failed:', err.message);
        return false;
    }
}

/** Update now; if it fails (socket still warming up), retry with backoff. */
function pushWithRetry(sock, id, attempt = 0) {
    if (id !== session || !settings.enabled) return;
    push(sock).then(ok => {
        if (ok) { if (attempt) console.log('📝 Autobio set after retry'); return; }
        if (attempt >= RETRY_DELAYS.length) return;
        retryTimer = setTimeout(() => pushWithRetry(sock, id, attempt + 1), RETRY_DELAYS[attempt]);
    });
}

/** Call when the connection opens: sets the bio immediately, then refreshes on a timer. */
function start(sock) {
    stop();
    session++;
    const id = session;
    connectedAt = Date.now();
    lastText = '';
    if (!settings.enabled) return;
    console.log('📝 Autobio: setting bio for connected user');
    pushWithRetry(sock, id);
    timer = setInterval(() => { if (id === session) push(sock); }, REFRESH_MS);
}

function stop() {
    session++;
    if (timer) clearInterval(timer);
    if (retryTimer) clearTimeout(retryTimer);
    timer = null;
    retryTimer = null;
}

function setEnabled(sock, on) {
    settings.enabled = !!on;
    save();
    if (on) start(sock); else stop();
}

function setTimezone(sock, tz) {
    if (!isValidTimezone(tz)) return false;
    settings.timezone = tz;
    save();
    lastText = '';
    push(sock);
    return true;
}

/** Set custom text ('' to go back to the default). */
function setCustom(sock, text) {
    settings.custom = String(text || '').trim();
    save();
    lastText = '';
    push(sock);
}

module.exports = {
    start, stop, setEnabled, setTimezone, setCustom, isValidTimezone, buildBio,
    getSettings: () => ({ ...settings })
};
