const fs = require('fs/promises');
const path = require('path');

const ensureDir = async (dirPath) => {
    await fs.mkdir(dirPath, { recursive: true });
};

const pathExists = async (targetPath) => {
    try {
        await fs.access(targetPath);
        return true;
    } catch (error) {
        return false;
    }
};

const readJson = async (filePath, fallbackValue = null) => {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return fallbackValue;
        }
        throw error;
    }
};

const writeJson = async (filePath, data) => {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
};

const listDirectories = async (dirPath) => {
    if (!(await pathExists(dirPath))) {
        return [];
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
};

const listFiles = async (dirPath) => {
    if (!(await pathExists(dirPath))) {
        return [];
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
};

module.exports = {
    ensureDir,
    fs,
    listDirectories,
    listFiles,
    pathExists,
    readJson,
    writeJson,
};
