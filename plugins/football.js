'use strict';
/**
 * Football scores — Highlightly API (https://sports.highlightly.net)
 *
 *   .matches [yesterday|today|tomorrow|YYYY-MM-DD] [league/team filter]
 *   .live    [league/team filter]
 *
 * Key comes from the HIGHLIGHTLY_API_KEY env var (see config.js) — never
 * hardcode it in this file.
 */
const { cmd } = require('../arslan');
const { sendBtns } = require('../lib/buttons');
const autobio = require('../lib/autobio');

const API = 'https://sports.highlightly.net/football/matches';
const MAX_MATCHES = 40;
const MAX_PAGES = 4; // API pages are limited, so fetch a few to cover a full day

const tz = () => autobio.getSettings().timezone || 'Africa/Nairobi';

function ymd(date) {
    // YYYY-MM-DD in the bot's timezone
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz() }).format(date);
}

function resolveDate(word) {
    const w = (word || 'today').toLowerCase();
    const day = 86400000;
    if (w === 'today') return ymd(new Date());
    if (w === 'tomorrow') return ymd(new Date(Date.now() + day));
    if (w === 'yesterday') return ymd(new Date(Date.now() - day));
    if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
    return null;
}

async function fetchMatches(date) {
    const key = global.highlightlyKey;
    if (!key) throw new Error('NO_KEY');

    const all = [];
    for (let page = 0; page < MAX_PAGES; page++) {
        const url = `${API}?date=${date}&timezone=${encodeURIComponent(tz())}&limit=100&offset=${page * 100}`;
        const res = await fetch(url, { headers: { 'x-rapidapi-key': key } });
        if (!res.ok) throw new Error(`Highlightly responded ${res.status}`);
        const json = await res.json();
        const rows = Array.isArray(json) ? json : (json.data || []);
        all.push(...rows);
        if (rows.length < 100) break;
    }
    return all;
}

// Defensive field readers — the API shape may differ slightly between plans.
const homeName = x => x.homeTeam?.name || x.home?.name || 'Home';
const awayName = x => x.awayTeam?.name || x.away?.name || 'Away';
const leagueName = x => x.league?.name || x.competition?.name || 'Other';
const countryName = x => x.country?.name || x.league?.country || '';
const stateDesc = x => String(x.state?.description || x.status || '');

function scoreOf(x) {
    const cur = x.state?.score?.current ?? x.score?.current ?? null;
    if (cur) return String(cur).replace(/\s*-\s*/, ' - ');
    const h = x.state?.score?.home ?? x.homeScore;
    const a = x.state?.score?.away ?? x.awayScore;
    return h != null && a != null ? `${h} - ${a}` : null;
}

function isLive(x) {
    const d = stateDesc(x).toLowerCase();
    const clock = x.state?.clock;
    return clock != null && clock !== '' && !/finish|full|ended|postpon|cancel|not started|scheduled|abandon/.test(d)
        || /first half|second half|half time|halftime|extra time|penalt|in progress|live/.test(d);
}

function kickoff(x) {
    if (!x.date) return '--:--';
    const t = new Date(x.date);
    if (isNaN(t)) return '--:--';
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
}

function line(x) {
    const score = scoreOf(x);
    const d = stateDesc(x).toLowerCase();
    if (isLive(x)) {
        const clock = x.state?.clock != null && x.state.clock !== '' ? `${x.state.clock}'` : stateDesc(x);
        return `🔴 ${clock}  ${homeName(x)} *${score || '0 - 0'}* ${awayName(x)}`;
    }
    if (score && /finish|full|ended|after/.test(d)) {
        return `✅ FT  ${homeName(x)} *${score}* ${awayName(x)}`;
    }
    if (/postpon|cancel|abandon/.test(d)) {
        return `⛔ ${stateDesc(x)}  ${homeName(x)} vs ${awayName(x)}`;
    }
    return `🕐 ${kickoff(x)}  ${homeName(x)} vs ${awayName(x)}`;
}

