'use strict';
/**
 * Autobio — keeps the bot's WhatsApp "About" live with status + local time.
 * Shows immediately on connect, then refreshes every minute.
 * Settings persist in data/autobio.json (enabled, timezone, interval).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'autobio.json');
const MAX_LEN = 139; // WhatsApp "About" limit

const DEFAULTS = { enabled: true, timezone: 'Africa/Nairobi' };

let settings = load();
let timer = null;
let lastText = '';
let connectedAt = Date.now();

function load() {
    try {
        return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    } catch {
        return { ...DEFAULTS };
    }
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
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
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
    const tz = settings.timezone;
    const now = new Date();
    const time = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true
    }).format(now);
    const date = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, weekday: 'short', day: '2-digit', month: 'short'
    }).format(now);
    const city = tz.split('/').pop().replace(/_/g, ' ');

    return `🟢 POPKID BOT is UP | ⏱️ ${formatUptime(Date.now() - connectedAt)} | 🕐 ${time} (${city}) | ${date}`
        .slice(0, MAX_LEN);
}

async function tick(sock) {
    if (!settings.enabled || sock?.ws?.readyState !== 1) return false;
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

/** Call when the connection opens: updates immediately, then every minute. */
function start(sock) {
    stop();
    connectedAt = Date.now();
    lastText = '';
    if (!settings.enabled) return;
    tick(sock);
    timer = setInterval(() => tick(sock), 60 * 1000);
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
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
    tick(sock);
    return true;
}

module.exports = {
    start, stop, setEnabled, setTimezone, isValidTimezone, buildBio,
    getSettings: () => ({ ...settings })
};
