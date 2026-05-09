const path = require('path');
const { LIBRARY_EXTENSIONS, MIME_TYPE_BY_EXTENSION, PROJECT_BUCKETS } = require('../constants');
const { AppError } = require('../errors');
const { ensureDir, fs, listFiles } = require('./storage');
const {
    assertGlobalBucket,
    assertNonNegativePageIndex,
    assertProjectBucket,
    assertSafeFilename,
    assertValidProjectId,
    ensureFilenameExtension,
    getExtensionForMimeType,
    parseDataUrl,
} = require('./validation');

const createAssetStore = ({ rootDir }) => {
    const projectsDir = path.join(rootDir, 'projects');
    const globalBucketDirs = {
        characters: path.join(rootDir, 'characters'),
        locations: path.join(rootDir, 'locations'),
        style: path.join(rootDir, 'style'),
    };

    const ensureBaseDirs = async () => {
        await Promise.all([ensureDir(projectsDir), ...Object.values(globalBucketDirs).map(ensureDir)]);
    };

    const getProjectPath = (projectId) => path.join(projectsDir, assertValidProjectId(projectId));

    const getProjectBucketDir = (projectId, bucket) => {
        assertValidProjectId(projectId);
        assertProjectBucket(bucket);
        return path.join(getProjectPath(projectId), bucket);
    };

    const getGlobalBucketDir = (bucket) => {
        assertGlobalBucket(bucket);
        return globalBucketDirs[bucket];
    };

    const getBucketDir = (projectId, bucket) => (
        projectId ? getProjectBucketDir(projectId, bucket) : getGlobalBucketDir(bucket)
    );

    const getAssetUrl = ({ projectId, bucket, filename }) => (
        projectId
            ? `/projects/${projectId}/${bucket}/${filename}`
            : `/library/${bucket}/${filename}`
    );

    const buildAssetRecord = ({ bucket, filename, mimeType, projectId, updatedAt }) => ({
        bucket,
        filename,
        mimeType,
        updatedAt,
        url: getAssetUrl({ bucket, filename, projectId }),
    });

    const ensureProjectDirs = async (projectId) => {
        await Promise.all(PROJECT_BUCKETS.map((bucket) => ensureDir(getProjectBucketDir(projectId, bucket))));
    };

    const readAssetMetadata = async (dirPath, filename) => {
        const metadataPath = path.join(dirPath, `${path.parse(filename).name}.json`);
        try {
            return JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {};
            }
            throw error;
        }
    };

    const listBucket = async (projectId, bucket) => {
        const dirPath = getBucketDir(projectId, bucket);
        const filenames = await listFiles(dirPath);
        const filtered = filenames.filter((filename) => LIBRARY_EXTENSIONS.has(path.extname(filename).toLowerCase()));

        const items = await Promise.all(filtered.map(async (filename) => {
            const ext = path.extname(filename).toLowerCase();
            const stats = await fs.stat(path.join(dirPath, filename));
            const metadata = ext === '.json' ? {} : await readAssetMetadata(dirPath, filename);
            return {
                bucket,
                displayName: metadata.displayName || path.parse(filename).name,
                mimeType: MIME_TYPE_BY_EXTENSION[ext] || null,
                mtime: stats.mtime.toISOString(),
                metadata,
                name: filename,
                notes: metadata.notes || '',
                role: metadata.role || '',
                type: ext === '.json' ? 'metadata' : 'image',
                updatedAt: stats.mtime.toISOString(),
                usage: metadata.usage || '',
                url: getAssetUrl({ bucket, filename, projectId }),
            };
        }));

        return items.sort((left, right) => left.name.localeCompare(right.name));
    };

    const listLibrary = async (projectId = null) => {
        await ensureBaseDirs();

        if (!projectId) {
            return {
                characters: await listBucket(null, 'characters'),
                locations: await listBucket(null, 'locations'),
                style: await listBucket(null, 'style'),
            };
        }

        assertValidProjectId(projectId);

        return {
            characters: await listBucket(projectId, 'characters'),
            locations: await listBucket(projectId, 'locations'),
            pages: await listBucket(projectId, 'pages'),
            style: await listBucket(projectId, 'style'),
        };
    };

    const removeFilesWithStem = async (dirPath, stem) => {
        const filenames = await listFiles(dirPath);
        await Promise.all(
            filenames
                .filter((filename) => path.parse(filename).name === stem)
                .map((filename) => fs.unlink(path.join(dirPath, filename)))
        );
    };

    const saveAssetMetadata = async (dirPath, targetFilename, metadata) => {
        if (!metadata || typeof metadata !== 'object') {
            return;
        }

        const metadataPath = path.join(dirPath, `${path.parse(targetFilename).name}.json`);
        await fs.writeFile(metadataPath, JSON.stringify({
            displayName: typeof metadata.displayName === 'string' ? metadata.displayName.trim() : '',
            notes: typeof metadata.notes === 'string' ? metadata.notes.trim() : '',
            role: typeof metadata.role === 'string' ? metadata.role.trim() : '',
            usage: typeof metadata.usage === 'string' ? metadata.usage.trim() : '',
            updatedAt: new Date().toISOString(),
        }, null, 2));
    };

    const saveAsset = async ({ bucket, filename, imageData, metadata, pageIndex, projectId }) => {
        await ensureBaseDirs();
        const targetProjectId = assertValidProjectId(projectId);
        const targetBucket = assertProjectBucket(bucket);

        if (!imageData) {
            throw new AppError(400, 'imageData is required');
        }

        const { base64Data, mimeType } = parseDataUrl(imageData);
        const extension = getExtensionForMimeType(mimeType);
        const dirPath = getProjectBucketDir(targetProjectId, targetBucket);
        await ensureDir(dirPath);

        let targetFilename;
        if (targetBucket === 'pages' && pageIndex !== undefined && pageIndex !== null) {
            const safePageIndex = assertNonNegativePageIndex(pageIndex);
            const stem = `page-${String(safePageIndex + 1).padStart(3, '0')}`;
            await removeFilesWithStem(dirPath, stem);
            targetFilename = `${stem}${extension}`;
        } else if (filename) {
            targetFilename = ensureFilenameExtension(filename, extension);
            if (targetBucket === 'pages') {
                await removeFilesWithStem(dirPath, path.parse(targetFilename).name);
            }
        } else {
            targetFilename = `${targetBucket}-${Date.now()}${extension}`;
        }

        assertSafeFilename(targetFilename);

        const filePath = path.join(dirPath, targetFilename);
        await fs.writeFile(filePath, base64Data, 'base64');
        await saveAssetMetadata(dirPath, targetFilename, metadata);
        const stats = await fs.stat(filePath);

        return buildAssetRecord({
            bucket: targetBucket,
            filename: targetFilename,
            mimeType,
            projectId: targetProjectId,
            updatedAt: stats.mtime.toISOString(),
        });
    };

    return {
        buildAssetRecord,
        ensureBaseDirs,
        ensureProjectDirs,
        getGlobalBucketDir,
        getProjectBucketDir,
        listLibrary,
        saveAsset,
    };
};

module.exports = {
    createAssetStore,
};
