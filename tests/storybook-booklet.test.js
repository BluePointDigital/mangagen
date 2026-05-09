const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const importModule = async (relativePath) => import(pathToFileURL(path.resolve(relativePath)).href);

const makePages = (count, layout = 'side-left') => (
    Array.from({ length: count }, (_, index) => ({
        pageNumber: index + 1,
        storybookAssembly: { layout },
    }))
);

test('booklet math keeps one spread plus covers at four leaves', async () => {
    const { buildBookletImposition } = await importModule('src/lib/storybookBooklet.mjs');

    const result = buildBookletImposition({ pages: makePages(1) });

    assert.equal(result.analysis.interiorLeafCount, 2);
    assert.equal(result.analysis.paddingCount, 0);
    assert.equal(result.analysis.totalLeafCount, 4);
    assert.equal(result.sheets.length, 1);
    assert.deepEqual(result.leaves.map((leaf) => leaf.kind), ['cover', 'story', 'story', 'cover']);
});

test('booklet math pads ten spreads plus covers up to twenty-four leaves', async () => {
    const { buildBookletImposition } = await importModule('src/lib/storybookBooklet.mjs');

    const result = buildBookletImposition({ pages: makePages(10) });

    assert.equal(result.analysis.interiorLeafCount, 20);
    assert.equal(result.analysis.paddingCount, 2);
    assert.equal(result.analysis.totalLeafCount, 24);
    assert.equal(result.sheets.length, 6);
    assert.equal(result.leaves.filter((leaf) => leaf.kind === 'blank').length, 2);
});

test('booklet imposition orders outer and inner sheets correctly', async () => {
    const { buildBookletImposition } = await importModule('src/lib/storybookBooklet.mjs');

    const result = buildBookletImposition({ pages: makePages(3) });

    assert.deepEqual(result.sheets[0].front.map((leaf) => leaf.label), ['Back Cover', 'Front Cover']);
    assert.deepEqual(result.sheets[0].back.map((leaf) => leaf.label), ['Page 1 Left', 'Page 3 Right']);
    assert.deepEqual(result.sheets[1].front.map((leaf) => leaf.label), ['Page 3 Left', 'Page 1 Right']);
    assert.deepEqual(result.sheets[1].back.map((leaf) => leaf.label), ['Page 2 Left', 'Page 2 Right']);
});

test('side-right spreads still split in visual left-to-right order', async () => {
    const { buildInteriorBookletLeaves } = await importModule('src/lib/storybookBooklet.mjs');

    const leaves = buildInteriorBookletLeaves(makePages(1, 'side-right'));

    assert.deepEqual(leaves.map((leaf) => leaf.position), ['left', 'right']);
    assert.equal(leaves[0].label, 'Page 1 Left');
    assert.equal(leaves[1].label, 'Page 1 Right');
});

test('booklet export rejects unsupported page layouts', async () => {
    const { buildBookletImposition } = await importModule('src/lib/storybookBooklet.mjs');

    assert.throws(
        () => buildBookletImposition({
            pages: [
                {
                    pageNumber: 1,
                    storybookAssembly: { layout: 'overlay-bottom' },
                },
            ],
        }),
        /side-by-side storybook layouts/
    );
});
