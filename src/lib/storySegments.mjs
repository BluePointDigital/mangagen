const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const makeFuzzyAnchorPattern = (anchor) => {
    if (!anchor) {
        return null;
    }

    const words = String(anchor)
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (!words.length) {
        return null;
    }

    return words.map((word) => escapeRegExp(word)).join('[^\\w\\s]*\\s+[^\\w\\s]*');
};

const findAnchorRange = (story, anchor, fromIndex = 0) => {
    const pattern = makeFuzzyAnchorPattern(anchor);
    if (!pattern) {
        return null;
    }

    const searchStart = Math.max(0, fromIndex);
    const regex = new RegExp(pattern, 'i');
    const slice = story.slice(searchStart);
    const match = slice.match(regex);

    if (!match || typeof match.index !== 'number') {
        return null;
    }

    const start = searchStart + match.index;
    return {
        end: start + match[0].length,
        start,
    };
};

export const extractVerbatimSegments = (story, pages = []) => {
    if (!story || !Array.isArray(pages) || !pages.length) {
        return [];
    }

    const results = [];
    let currentSearchPos = 0;

    pages.forEach((page, index) => {
        try {
            const startMatch = findAnchorRange(story, page?.startAnchor, currentSearchPos);
            const startIdx = startMatch?.start ?? currentSearchPos;
            const nextStartMatch = findAnchorRange(story, pages[index + 1]?.startAnchor, startIdx);
            const endMatch = findAnchorRange(story, page?.endAnchor, startIdx);

            let endIdx = endMatch?.end ?? null;
            if (nextStartMatch && (endIdx == null || endIdx > nextStartMatch.start)) {
                endIdx = nextStartMatch.start;
            }
            if (endIdx == null && index === pages.length - 1) {
                endIdx = story.length;
            }

            const text = story.slice(startIdx, endIdx ?? startIdx).trim();
            results.push(text || null);

            if (endIdx != null) {
                currentSearchPos = Math.max(currentSearchPos, endIdx);
            } else if (startMatch?.end != null) {
                currentSearchPos = Math.max(currentSearchPos, startMatch.end);
            }
        } catch (error) {
            results.push(null);
        }
    });

    return results;
};