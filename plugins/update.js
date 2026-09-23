const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const { cmd } = require('../arslan');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GITHUB CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const repoOwner = 'popkidultra';
const repoName = 'POPKID-BOT';
const branch = 'main';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const COMMIT_FILE = path.join(PROJECT_ROOT, '.last_update_commit');

// Files/folders that must NEVER be replaced or deleted by an update.
const PROTECTED_PATHS = [
    'config.js',
    '.env',
    'session',
    'sessions',
    'auth_info',
    'database',
    'db',
    'data',
    'node_modules',
    'package-lock.json',
    '.last_update_commit',
    '.git',
    'tmp',
    'temp',
    'logs',
    'media'
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function isProtected(relPath) {
    const normalized = relPath.split(path.sep).join('/');

    return PROTECTED_PATHS.some(item =>
        normalized === item ||
        normalized.startsWith(item + '/')
    );
}

function getLocalCommit() {
    try {
        return fs.readFileSync(COMMIT_FILE, 'utf8').trim() || null;
    } catch {
        return null;
    }
}

function saveLocalCommit(sha) {
    fs.writeFileSync(COMMIT_FILE, sha, 'utf8');
}

function fileHash(filePath) {
    if (!fs.existsSync(filePath)) return null;

    return crypto
        .createHash('sha1')
        .update(fs.readFileSync(filePath))
        .digest('hex');
}

function isUpdateLocked() {
    return global.__popkidUpdateInProgress === true;
}

function setUpdateLock(value) {
    global.__popkidUpdateInProgress = value;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GITHUB
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getLatestCommit() {
    const url =
        `https://api.github.com/repos/${repoOwner}/${repoName}/commits/${branch}`;

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'POPKID-MD-Updater',
            'Accept': 'application/vnd.github+json'
        }
    });

    if (!response.ok) {
        throw new Error(`GitHub returned HTTP ${response.status}`);
    }

    const data = await response.json();

    return {
        sha: data.sha,
        message: (data.commit?.message || 'No commit message')
            .split('\n')[0],
        date:
            data.commit?.committer?.date ||
            data.commit?.author?.date ||
            null
    };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DOWNLOAD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function downloadUpdate(zipPath) {
    const url =
        `https://github.com/${repoOwner}/${repoName}/archive/refs/heads/${branch}.zip`;

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'POPKID-MD-Updater'
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to download update: HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (!buffer.length) {
        throw new Error('GitHub returned an empty update package.');
    }

    fs.writeFileSync(zipPath, buffer);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXTRACT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function extractUpdate(zipPath, destination) {
    let AdmZip;

    try {
        AdmZip = require('adm-zip');
    } catch {
        throw new Error(
            'Missing dependency "adm-zip". Install it with: npm install adm-zip'
        );
    }

    const zip = new AdmZip(zipPath);

    zip.extractAllTo(destination, true);

    const entries = fs.readdirSync(destination, {
        withFileTypes: true
    });

    const directories = entries.filter(entry => entry.isDirectory());

    if (directories.length !== 1) {
        throw new Error('Invalid GitHub update archive structure.');
    }

    return path.join(destination, directories[0].name);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VALIDATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function validateUpdate(sourceRoot) {
    const requiredFiles = [
        'index.js',
        'package.json'
    ];

    for (const file of requiredFiles) {
        const fullPath = path.join(sourceRoot, file);

        if (!fs.existsSync(fullPath)) {
            throw new Error(
                `Update validation failed: "${file}" is missing.`
            );
        }
    }

    const packageJsonPath = path.join(sourceRoot, 'package.json');

    try {
        JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch {
        throw new Error('Update contains an invalid package.json.');
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SAFE FILE SYNC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function syncDirectory(source, destination, relative = '') {

    fs.mkdirSync(destination, {
        recursive: true
    });

    const sourceEntries = fs.existsSync(source)
        ? fs.readdirSync(source, { withFileTypes: true })
        : [];

    const destinationEntries = fs.existsSync(destination)
        ? fs.readdirSync(destination, { withFileTypes: true })
        : [];

    // Remove files deleted from GitHub.
    for (const entry of destinationEntries) {

        const relativePath = path.join(relative, entry.name);

        if (isProtected(relativePath)) {
            continue;
        }

        const existsUpstream = sourceEntries.some(
            item => item.name === entry.name
        );

        if (!existsUpstream) {
            fs.rmSync(
                path.join(destination, entry.name),
                {
                    recursive: true,
                    force: true
                }
            );
        }
    }

    // Copy/update files from GitHub.
    for (const entry of sourceEntries) {

        const relativePath = path.join(relative, entry.name);

        if (isProtected(relativePath)) {
            continue;
        }

        const sourcePath = path.join(source, entry.name);
        const destinationPath = path.join(destination, entry.name);

        if (entry.isDirectory()) {

            syncDirectory(
                sourcePath,
                destinationPath,
                relativePath
            );

        } else {

            fs.mkdirSync(
                path.dirname(destinationPath),
                {
                    recursive: true
                }
            );

            fs.copyFileSync(
                sourcePath,
                destinationPath
            );
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESTART
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function restartBot() {
    return new Promise(resolve => {

        const exit = () => {

            console.log(
                '[UPDATE] Exiting for panel restart...'
            );

            setTimeout(() => {
                process.exit(0);
            }, 1000);

            resolve();
        };

        try {

            const server = global.__popkidServer;

            if (server && server.listening) {

                server.close(() => {
                    exit();
                });

                setTimeout(exit, 5000);

            } else {

                exit();

            }

        } catch (error) {

            console.error(
                '[UPDATE] Restart error:',
                error.message
            );

            exit();
        }
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UPDATE COMMAND
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

cmd({
    pattern: 'update',
    name: 'update',
    category: 'Owner',
    aliases: ['upgrade', 'patch'],
    description: 'Update the bot from GitHub',
    filename: __filename
}, async (sock, m) => {

    // ── OWNER CHECK ─────────────────────────────────────────────────────

    if (!m.isOwner && !m.isDev) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗨𝗣𝗗𝗔𝗧𝗘* ◈
┃
┃❌ *𝗔𝗖𝗖𝗘𝗦𝗦 𝗗𝗘𝗡𝗜𝗘𝗗*
┃➽ Owner only command.
┃
┗▣`);
    }

    // ── LOCK ─────────────────────────────────────────────────────────────

    if (isUpdateLocked()) {
        return m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗨𝗣𝗗𝗔𝗧𝗘* ◈
┃
┃⏳ *𝗨𝗣𝗗𝗔𝗧𝗘 𝗜𝗡 𝗣𝗥𝗢𝗚𝗥𝗘𝗦𝗦*
┃➽ Please wait for it to finish.
┃
┗▣`);
    }

    setUpdateLock(true);

    let loadingMessage;

    try {

        loadingMessage = await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗨𝗣𝗗𝗔𝗧𝗘* ◈
┃
┃🔎 *𝗖𝗛𝗘𝗖𝗞𝗜𝗡𝗚 𝗙𝗢𝗥 𝗨𝗣𝗗𝗔𝗧𝗘𝗦...*
┃➽ Please wait.
┃
┗▣`);

        const updateMessage = async text => {

            try {

                await sock.sendMessage(
                    m.from,
                    {
                        text,
                        edit: loadingMessage.key
                    }
                );

            } catch {

                await m.reply(text);

            }
        };

        // ── CHECK GITHUB ────────────────────────────────────────────────

        const latest = await getLatestCommit();
        const localCommit = getLocalCommit();

        if (localCommit && localCommit === latest.sha) {

            setUpdateLock(false);

            return updateMessage(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗨𝗣𝗗𝗔𝗧𝗘* ◈
┃
┃✅ *𝗬𝗢𝗨'𝗥𝗘 𝗨𝗣 𝗧𝗢 𝗗𝗔𝗧𝗘*
┃
┃➽ No new update is available.
┃
┃🔖 *𝗩𝗘𝗥𝗦𝗜𝗢𝗡* : ${latest.sha.slice(0, 7)}
┃
┗▣`);
        }

        const date = latest.date
            ? new Date(latest.date).toLocaleString()
            : 'Unknown';

        await updateMessage(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗨𝗣𝗗𝗔𝗧𝗘* ◈
┃
┃🚀 *𝗨𝗣𝗗𝗔𝗧𝗘 𝗙𝗢𝗨𝗡𝗗*
┃
┃📝 *𝗖𝗛𝗔𝗡𝗚𝗘𝗦*
┃➽ ${latest.message}
┃
┃📅 *𝗗𝗔𝗧𝗘* : ${date}
┃🔖 *𝗖𝗢𝗠𝗠𝗜𝗧* : ${latest.sha.slice(0, 7)}
┃
┃📥 *𝗣𝗥𝗘𝗣𝗔𝗥𝗜𝗡𝗚 𝗨𝗣𝗗𝗔𝗧𝗘...*
┃
┗▣`);

        // ── TEMP DIRECTORY ──────────────────────────────────────────────

        const tempDir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'popkid-update-')
        );

        try {

            const zipPath = path.join(
                tempDir,
                'update.zip'
            );

            const extractPath = path.join(
                tempDir,
                'extracted'
            );

            fs.mkdirSync(extractPath, {
                recursive: true
            });

            // ── DOWNLOAD ────────────────────────────────────────────────

            await updateMessage(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗨𝗣𝗗𝗔𝗧𝗘* ◈
┃
┃📥 *𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗜𝗡𝗚...*
┃➽ Getting latest files from GitHub.
┃
┗▣`);

            await downloadUpdate(zipPath);

            // ── EXTRACT ─────────────────────────────────────────────────

            await updateMessage(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗨𝗣𝗗𝗔𝗧𝗘* ◈
┃
┃📦 *𝗘𝗫𝗧𝗥𝗔𝗖𝗧𝗜𝗡𝗚 𝗙𝗜𝗟𝗘𝗦...*
┃➽ Preparing the new version.
┃
┗▣`);

            const sourceRoot = extractUpdate(
                zipPath,
                extractPath
            );

            // ── VALIDATE ────────────────────────────────────────────────

            await updateMessage(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗨𝗣𝗗𝗔𝗧𝗘* ◈
┃
┃🔍 *𝗩𝗔𝗟𝗜𝗗𝗔𝗧𝗜𝗡𝗚 𝗨𝗣𝗗𝗔𝗧𝗘...*
┃➽ Checking package and project files.
┃
┗▣`);

            validateUpdate(sourceRoot);

            // ── PACKAGE CHECK ───────────────────────────────────────────

            const oldPackage = fileHash(
                path.join(PROJECT_ROOT, 'package.json')
            );

            const newPackage = fileHash(
                path.join(sourceRoot, 'package.json')
            );

            const dependenciesChanged =
                oldPackage !== newPackage;

            // ── APPLY ───────────────────────────────────────────────────

            await updateMessage(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗨𝗣𝗗𝗔𝗧𝗘* ◈
┃
┃📂 *𝗜𝗡𝗦𝗧𝗔𝗟𝗟𝗜𝗡𝗚 𝗙𝗜𝗟𝗘𝗦...*
┃➽ Updating bot files.
┃
┃🛡️ Protected files remain untouched.
┃
┗▣`);

            syncDirectory(
                sourceRoot,
                PROJECT_ROOT
            );

            // ── DEPENDENCIES ────────────────────────────────────────────

            if (dependenciesChanged) {

                await updateMessage(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗨𝗣𝗗𝗔𝗧𝗘* ◈
┃
┃📦 *𝗨𝗣𝗗𝗔𝗧𝗜𝗡𝗚 𝗗𝗘𝗣𝗘𝗡𝗗𝗘𝗡𝗖𝗜𝗘𝗦...*
┃➽ Please wait.
┃
┗▣`);

                try {

                    execSync(
                        'npm install --omit=dev --no-audit --no-fund',
                        {
                            cwd: PROJECT_ROOT,
                            stdio: 'pipe',
                            timeout: 180000
                        }
                    );

                } catch (error) {

                    throw new Error(
                        `Dependency installation failed: ${error.message}`
                    );
                }

            }

            // ── SAVE COMMIT ─────────────────────────────────────────────

            saveLocalCommit(latest.sha);

        } finally {

            try {
                fs.rmSync(
                    tempDir,
                    {
                        recursive: true,
                        force: true
                    }
                );
            } catch {}
        }

        // ── SUCCESS ─────────────────────────────────────────────────────

        await updateMessage(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗨𝗣𝗗𝗔𝗧𝗘* ◈
┃
┃✅ *𝗨𝗣𝗗𝗔𝗧𝗘 𝗖𝗢𝗠𝗣𝗟𝗘𝗧𝗘*
┃
┃🔖 *𝗩𝗘𝗥𝗦𝗜𝗢𝗡* : ${latest.sha.slice(0, 7)}
┃
┃🛡️ *𝗣𝗥𝗢𝗧𝗘𝗖𝗧𝗘𝗗 𝗗𝗔𝗧𝗔*
┃➽ Sessions and configuration preserved.
┃
┃🔄 *𝗥𝗘𝗦𝗧𝗔𝗥𝗧𝗜𝗡𝗚...*
┃➽ The panel will start the updated bot.
┃
┗▣`);

        setUpdateLock(false);

        await restartBot();

    } catch (error) {

        console.error(
            '[POPKID UPDATE ERROR]',
            error
        );

        setUpdateLock(false);

        const errorMessage =
            error?.message || 'Unknown update error';

        try {

            if (loadingMessage) {

                await sock.sendMessage(
                    m.from,
                    {
                        text: `┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗨𝗣𝗗𝗔𝗧𝗘* ◈
┃
┃❌ *𝗨𝗣𝗗𝗔𝗧𝗘 𝗙𝗔𝗜𝗟𝗘𝗗*
┃
┃➽ ${errorMessage}
┃
┃🛡️ *𝗡𝗢 𝗥𝗘𝗦𝗧𝗔𝗥𝗧 𝗪𝗔𝗦 𝗧𝗥𝗜𝗚𝗚𝗘𝗥𝗘𝗗.*
┃
┗▣`,
                        edit: loadingMessage.key
                    }
                );

            } else {

                await m.reply(`┏▣ ◈ *𝗣𝗢𝗣𝗞𝗜𝗗 𝗨𝗣𝗗𝗔𝗧𝗘* ◈
┃
┃❌ *𝗨𝗣𝗗𝗔𝗧𝗘 𝗙𝗔𝗜𝗟𝗘𝗗*
┃
┃➽ ${errorMessage}
┃
┗▣`);

            }

        } catch (sendError) {

            console.error(
                '[POPKID UPDATE MESSAGE ERROR]',
                sendError.message
            );
        }
    }
});
