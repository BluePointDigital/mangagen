const stripDataUrlPrefix = (dataUrl) => String(dataUrl || '').replace(/^data:[^;]+;base64,/, '');

export const isInlineImageResult = (value) => (
    value?.type === 'image'
    && typeof value?.data === 'string'
    && typeof value?.mimeType === 'string'
);

export const isPersistedAsset = (value) => (
    value
    && typeof value === 'object'
    && typeof value.url === 'string'
    && typeof value.filename === 'string'
    && typeof value.bucket === 'string'
);

export const getDisplayImageSrc = (value) => {
    if (isInlineImageResult(value)) {
        return `data:${value.mimeType};base64,${value.data}`;
    }

    if (isPersistedAsset(value)) {
        return value.url;
    }

    if (typeof value === 'string' && value.startsWith('data:')) {
        return value;
    }

    return null;
};

export const dataUrlToInlineImage = (dataUrl) => {
    const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
        return null;
    }

    return {
        type: 'image',
        data: match[2],
        mimeType: match[1],
    };
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(blob);
});

export const fetchAssetAsDataUrl = async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load asset: ${response.status}`);
    }

    const blob = await response.blob();
    return blobToDataUrl(blob);
};

export const fetchAssetAsReference = async (item) => ({
    data: await fetchAssetAsDataUrl(item.url),
    name: item.name,
});

export const fetchAssetsAsReferences = async (items) => Promise.all(
    (items || [])
        .filter((item) => item?.type === 'image' && item?.url)
        .map((item) => fetchAssetAsReference(item))
);

export const toInlineImageDataUrl = async (imageSource) => {
    if (!imageSource) {
        throw new Error('No image source provided');
    }

    if (typeof imageSource === 'string') {
        if (imageSource.startsWith('data:')) {
            return imageSource;
        }
        return fetchAssetAsDataUrl(imageSource);
    }

    if (isInlineImageResult(imageSource)) {
        return `data:${imageSource.mimeType};base64,${imageSource.data}`;
    }

    if (isPersistedAsset(imageSource)) {
        return fetchAssetAsDataUrl(imageSource.url);
    }

    throw new Error('Unsupported image source');
};

export const inlineImageToSavePayload = async (imageSource) => {
    const dataUrl = await toInlineImageDataUrl(imageSource);
    return {
        dataUrl,
        inlineImage: dataUrlToInlineImage(dataUrl),
        mimeType: dataUrl.match(/^data:([^;]+);base64,/)?.[1] || 'image/png',
        base64Data: stripDataUrlPrefix(dataUrl),
    };
};
