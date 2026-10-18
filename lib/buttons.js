'use strict';
/**
 * Button helper — one place to build tap-to-run messages.
 *
 * A tapped quick_reply button comes back through handler.js as m.body
 * (= the button id), so an id like ".mode private" goes through the exact
 * same dispatcher, permission checks and mode protection as if the user had
 * typed it. Buttons therefore need no new command logic.
 *
 * Usage:
 *   const { sendBtns } = require('../lib/buttons');
 *   await sendBtns(sock, m, {
 *       title: 'MY TITLE',
 *       text:  'Body text',
 *       footer: 'optional',
 *       buttons: [
 *           { text: '🌐 Public',  cmd: 'mode public' },        // runs .mode public
 *           { text: '🔗 Website', url: 'https://popkid.xyz' }, // opens a link
 *           { text: '📋 Copy',    copy: 'text to copy' }       // copies text
 *       ]
 *   });
 *
 * If sending buttons fails (some WhatsApp clients/versions drop them), it
 * falls back to a plain text message listing the commands, so nothing breaks.
 */
const { sendInteractiveMessage } = require('gifted-btns');

function toInteractive(b) {
    if (b.url) {
        return {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({ display_text: b.text, url: b.url, merchant_url: b.url })
        };
    }
    if (b.copy) {
        return {
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({ display_text: b.text, copy_code: b.copy })
        };
    }
    const id = b.id || (b.cmd ? `${global.BOT_PREFIX}${b.cmd}` : '');
    return {
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({ display_text: b.text, id })
    };
}

async function sendBtns(sock, m, { title = '', text = '', footer = '', buttons = [] } = {}) {
    try {
        await sendInteractiveMessage(sock, m.from, {
            title,
            text,
            footer: footer || 'POPKID MD',
            interactiveButtons: buttons.map(toInteractive)
        });
        return true;
    } catch (err) {
        console.error('Buttons send failed, using text fallback:', err.message);
        const lines = buttons
            .filter(b => b.cmd || b.id)
            .map(b => `➽ ${global.BOT_PREFIX}${b.cmd || String(b.id).replace(global.BOT_PREFIX, '')}`)
            .join('\n');
        await m.reply(`${title ? `*${title}*\n\n` : ''}${text}${lines ? `\n\n${lines}` : ''}`);
        return false;
    }
}

module.exports = { sendBtns };
