const SCHEMA_VERSION = 2;

const GLOBAL_BUCKETS = ['characters', 'locations', 'style'];
const PROJECT_BUCKETS = [...GLOBAL_BUCKETS, 'pages'];

const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const LIBRARY_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, '.json']);

const MIME_TYPE_BY_EXTENSION = {
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.json': 'application/json',
    '.png': 'image/png',
    '.webp': 'image/webp',
};

const EXTENSION_BY_MIME = {
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
};

module.exports = {
    EXTENSION_BY_MIME,
    GLOBAL_BUCKETS,
    IMAGE_EXTENSIONS,
    LIBRARY_EXTENSIONS,
    MIME_TYPE_BY_EXTENSION,
    PROJECT_BUCKETS,
    PROJECT_ID_PATTERN,
    SCHEMA_VERSION,
};
