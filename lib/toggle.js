'use strict';
const { cmd } = require('../arslan');
const settings = require('./settings');
const { P, isOwner, box, parseOnOff } = require('./cmdutil');

/**
 * Registers `.name on|off` for a boolean setting.
 * opts.after(sock, m, value) runs after a successful change (to apply it live).
 */
function defineToggle(name, key, label, opts = {}) {
    cmd({
        pattern: name,
        name,
        alias: opts.alias || [],
        category: 'Settings',
        desc: opts.desc || `${label}: on/off`,
        react: opts.react || '⚙️',
        filename: opts.filename || __filename
    }, async (sock, m, args) => {
        if (!isOwner(m)) return m.reply('❌ Owner only.');
        const v = parseOnOff(args[0]);
        if (v === null) {
            return m.reply(box(`𝗣𝗢𝗣𝗞𝗜𝗗 ${name.toUpperCase()}`, [
                `➽ ${label}: ${settings.get(key) ? '✅ ON' : '❌ OFF'}`,
                `➽ Usage: ${P()}${name} on|off`,
                ...(opts.help || [])
            ]));
        }
        try {
            settings.set(key, v);
            if (opts.after) await opts.after(sock, m, v);
            return m.reply(`✅ ${label} turned ${v ? 'ON' : 'OFF'}.${opts.note ? '\n' + opts.note : ''}`);
        } catch (e) {
            return m.reply(`❌ ${e.message}`);
        }
    });
}

module.exports = { defineToggle };
