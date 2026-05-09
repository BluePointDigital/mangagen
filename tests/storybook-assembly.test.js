const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const importModule = async (relativePath) => import(pathToFileURL(path.resolve(relativePath)).href);

test('storybook text normalization repairs legacy prompt text to story text', async () => {
    const { STORYBOOK_TEXT_SOURCE, normalizeStorybookText } = await importModule('src/lib/storybookAssembly.mjs');

    const normalized = normalizeStorybookText(
        { html: '<p>Prompt only</p>' },
        {
            fallbackText: 'Full story text',
            promptText: 'Prompt only',
            summaryText: 'Short summary',
        }
    );

    assert.equal(normalized.html, '<p>Full story text</p>');
    assert.equal(normalized.source, STORYBOOK_TEXT_SOURCE.story);
});

test('storybook text normalization preserves manual edits', async () => {
    const { STORYBOOK_TEXT_SOURCE, normalizeStorybookText } = await importModule('src/lib/storybookAssembly.mjs');

    const normalized = normalizeStorybookText(
        {
            html: '<p>Custom edited text</p>',
            source: STORYBOOK_TEXT_SOURCE.manual,
        },
        {
            fallbackText: 'Full story text',
            promptText: 'Prompt only',
            summaryText: 'Short summary',
        }
    );

    assert.equal(normalized.html, '<p>Custom edited text</p>');
    assert.equal(normalized.source, STORYBOOK_TEXT_SOURCE.manual);
});

test('storybook text normalization refreshes explicit story source when story text changes', async () => {
    const { STORYBOOK_TEXT_SOURCE, normalizeStorybookText } = await importModule('src/lib/storybookAssembly.mjs');

    const normalized = normalizeStorybookText(
        {
            html: '<p>Old story text</p>',
            source: STORYBOOK_TEXT_SOURCE.story,
        },
        {
            fallbackText: 'New story text',
            promptText: 'Prompt only',
            summaryText: 'Short summary',
        }
    );

    assert.equal(normalized.html, '<p>New story text</p>');
    assert.equal(normalized.source, STORYBOOK_TEXT_SOURCE.story);
});

test('storybook text helpers expose source labels and source-specific html', async () => {
    const {
        STORYBOOK_TEXT_SOURCE,
        getStorybookTextHtmlForSource,
        getStorybookTextSourceLabel,
    } = await importModule('src/lib/storybookAssembly.mjs');

    assert.equal(
        getStorybookTextHtmlForSource(STORYBOOK_TEXT_SOURCE.summary, { summaryText: 'Short summary' }),
        '<p>Short summary</p>'
    );
    assert.equal(
        getStorybookTextHtmlForSource(STORYBOOK_TEXT_SOURCE.story, { fallbackText: '' }),
        null
    );
    assert.equal(getStorybookTextSourceLabel(STORYBOOK_TEXT_SOURCE.prompt), 'Prompt Text');
    assert.equal(getStorybookTextSourceLabel(STORYBOOK_TEXT_SOURCE.manual), 'Edited');
});