function build(matches, { title, filter }) {
    let list = matches;
    if (filter) {
        const f = filter.toLowerCase();
        list = list.filter(x =>
            `${leagueName(x)} ${countryName(x)} ${homeName(x)} ${awayName(x)}`.toLowerCase().includes(f));
    }
    if (!list.length) return null;

    list = [...list].sort((a, b) =>
        leagueName(a).localeCompare(leagueName(b)) || String(a.date).localeCompare(String(b.date)));

    const shown = list.slice(0, MAX_MATCHES);
    const groups = new Map();
    for (const x of shown) {
        const key = `${countryName(x) ? countryName(x) + ' • ' : ''}${leagueName(x)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(line(x));
    }

    let out = `⚽ *${title}*\n🌍 ${tz()}\n`;
    for (const [league, rows] of groups) out += `\n🏆 *${league}*\n${rows.join('\n')}\n`;
    if (list.length > shown.length) {
        out += `\n_…and ${list.length - shown.length} more. Add a league or team name to narrow it down, e.g._ ` +
               `*${global.BOT_PREFIX}matches today premier league*`;
    }
    return out.trim();
}

function friendlyError(err) {
    if (err.message === 'NO_KEY') {
        return '❌ Football API key missing. Add HIGHLIGHTLY_API_KEY to your .env / host variables and restart the bot.';
    }
    if (/401|403/.test(err.message)) return '❌ Football API rejected the key (check HIGHLIGHTLY_API_KEY / plan).';
    if (/429/.test(err.message)) return '⏳ Football API rate limit reached. Try again in a bit.';
    return `❌ Could not get matches: ${err.message}`;
}

cmd({
    pattern: 'matches',
    name: 'matches',
    aliases: ['football', 'fixtures', 'scores', 'epl'],
    category: 'Sports',
    description: 'Football matches by date: .matches [today|tomorrow|yesterday|YYYY-MM-DD] [league/team]',
    filename: __filename
}, async (sock, m, args) => {
    let date = resolveDate(args[0]);
    let filterWords = args.slice(1);
    if (!date) { date = resolveDate('today'); filterWords = args; } // ".matches arsenal"
    const filter = filterWords.join(' ').trim();

    try {
        await m.react('⚽');
        const matches = await fetchMatches(date);
        const text = build(matches, { title: `FOOTBALL • ${date}${filter ? ` • ${filter}` : ''}`, filter });
        if (!text) return m.reply(`⚽ No matches found for *${date}*${filter ? ` matching "${filter}"` : ''}.`);

        await m.reply(text);
        return sendBtns(sock, m, {
            title: '⚽ 𝗙𝗢𝗢𝗧𝗕𝗔𝗟𝗟',
            text: 'Quick filters:',
            buttons: [
                { text: '⏮️ Yesterday', cmd: `matches yesterday ${filter}`.trim() },
                { text: '⏭️ Tomorrow', cmd: `matches tomorrow ${filter}`.trim() },
                { text: '🏴 Premier League', cmd: `matches ${date} premier league` },
                { text: '🏆 Champions League', cmd: `matches ${date} champions league` },
                { text: '🔴 Live now', cmd: 'live' }
            ]
        });
    } catch (err) {
        console.error('football plugin:', err.message);
        return m.reply(friendlyError(err));
    }
});

cmd({
    pattern: 'live',
    name: 'live',
    aliases: ['livescore', 'livescores'],
    category: 'Sports',
    description: 'Football matches in play right now: .live [league/team]',
    filename: __filename
}, async (sock, m, args) => {
    const filter = args.join(' ').trim();
    try {
        await m.react('🔴');
        const matches = (await fetchMatches(resolveDate('today'))).filter(isLive);
        const text = build(matches, { title: `LIVE NOW${filter ? ` • ${filter}` : ''}`, filter });
        if (!text) return m.reply('🔴 No live football matches right now.');
        await m.reply(text);
        return sendBtns(sock, m, {
            title: '🔴 𝗟𝗜𝗩𝗘',
            text: 'Refresh or see the full day:',
            buttons: [
                { text: '🔄 Refresh', cmd: `live ${filter}`.trim() },
                { text: '📅 Today\'s matches', cmd: 'matches today' }
            ]
        });
    } catch (err) {
        console.error('football plugin:', err.message);
        return m.reply(friendlyError(err));
    }
});
