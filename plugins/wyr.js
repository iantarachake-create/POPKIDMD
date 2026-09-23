'use strict';

const axios = require('axios');
const { cmd } = require('../arslan');

cmd({
    pattern: 'wyr',
    name: 'wyr',
    category: 'Fun',
    aliases: ['wouldyourather'],
    description: 'Get a Would You Rather question',
    filename: __filename
}, async (sock, m, args) => {

    await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗪𝗢𝗨𝗟𝗗 𝗬𝗢𝗨 𝗥𝗔𝗧𝗛𝗘𝗥* ◈
┃
┃🤔 *𝗚𝗘𝗡𝗘𝗥𝗔𝗧𝗜𝗡𝗚 𝗤𝗨𝗘𝗦𝗧𝗜𝗢𝗡*
┃
┃⏳ Please wait...
┃
┗▣`);

    try {

        const res = await axios.get(
            'https://discardapi.dpdns.org/api/quote/wyr?apikey=guru',
            {
                timeout: 15000
            }
        );

        if (
            !res.data ||
            res.data.status !== true ||
            !res.data.question
        ) {
            return await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗪𝗬𝗥* ◈
┃
┃❌ *𝗙𝗔𝗜𝗟𝗘𝗗*
┃
┃➽ Failed to fetch a
┃   Would You Rather question.
┃
┗▣`);
        }

        const opt1 =
            res.data.question.option1 ||
            'Option 1 not found';

        const opt2 =
            res.data.question.option2 ||
            'Option 2 not found';

        const creator =
            res.data.creator ||
            'Unknown';

        const replyText = `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗪𝗬𝗥* ◈
┃
┃🤔 *𝗪𝗢𝗨𝗟𝗗 𝗬𝗢𝗨 𝗥𝗔𝗧𝗛𝗘𝗥?*
┃
┃🅰️ ${opt1}
┃
┃🅱️ ${opt2}
┃
┃━━━━━━━━━━━━━━━━
┃
┃💭 *𝗖𝗛𝗢𝗢𝗦𝗘 𝗢𝗡𝗘!*
┃
┃👤 *𝗖𝗥𝗘𝗔𝗧𝗢𝗥* : ${creator}
┃
┗▣`;

        await m.reply(replyText);

    } catch (err) {

        console.error(
            '❌ WYR plugin error:',
            err
        );

        await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗪𝗬𝗥* ◈
┃
┃❌ *𝗘𝗥𝗥𝗢𝗥*
┃
┃➽ Unable to fetch a
┃   question right now.
┃
┃🔄 Please try again later.
┃
┗▣`);
    }
});
