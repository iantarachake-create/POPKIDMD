const { cmd } = require('../arslan');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   AUTO READ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

cmd({
    pattern: "autoread",
    name: "autoread",
    category: "Admin",
    aliases: ["ar"],
    description: "Toggle auto read",
    filename: __filename
}, async (sock, m, args) => {

    if (!global.owners.includes(m.sender)) return;

    const value = (args[0] || "").toLowerCase();

    if (!["on", "off"].includes(value)) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗨𝗧𝗢 𝗥𝗘𝗔𝗗* ◈
┃
┃📖 *𝗦𝗧𝗔𝗧𝗨𝗦* : ${global.autoRead ? "𝗢𝗡" : "𝗢𝗙𝗙"}
┃
┃➽ 𝗨𝗦𝗘 : .autoread on/off
┃
┗▣`);
    }

    global.autoRead = value === "on";

    return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗨𝗧𝗢 𝗥𝗘𝗔𝗗* ◈
┃
┃${global.autoRead ? "🟢" : "🔴"} *𝗔𝗨𝗧𝗢 𝗥𝗘𝗔𝗗* : ${global.autoRead ? "𝗢𝗡" : "𝗢𝗙𝗙"}
┃
┗▣`);
});


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   AUTO VIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

cmd({
    pattern: "autoview",
    name: "autoview",
    category: "Admin",
    aliases: ["av"],
    description: "Toggle automatic status viewing",
    filename: __filename
}, async (sock, m, args) => {

    if (!global.owners.includes(m.sender)) return;

    const value = (args[0] || "").toLowerCase();

    if (!["on", "off"].includes(value)) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗨𝗧𝗢 𝗩𝗜𝗘𝗪* ◈
┃
┃👁️ *𝗦𝗧𝗔𝗧𝗨𝗦* : ${global.autoView ? "𝗢𝗡" : "𝗢𝗙𝗙"}
┃
┃➽ 𝗨𝗦𝗘 : .autoview on/off
┃
┗▣`);
    }

    global.autoView = value === "on";

    return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗨𝗧𝗢 𝗩𝗜𝗘𝗪* ◈
┃
┃${global.autoView ? "🟢" : "🔴"} *𝗔𝗨𝗧𝗢 𝗩𝗜𝗘𝗪* : ${global.autoView ? "𝗢𝗡" : "𝗢𝗙𝗙"}
┃
┗▣`);
});


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   AUTO LIKE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

cmd({
    pattern: "autolike",
    name: "autolike",
    category: "Admin",
    aliases: ["al"],
    description: "Toggle automatic status likes",
    filename: __filename
}, async (sock, m, args) => {

    if (!global.owners.includes(m.sender)) return;

    const value = (args[0] || "").toLowerCase();

    if (!["on", "off"].includes(value)) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗨𝗧𝗢 𝗟𝗜𝗞𝗘* ◈
┃
┃❤️ *𝗦𝗧𝗔𝗧𝗨𝗦* : ${global.autoLike ? "𝗢𝗡" : "𝗢𝗙𝗙"}
┃
┃➽ 𝗨𝗦𝗘 : .autolike on/off
┃
┗▣`);
    }

    global.autoLike = value === "on";

    return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗨𝗧𝗢 𝗟𝗜𝗞𝗘* ◈
┃
┃${global.autoLike ? "🟢" : "🔴"} *𝗔𝗨𝗧𝗢 𝗟𝗜𝗞𝗘* : ${global.autoLike ? "𝗢𝗡" : "𝗢𝗙𝗙"}
┃
┗▣`);
});


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   AUTO TYPING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

cmd({
    pattern: "autotyping",
    name: "autotyping",
    category: "Admin",
    aliases: ["at"],
    description: "Toggle automatic typing presence",
    filename: __filename
}, async (sock, m, args) => {

    if (!global.owners.includes(m.sender)) return;

    const value = (args[0] || "").toLowerCase();

    if (!["on", "off"].includes(value)) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗨𝗧𝗢 𝗧𝗬𝗣𝗜𝗡𝗚* ◈
┃
┃⌨️ *𝗦𝗧𝗔𝗧𝗨𝗦* : ${global.presenceMode === "typing" ? "𝗢𝗡" : "𝗢𝗙𝗙"}
┃
┃➽ 𝗨𝗦𝗘 : .autotyping on/off
┃
┗▣`);
    }

    if (value === "on") {
        global.presenceMode = "typing";
    } else {
        global.presenceMode = "none";
    }

    return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗔𝗨𝗧𝗢 𝗧𝗬𝗣𝗜𝗡𝗚* ◈
┃
┃${value === "on" ? "🟢" : "🔴"} *𝗔𝗨𝗧𝗢 𝗧𝗬𝗣𝗜𝗡𝗚* : ${value === "on" ? "𝗢𝗡" : "𝗢𝗙𝗙"}
┃
┗▣`);
});


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   AUTO PRESENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

cmd({
    pattern: "autopresence",
    name: "autopresence",
    category: "Admin",
    aliases: ["presence"],
    description: "Set bot presence mode",
    filename: __filename
}, async (sock, m, args) => {

    if (!global.owners.includes(m.sender)) return;

    const mode = (args[0] || "").toLowerCase();
    const modes = ["none", "typing", "recording", "online"];

    if (!modes.includes(mode)) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗥𝗘𝗦𝗘𝗡𝗖𝗘* ◈
┃
┃📡 *𝗠𝗢𝗗𝗘* : ${global.presenceMode || "none"}
┃
┃➽ .autopresence none
┃➽ .autopresence typing
┃➽ .autopresence recording
┃➽ .autopresence online
┃
┗▣`);
    }

    global.presenceMode = mode;

    return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗣𝗥𝗘𝗦𝗘𝗡𝗖𝗘* ◈
┃
┃📡 *𝗣𝗥𝗘𝗦𝗘𝗡𝗖𝗘* : 𝗦𝗘𝗧
┃➽ *𝗠𝗢𝗗𝗘* : ${mode.toUpperCase()}
┃
┗▣`);
});
