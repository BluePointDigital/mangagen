import { STORYBOOK_TEXT_SOURCE } from './storybookAssembly.mjs';

export const BOOKLET_SUPPORTED_LAYOUTS = Object.freeze(['side-left', 'side-right']);

const EMPTY_TEXT_HTML = '<p></p>';

export const normalizeBookletCover = (cover) => ({
    ...(cover || {}),
    image: {
        fit: cover?.image?.fit || 'cover',
        posX: typeof cover?.image?.posX === 'number' ? cover.image.posX : 50,
        posY: typeof cover?.image?.posY === 'number' ? cover.image.posY : 50,
        zoom: typeof cover?.image?.zoom === 'number' ? cover.image.zoom : 1,
    },
    text: {
        html: cover?.text?.html || EMPTY_TEXT_HTML,
        source: STORYBOOK_TEXT_SOURCE.manual,
    },
    textStyle: {
        fontFamily: cover?.textStyle?.fontFamily || 'Plus Jakarta Sans',
        fontSizePx: typeof cover?.textStyle?.fontSizePx === 'number' ? cover.textStyle.fontSizePx : 28,
        lineHeight: typeof cover?.textStyle?.lineHeight === 'number' ? cover.textStyle.lineHeight : 1.3,
        letterSpacingPx:
            typeof cover?.textStyle?.letterSpacingPx === 'number' ? cover.textStyle.letterSpacingPx : 0,
    },
    overlay: {
        paddingPx: typeof cover?.overlay?.paddingPx === 'number' ? cover.overlay.paddingPx : 40,
        textOpacity: typeof cover?.overlay?.textOpacity === 'number' ? cover.overlay.textOpacity : 0.6,
        textColor: cover?.overlay?.textColor || '#ffffff',
        bgColor: cover?.overlay?.bgColor || '#000000',
    },
});

export const normalizeStorybookBooklet = (booklet) => ({
    covers: {
        front: normalizeBookletCover(booklet?.covers?.front),
        back: normalizeBookletCover(booklet?.covers?.back),
    },
});

export const getBookletUnsupportedPages = (pages = []) => (
    (pages || [])
        .map((page, index) => ({
            index,
            layout: page?.storybookAssembly?.layout || null,
            pageNumber: page?.pageNumber || index + 1,
        }))
        .filter((page) => !BOOKLET_SUPPORTED_LAYOUTS.includes(page.layout))
);

export const analyzeBookletExport = ({ pages = [] } = {}) => {
    const unsupportedPages = getBookletUnsupportedPages(pages);
    const interiorLeafCount = (pages || []).length * 2;
    const baseLeafCount = interiorLeafCount + 2;
    const paddingCount = (4 - (baseLeafCount % 4)) % 4;
    const totalLeafCount = baseLeafCount + paddingCount;

    return {
        interiorLeafCount,
        isSupported: unsupportedPages.length === 0,
        paddingCount,
        sheetCount: totalLeafCount / 4,
        totalLeafCount,
        unsupportedPages,
    };
};

export const buildInteriorBookletLeaves = (pages = []) => (
    (pages || []).flatMap((page, index) => [
        {
            kind: 'story',
            label: `Page ${page?.pageNumber || index + 1} Left`,
            pageIndex: index,
            pageNumber: page?.pageNumber || index + 1,
            position: 'left',
        },
        {
            kind: 'story',
            label: `Page ${page?.pageNumber || index + 1} Right`,
            pageIndex: index,
            pageNumber: page?.pageNumber || index + 1,
            position: 'right',
        },
    ])
);

export const buildBookletLeaves = ({ booklet, pages = [] } = {}) => {
    const analysis = analyzeBookletExport({ pages });
    if (!analysis.isSupported) {
        const error = new Error('Booklet export only supports side-by-side storybook layouts.');
        error.code = 'BOOKLET_UNSUPPORTED_LAYOUT';
        error.unsupportedPages = analysis.unsupportedPages;
        throw error;
    }

    const normalizedBooklet = normalizeStorybookBooklet(booklet);
    const leaves = [
        {
            coverKey: 'front',
            kind: 'cover',
            label: 'Front Cover',
        },
        ...buildInteriorBookletLeaves(pages),
        ...Array.from({ length: analysis.paddingCount }, (_, index) => ({
            blankIndex: index,
            kind: 'blank',
            label: `Blank ${index + 1}`,
        })),
        {
            coverKey: 'back',
            kind: 'cover',
            label: 'Back Cover',
        },
    ];

    return {
        analysis,
        booklet: normalizedBooklet,
        leaves,
    };
};

export const imposeBookletSheets = (leaves = []) => {
    if (leaves.length % 4 !== 0) {
        throw new Error('Booklet leaves must be a multiple of 4.');
    }

    const sheetCount = leaves.length / 4;
    const lastIndex = leaves.length - 1;

    return Array.from({ length: sheetCount }, (_, sheetIndex) => ({
        front: [
            leaves[lastIndex - (sheetIndex * 2)],
            leaves[sheetIndex * 2],
        ],
        back: [
            leaves[(sheetIndex * 2) + 1],
            leaves[lastIndex - 1 - (sheetIndex * 2)],
        ],
        sheetNumber: sheetIndex + 1,
    }));
};

export const buildBookletImposition = ({ booklet, pages = [] } = {}) => {
    const { analysis, booklet: normalizedBooklet, leaves } = buildBookletLeaves({ booklet, pages });

    return {
        analysis,
        booklet: normalizedBooklet,
        leaves,
        sheets: imposeBookletSheets(leaves),
    };
};
