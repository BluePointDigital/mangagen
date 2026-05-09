const path = require('path');
const {
    EXTENSION_BY_MIME,
    GLOBAL_BUCKETS,
    PROJECT_BUCKETS,
    PROJECT_ID_PATTERN,
} = require('../constants');
const { AppError } = require('../errors');

const slugifyProjectName = (name) => {
    const normalized = String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    if (!normalized) {
        throw new AppError(400, 'Project name is required');
    }

    return normalized;
};

const assertValidProjectId = (projectId) => {
    if (!PROJECT_ID_PATTERN.test(String(projectId || ''))) {
        throw new AppError(400, 'Invalid project id');
    }

    return String(projectId);
};

const assertProjectBucket = (bucket) => {
    if (!PROJECT_BUCKETS.includes(bucket)) {
        throw new AppError(400, 'Invalid asset bucket');
    }

    return bucket;
};

const assertGlobalBucket = (bucket) => {
    if (!GLOBAL_BUCKETS.includes(bucket)) {
        throw new AppError(400, 'Invalid global asset bucket');
    }

    return bucket;
};

const assertSafeFilename = (filename) => {
    const normalized = String(filename || '').trim();
    if (!normalized) {
        throw new AppError(400, 'Filename is required');
    }

    const basename = path.basename(normalized);
    if (basename !== normalized || normalized.includes('/') || normalized.includes('\\')) {
        throw new AppError(400, 'Invalid filename');
    }

    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(basename)) {
        throw new AppError(400, 'Invalid filename');
    }

    return basename;
};

const parseDataUrl = (imageData) => {
    const match = String(imageData || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
        throw new AppError(400, 'Invalid image data');
    }

    return {
        base64Data: match[2],
        mimeType: match[1],
    };
};

const getExtensionForMimeType = (mimeType) => EXTENSION_BY_MIME[mimeType] || '.png';

const ensureFilenameExtension = (filename, extension) => {
    const safeFilename = assertSafeFilename(filename);
    if (path.extname(safeFilename)) {
        return safeFilename;
    }
    return `${safeFilename}${extension}`;
};

const assertNonNegativePageIndex = (pageIndex) => {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
        throw new AppError(400, 'pageIndex must be a non-negative integer');
    }

    return pageIndex;
};

module.exports = {
    assertGlobalBucket,
    assertNonNegativePageIndex,
    assertProjectBucket,
    assertSafeFilename,
    assertValidProjectId,
    ensureFilenameExtension,
    getExtensionForMimeType,
    parseDataUrl,
    slugifyProjectName,
};
