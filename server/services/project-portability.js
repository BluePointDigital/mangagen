const path = require('path');
const AdmZip = require('adm-zip');
const { SCHEMA_VERSION } = require('../constants');
const { AppError } = require('../errors');
const { ensureDir, fs, pathExists } = require('./storage');
const { assertValidProjectId } = require('./validation');

const EXPORT_MANIFEST = 'mangagen-export.json';

const isSafeZipPath = (entryName) => {
    const normalized = String(entryName || '').replace(/\\/g, '/');
    const allowedRoot = normalized === EXPORT_MANIFEST
        || normalized === 'project.json'
        || normalized === 'generation-history.json'
        || ['characters/', 'locations/', 'pages/', 'style/'].some((prefix) => normalized.startsWith(prefix));
    return allowedRoot
        && normalized
        && !normalized.startsWith('/')
        && !normalized.includes('../')
        && !normalized.includes('..\\')
        && normalized !== '..';
};

const addDirToZip = async (zip, sourceDir, zipRoot = '') => {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
        const sourcePath = path.join(sourceDir, entry.name);
        const zipPath = zipRoot ? `${zipRoot}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            await addDirToZip(zip, sourcePath, zipPath);
        } else if (entry.isFile()) {
            zip.addLocalFile(sourcePath, path.dirname(zipPath) === '.' ? '' : path.dirname(zipPath));
        }
    }
};

const createUniqueProjectId = async (projectsDir, projectId) => {
    if (!(await pathExists(path.join(projectsDir, projectId)))) return projectId;
    for (let index = 2; index < 1000; index += 1) {
        const candidate = `${projectId}-imported-${index}`;
        if (!(await pathExists(path.join(projectsDir, candidate)))) return candidate;
    }
    throw new AppError(400, 'Could not create a unique imported project id');
};

const createProjectPortability = ({ projectStore, rootDir }) => {
    const projectsDir = path.join(rootDir, 'projects');

    const exportProject = async (projectId) => {
        const safeProjectId = assertValidProjectId(projectId);
        const project = await projectStore.getProject(safeProjectId);
        const projectDir = path.join(projectsDir, safeProjectId);
        const zip = new AdmZip();
        zip.addFile(EXPORT_MANIFEST, Buffer.from(JSON.stringify({
            exportedAt: new Date().toISOString(),
            projectId: safeProjectId,
            projectName: project.name,
            schemaVersion: SCHEMA_VERSION,
            type: 'mangagen-project',
            version: 1,
        }, null, 2)));
        await addDirToZip(zip, projectDir);
        return zip.toBuffer();
    };

    const importProject = async (buffer) => {
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
            throw new AppError(400, 'Project zip is required');
        }

        let zip;
        try {
            zip = new AdmZip(buffer);
        } catch {
            throw new AppError(400, 'Invalid project zip');
        }

        const entries = zip.getEntries();
        if (!entries.length || entries.some((entry) => !isSafeZipPath(entry.entryName))) {
            throw new AppError(400, 'Project zip contains unsafe paths');
        }

        const manifestEntry = zip.getEntry(EXPORT_MANIFEST);
        const projectEntry = zip.getEntry('project.json');
        if (!manifestEntry || !projectEntry) {
            throw new AppError(400, 'Project export manifest or project.json is missing');
        }

        const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
        const project = JSON.parse(projectEntry.getData().toString('utf8'));
        if (manifest.type !== 'mangagen-project' || project.schemaVersion !== SCHEMA_VERSION) {
            throw new AppError(400, 'Unsupported project export');
        }

        const importedProjectId = await createUniqueProjectId(projectsDir, assertValidProjectId(project.id || manifest.projectId));
        const projectDir = path.join(projectsDir, importedProjectId);
        await ensureDir(projectDir);

        for (const entry of entries) {
            if (entry.isDirectory || entry.entryName === EXPORT_MANIFEST) continue;
            const targetPath = path.join(projectDir, entry.entryName);
            const resolvedPath = path.resolve(targetPath);
            if (!resolvedPath.startsWith(path.resolve(projectDir))) {
                throw new AppError(400, 'Project zip contains unsafe paths');
            }
            await ensureDir(path.dirname(resolvedPath));
            await fs.writeFile(resolvedPath, entry.getData());
        }

        const importedProjectPath = path.join(projectDir, 'project.json');
        const importedProject = {
            ...project,
            id: importedProjectId,
            name: importedProjectId === project.id ? project.name : `${project.name || project.id} Imported`,
        };
        await fs.writeFile(importedProjectPath, JSON.stringify(importedProject, null, 2));
        return projectStore.getProject(importedProjectId);
    };

    return {
        exportProject,
        importProject,
    };
};

module.exports = {
    EXPORT_MANIFEST,
    createProjectPortability,
    isSafeZipPath,
};
