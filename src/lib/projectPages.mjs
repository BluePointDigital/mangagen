export const mergePageAtIndex = (pages, pageIndex, pagePatch) => (
    (pages || []).map((page, index) => (
        index === pageIndex
            ? {
                ...page,
                ...pagePatch,
            }
            : page
    ))
);

export const updatePageGeneratedAsset = (pages, pageIndex, generatedAsset) => (
    mergePageAtIndex(pages, pageIndex, { generatedAsset })
);

export const clearInlineGeneratedResults = (pages) => (
    (pages || []).map((page) => {
        const nextPage = { ...page };
        delete nextPage.generatedResult;
        return nextPage;
    })
);

export const getPageGenerationSettings = (page, fallbackSettings = {}) => {
    const { engine, ...settings } = {
        ...fallbackSettings,
        ...(page?.generationSettings || {}),
    };
    return settings;
};

export const getPersistedOrTransientResult = (page, transientEntry) => {
    if (transientEntry?.success && transientEntry.result) {
        return transientEntry.result;
    }

    return page?.generatedAsset || null;
};
