const { cmd } = require('../arslan');

// Safe math evaluator using pure Node.js
function safeMath(expr) {
    const sanitized = expr
        .replace(/\^/g, '**')
        .replace(/sqrt\(/g, 'Math.sqrt(')
        .replace(/cbrt\(/g, 'Math.cbrt(')
        .replace(/abs\(/g, 'Math.abs(')
        .replace(/sin\(/g, 'Math.sin(')
        .replace(/cos\(/g, 'Math.cos(')
        .replace(/tan\(/g, 'Math.tan(')
        .replace(/log\(/g, 'Math.log10(')
        .replace(/ln\(/g, 'Math.log(')
        .replace(/floor\(/g, 'Math.floor(')
        .replace(/ceil\(/g, 'Math.ceil(')
        .replace(/round\(/g, 'Math.round(')
        .replace(/pow\(/g, 'Math.pow(')
        .replace(/min\(/g, 'Math.min(')
        .replace(/max\(/g, 'Math.max(')
        .replace(/\bpi\b/gi, String(Math.PI))
        .replace(/\be\b/g, String(Math.E));

    // Block dangerous input
    const blocked = /[a-zA-Z_$](?!ath\.)(?![0-9])/;
    const mathFunctions = /Math\.[a-z]+/g;
    const cleaned = sanitized.replace(mathFunctions, '');

    if (blocked.test(cleaned)) {
        throw new Error(
            'Invalid expression — only math operators and functions are allowed'
        );
    }

    // Only allow safe characters
    if (!/^[\d\s+\-*/%.(),Math.a-zA-Z]+$/.test(sanitized)) {
        throw new Error('Invalid characters in expression');
    }

    // Evaluate expression
    const result = Function(
        `"use strict"; return (${sanitized})`
    )();

    if (typeof result !== 'number') {
        throw new Error('Result is not a number');
    }

    if (!isFinite(result)) {
        throw new Error('Result is Infinity or NaN');
    }

    return Number.isInteger(result)
        ? String(result)
        : result.toPrecision(10).replace(/\.?0+$/, '');
}

cmd({
    pattern: "calc",
    name: 'calc',
    category: 'Tools',
    aliases: ['math', 'calculate', 'solve'],
    description: 'Advanced calculator',
    filename: __filename
}, async (sock, m, args) => {

    const expr = args.join(' ').trim();

    // Help / usage
    if (!expr) {
        return await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗖𝗔𝗟𝗖𝗨𝗟𝗔𝗧𝗢𝗥* ◈
┃
┃🧮 *𝗨𝗦𝗔𝗚𝗘*
┃➽ .calc <expression>
┃
┃📌 *𝗘𝗫𝗔𝗠𝗣𝗟𝗘𝗦*
┃➽ .calc 2 ^ 10
┃➽ .calc sqrt(144)
┃➽ .calc sin(pi / 2)
┃➽ .calc log(1000)
┃➽ .calc (3 + 4) * 2
┃➽ .calc pow(2, 8)
┃
┃⚙️ *𝗙𝗨𝗡𝗖𝗧𝗜𝗢𝗡𝗦*
┃➽ sqrt, cbrt, abs
┃➽ sin, cos, tan
┃➽ log, ln
┃➽ floor, ceil, round
┃➽ pow, min, max
┃
┃🔢 *𝗖𝗢𝗡𝗦𝗧𝗔𝗡𝗧𝗦*
┃➽ pi
┃➽ e
┃
┗▣`);
    }

    try {
        const result = safeMath(expr);

        await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗖𝗔𝗟𝗖𝗨𝗟𝗔𝗧𝗢𝗥* ◈
┃
┃📥 *𝗜𝗡𝗣𝗨𝗧*
┃➽ ${expr}
┃
┃📤 *𝗥𝗘𝗦𝗨𝗟𝗧*
┃➽ ${result}
┃
┗▣`);

    } catch (error) {
        await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗖𝗔𝗟𝗖𝗨𝗟𝗔𝗧𝗢𝗥* ◈
┃
┃❌ *𝗘𝗥𝗥𝗢𝗥*
┃➽ ${error.message}
┃
┗▣`);
    }
});
