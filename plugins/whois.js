'use strict';

const axios = require('axios');
const { cmd } = require('../arslan');

cmd({
    pattern: 'whois',
    name: 'whois',
    category: 'Info',
    aliases: ['domaininfo'],
    description: 'Get WHOIS information of a domain',
    filename: __filename
}, async (sock, m, args) => {

    let domain = args?.[0]?.trim();

    if (!domain) {
        return await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗪𝗛𝗢𝗜𝗦* ◈
┃
┃🌐 *𝗪𝗛𝗢𝗜𝗦 𝗟𝗢𝗢𝗞𝗨𝗣*
┃
┃➽ Please provide a domain.
┃
┃📌 *𝗘𝗫𝗔𝗠𝗣𝗟𝗘*
┃➽ ${global.BOT_PREFIX}whois google.com
┃
┗▣`);
    }

    domain = domain
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split('/')[0];

    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
        return await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗪𝗛𝗢𝗜𝗦* ◈
┃
┃❌ *𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗗𝗢𝗠𝗔𝗜𝗡*
┃
┃➽ Please provide a valid
┃   domain name.
┃
┗▣`);
    }

    await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗪𝗛𝗢𝗜𝗦* ◈
┃
┃🔍 *𝗟𝗢𝗢𝗞𝗜𝗡𝗚 𝗨𝗣*
┃
┃➽ ${domain}
┃
┃⏳ Please wait...
┃
┗▣`);

    try {
        const apiUrl =
            `https://discardapi.dpdns.org/api/tools/whois?apikey=guru&domain=${encodeURIComponent(domain)}`;

        const { data } = await axios.get(apiUrl, {
            timeout: 10000
        });

        if (!data?.status || !data.result?.domain) {
            return await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗪𝗛𝗢𝗜𝗦* ◈
┃
┃❌ *𝗟𝗢𝗢𝗞𝗨𝗣 𝗙𝗔𝗜𝗟𝗘𝗗*
┃
┃➽ Could not fetch WHOIS
┃   information for this domain.
┃
┗▣`);
        }

        const {
            domain: dom,
            registrar = {},
            registrant = {},
            technical = {}
        } = data.result;

        const status = Array.isArray(dom.status)
            ? dom.status.join(', ')
            : dom.status || 'N/A';

        const nameServers = Array.isArray(dom.name_servers)
            ? dom.name_servers.join(', ')
            : dom.name_servers || 'N/A';

        const text = `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗪𝗛𝗢𝗜𝗦* ◈
┃
┃🌐 *𝗗𝗢𝗠𝗔𝗜𝗡 𝗜𝗡𝗙𝗢*
┃
┃➽ *Domain* : ${dom.domain || 'N/A'}
┃➽ *Name* : ${dom.name || 'N/A'}
┃➽ *Extension* : .${dom.extension || 'N/A'}
┃➽ *WHOIS Server* : ${dom.whois_server || 'N/A'}
┃➽ *Status* : ${status}
┃➽ *Name Servers* : ${nameServers}
┃
┃📅 *DATES*
┃➽ *Created* : ${dom.created_date_in_time || 'N/A'}
┃➽ *Updated* : ${dom.updated_date_in_time || 'N/A'}
┃➽ *Expires* : ${dom.expiration_date_in_time || 'N/A'}
┃
┃🏢 *REGISTRAR*
┃➽ *Name* : ${registrar.name || 'N/A'}
┃➽ *Phone* : ${registrar.phone || 'N/A'}
┃➽ *Email* : ${registrar.email || 'N/A'}
┃➽ *Website* : ${registrar.referral_url || 'N/A'}
┃
┃👤 *REGISTRANT*
┃➽ *Organization* : ${registrant.organization || 'N/A'}
┃➽ *Country* : ${registrant.country || 'N/A'}
┃➽ *Email* : ${registrant.email || 'N/A'}
┃
┃⚙️ *TECHNICAL*
┃➽ *Email* : ${technical.email || 'N/A'}
┃
┗▣`;

        await m.reply(text);

    } catch (error) {
        console.error('❌ WHOIS plugin error:', error);

        if (error.code === 'ECONNABORTED') {
            return await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗪𝗛𝗢𝗜𝗦* ◈
┃
┃⏱️ *𝗥𝗘𝗤𝗨𝗘𝗦𝗧 𝗧𝗜𝗠𝗘𝗗 𝗢𝗨𝗧*
┃
┃➽ The WHOIS API is slow
┃   or currently unreachable.
┃
┗▣`);
        }

        await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗪𝗛𝗢𝗜𝗦* ◈
┃
┃❌ *𝗙𝗔𝗜𝗟𝗘𝗗*
┃
┃➽ Failed to fetch WHOIS
┃   information.
┃
┗▣`);
    }
});
