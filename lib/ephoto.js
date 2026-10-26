'use strict';
/**
 * Ephoto360 engine (no extra dependencies — uses Node 20 built-in fetch/FormData).
 *
 * Flow used by the site:
 *   1. GET  effect page      -> cookies + token + build_server + build_server_id (+ radio styles)
 *   2. POST effect page      -> multipart form (text[], token, ...). The reply HTML contains
 *                               <input id="form_value_input" value='{json}'>
 *   3. POST /effect/create-image with that JSON (PHP-style fields) -> { success, image }
 *   4. Image url = build_server + image  -> we download it and send it as a buffer.
 *
 * Every step has timeouts, retries, and is tried against every candidate URL of an effect.
 */

const BASE = process.env.EPHOTO_BASE || 'https://en.ephoto360.com';
const UA =
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.0.0 Mobile Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function decodeEntities(str = '') {
    return str
        .replace(/&quot;/g, '"')
        .replace(/&#0*39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

class CookieJar {
    constructor() { this.map = new Map(); }
    absorb(res) {
        let list = [];
        if (typeof res.headers.getSetCookie === 'function') list = res.headers.getSetCookie();
        else {
            const raw = res.headers.get('set-cookie');
            if (raw) list = raw.split(/,(?=\s*[^;,]+=)/);
        }
        for (const c of list) {
            const [pair] = c.split(';');
            const i = pair.indexOf('=');
            if (i > 0) this.map.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
        }
    }
    header() { return [...this.map].map(([k, v]) => `${k}=${v}`).join('; '); }
}

async function http(url, opts = {}, jar, timeout = 25000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
        const headers = Object.assign({ 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, opts.headers || {});
        if (jar && jar.header()) headers.Cookie = jar.header();
        const res = await fetch(url, { redirect: 'follow', ...opts, headers, signal: ctrl.signal });
        if (jar) jar.absorb(res);
        return res;
    } finally {
        clearTimeout(timer);
    }
}

function fullUrl(u) {
    if (/^https?:\/\//i.test(u)) return u;
    return BASE + (u.startsWith('/') ? u : '/' + u);
}

function inputValue(html, name) {
    // find <input ... name="x" ... value="y"> in any attribute order
    const re = new RegExp(`<input[^>]*name=["']${name}["'][^>]*>`, 'i');
    const tag = (html.match(re) || [])[0];
    if (!tag) return null;
    const v = tag.match(/value=(?:"([^"]*)"|'([^']*)')/i);
    return v ? decodeEntities(v[1] ?? v[2] ?? '') : '';
}

/** Parse the effect page: token, server ids, number of text boxes, radio style groups. */
function parseEffectPage(html) {
    const token = inputValue(html, 'token');
    const build_server = inputValue(html, 'build_server');
    const build_server_id = inputValue(html, 'build_server_id');

    if (!token || !build_server) {
        throw new Error('effect page has no token (page removed or site changed)');
    }

    const textCount = Math.max(1, (html.match(/name=["']text\[\]["']/gi) || []).length);
    const hasImageUpload = /name=["']file["']|type=["']file["']/i.test(html);

    // radio groups: radio0[radio], radio1[radio] ...
    const radios = {};
    const radioRe = /<input[^>]*name=["'](radio\d+)\[radio\]["'][^>]*>/gi;
    let mm;
    while ((mm = radioRe.exec(html))) {
        const val = (mm[0].match(/value=(?:"([^"]*)"|'([^']*)')/i) || [])[1] ||
                    (mm[0].match(/value=(?:"([^"]*)"|'([^']*)')/i) || [])[2];
        if (!val) continue;
        (radios[mm[1]] = radios[mm[1]] || []).push(decodeEntities(val));
    }

    const title = decodeEntities(((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').trim());
    return { token, build_server, build_server_id, textCount, hasImageUpload, radios, title };
}

/** Flatten nested JSON into PHP-style form fields: a[] / a[b] */
function toFormFields(obj) {
    const out = new URLSearchParams();
    const walk = (val, key) => {
        if (val === null || val === undefined) return;
        if (Array.isArray(val)) {
            val.forEach(v => (typeof v === 'object' && v !== null ? walk(v, `${key}[]`) : out.append(`${key}[]`, String(v))));
        } else if (typeof val === 'object') {
            for (const [k, v] of Object.entries(val)) walk(v, key ? `${key}[${k}]` : k);
        } else {
            out.append(key, String(val));
        }
    };
    for (const [k, v] of Object.entries(obj)) walk(v, k);
    return out;
}

/** Run one effect against ONE url. Throws on any failure. */
async function runOnce(url, texts, opts = {}) {
    const jar = new CookieJar();
    const pageUrl = fullUrl(url);

    // 1) effect page
    const pageRes = await http(pageUrl, {}, jar);
    if (!pageRes.ok) throw new Error(`effect page HTTP ${pageRes.status}`);
    const html = await pageRes.text();
    const page = parseEffectPage(html);

    if (page.hasImageUpload && !/name=["']text\[\]["']/i.test(html)) {
        throw new Error('this effect needs a photo upload, not text');
    }

    // fill the right number of text boxes
    const filled = [];
    for (let i = 0; i < page.textCount; i++) filled.push(texts[i] ?? texts[texts.length - 1] ?? '');

    // 2) submit the form
    const form = new FormData();
    filled.forEach(t => form.append('text[]', t));
    form.append('submit', 'GO');
    form.append('token', page.token);
    form.append('build_server', page.build_server);
    form.append('build_server_id', page.build_server_id || '1');

    for (const [group, values] of Object.entries(page.radios)) {
        const pick = opts.randomStyle ? values[Math.floor(Math.random() * values.length)] : values[0];
        form.append(`${group}[radio]`, pick);
    }

    const submitRes = await http(pageUrl, {
        method: 'POST',
        body: form,
        headers: { Origin: BASE, Referer: pageUrl }
    }, jar);
    if (!submitRes.ok) throw new Error(`submit HTTP ${submitRes.status}`);
    const submitHtml = await submitRes.text();

    let raw =
        (submitHtml.match(/id=["']form_value_input["'][^>]*value='([\s\S]*?)'/i) || [])[1] ||
        (submitHtml.match(/id=["']form_value_input["'][^>]*value="([\s\S]*?)"/i) || [])[1] ||
        (submitHtml.match(/value='([\s\S]*?)'[^>]*id=["']form_value_input["']/i) || [])[1] ||
        (submitHtml.match(/value="([\s\S]*?)"[^>]*id=["']form_value_input["']/i) || [])[1];

    if (!raw) {
        const err = (submitHtml.match(/class=["'][^"']*alert[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1];
        throw new Error(err ? decodeEntities(err.replace(/<[^>]+>/g, '').trim()) : 'no form_value_input in reply');
    }

    let formValue;
    try { formValue = JSON.parse(decodeEntities(raw)); }
    catch { throw new Error('could not parse form_value_input JSON'); }

    formValue.text = filled;

    // 3) create the image
    const createRes = await http(`${BASE}/effect/create-image`, {
        method: 'POST',
        body: toFormFields(formValue).toString(),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            Origin: BASE,
            Referer: pageUrl
        }
    }, jar, 45000);

    const createText = await createRes.text();
    let data;
    try { data = JSON.parse(createText); }
    catch { throw new Error(`create-image returned non-JSON (HTTP ${createRes.status})`); }

    if (!data.success || !data.image) {
        throw new Error(`create-image failed: ${String(data.error || data.message || 'no image').slice(0, 120)}`);
    }

    const imageUrl = /^https?:\/\//i.test(data.image) ? data.image : page.build_server.replace(/\/$/, '') + data.image;

    // 4) download so WhatsApp never has to reach the ephoto server itself
    const imgRes = await http(imageUrl, { headers: { Referer: BASE + '/' } }, jar, 40000);
    if (!imgRes.ok) throw new Error(`image download HTTP ${imgRes.status}`);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    if (buffer.length < 1500) throw new Error('downloaded image is empty/too small');

    return { buffer, imageUrl, pageUrl, title: page.title, textCount: page.textCount };
}

/**
 * Generate an image. `urls` is a list of candidate effect pages; each is tried
 * (with retries) until one works.
 */
async function generate(urls, texts, opts = {}) {
    const list = [].concat(urls).filter(Boolean);
    const retries = opts.retries ?? 2;
    const errors = [];

    for (const url of list) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await runOnce(url, texts, opts);
            } catch (err) {
                const msg = err.name === 'AbortError' ? 'timeout' : err.message;
                errors.push(`${url} #${attempt}: ${msg}`);
                // a dead page will not heal by retrying — move on to the next candidate
                if (/HTTP 404|HTTP 410|no token|needs a photo/i.test(msg)) break;
                await sleep(800 * attempt);
            }
        }
    }
    const e = new Error('all ephoto attempts failed');
    e.details = errors;
    throw e;
}

module.exports = { generate, runOnce, parseEffectPage, toFormFields, BASE };
