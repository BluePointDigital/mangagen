export const stripMarkdownCodeFence = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed.startsWith('```')) {
        return trimmed;
    }

    return trimmed
        .replace(/^```(?:json)?\s*\n?/, '')
        .replace(/\n?```\s*$/, '')
        .trim();
};

export const parseStoryboardResult = (resultData) => {
    if (!resultData) {
        return null;
    }

    if (typeof resultData === 'object') {
        return resultData;
    }

    if (typeof resultData !== 'string') {
        return null;
    }

    try {
        return JSON.parse(stripMarkdownCodeFence(resultData));
    } catch (error) {
        return null;
    }
};
