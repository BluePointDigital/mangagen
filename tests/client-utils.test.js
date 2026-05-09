const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const importModule = async (relativePath) => import(pathToFileURL(path.resolve(relativePath)).href);

const withMockFetch = (t, implementation) => {
    const originalFetch = global.fetch;
    global.fetch = implementation;
    t.after(() => {
        global.fetch = originalFetch;
    });
};

test('API helpers surface server errors and send JSON payloads', async (t) => {
    const { createProject } = await importModule('src/lib/api.mjs');
    let fetchCall;

    withMockFetch(t, async (url, options) => {
        fetchCall = { url, options };
        return new Response(JSON.stringify({ error: 'Project already exists' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    });

    await assert.rejects(
        () => createProject({ mode: 'manga', name: 'Duplicate Name' }),
        /Project already exists/
    );

    assert.equal(fetchCall.url, '/api/projects');
    assert.equal(fetchCall.options.method, 'POST');
    assert.equal(fetchCall.options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(fetchCall.options.body), { mode: 'manga', name: 'Duplicate Name' });
});

test('AI settings helpers fetch and update settings', async (t) => {
    const { getAiSettings, updateAiSettings } = await importModule('src/lib/api.mjs');
    const calls = [];

    withMockFetch(t, async (url, options = {}) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({
            defaults: { colorMode: 'bw' },
            hasGoogleApiKey: true,
            pricing: { routes: { planner: { image: 0, input: 0.02, output: 0.03 } } },
            routes: { planner: { model: 'planner-test', provider: 'google' } },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    });

    await getAiSettings();
    await updateAiSettings({ defaults: { colorMode: 'color' } });

    assert.equal(calls[0].url, '/api/settings/ai');
    assert.equal(calls[1].url, '/api/settings/ai');
    assert.equal(calls[1].options.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[1].options.body), { defaults: { colorMode: 'color' } });
});

test('usage cost helper uses route pricing', async () => {
    const { calculateUsageCost } = await importModule('src/lib/usageCost.mjs');

    assert.equal(
        calculateUsageCost(
            { routeKey: 'pageImage', provider: 'openai', model: 'image-model' },
            { promptTokenCount: 100, candidatesTokenCount: 20 },
            { routes: { pageImage: { image: 0.25, input: 0.001, output: 0.01 } } }
        ),
        0.55
    );
});

test('project import and export helpers call binary endpoints', async (t) => {
    const { exportProject, importProject } = await importModule('src/lib/api.mjs');
    const calls = [];

    withMockFetch(t, async (url, options = {}) => {
        calls.push({ url, options });
        if (url.includes('/export')) {
            return new Response(new Blob(['zip']), {
                status: 200,
                headers: { 'Content-Type': 'application/zip' },
            });
        }
        return new Response(JSON.stringify({ id: 'imported-project' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
        });
    });

    const blob = await exportProject('demo');
    assert.equal(blob.size, 3);
    const imported = await importProject(new Blob(['zip']));
    assert.equal(imported.id, 'imported-project');
    assert.equal(calls[0].url, '/api/projects/demo/export');
    assert.equal(calls[1].url, '/api/projects/import');
    assert.equal(calls[1].options.method, 'POST');
    assert.equal(calls[1].options.headers['Content-Type'], 'application/zip');
});


test('API helpers surface backend-unavailable errors clearly', async (t) => {
    const { apiRequest } = await importModule('src/lib/api.mjs');

    withMockFetch(t, async () => new Response('Error occurred while trying to proxy: localhost:5173/api/projects', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
    }));

    await assert.rejects(
        () => apiRequest('/api/projects'),
        /Backend unavailable\. Start the server on http:\/\/localhost:3001 and reload\./
    );
});

test('API helpers map fetch failures to the backend-unavailable message', async (t) => {
    const { apiRequest } = await importModule('src/lib/api.mjs');

    withMockFetch(t, async () => {
        throw new Error('fetch failed');
    });

    await assert.rejects(
        () => apiRequest('/api/projects'),
        /Backend unavailable\. Start the server on http:\/\/localhost:3001 and reload\./
    );
});

test('image helpers prefer persisted assets and normalize inline image results', async () => {
    const { getDisplayImageSrc } = await importModule('src/lib/assets.mjs');

    assert.equal(
        getDisplayImageSrc({ type: 'image', mimeType: 'image/png', data: 'abc123' }),
        'data:image/png;base64,abc123'
    );
    assert.equal(
        getDisplayImageSrc({ bucket: 'pages', filename: 'page-001.png', url: '/projects/demo/pages/page-001.png' }),
        '/projects/demo/pages/page-001.png'
    );
    assert.equal(getDisplayImageSrc('data:image/png;base64,xyz789'), 'data:image/png;base64,xyz789');
    assert.equal(getDisplayImageSrc(null), null);
});

test('story segment extraction tolerates punctuation and preserves ordering', async () => {
    const { extractVerbatimSegments } = await importModule('src/lib/storySegments.mjs');

    const story = 'Once upon a time, there was a fox. The fox met a bear in the woods. They shared tea together.';
    const pages = [
        {
            startAnchor: 'Once upon a time',
            endAnchor: 'there was a fox',
        },
        {
            startAnchor: 'The fox met',
            endAnchor: 'in the woods',
        },
    ];

    const segments = extractVerbatimSegments(story, pages);
    assert.deepEqual(segments, [
        'Once upon a time, there was a fox',
        'The fox met a bear in the woods',
    ]);
});

test('story segment extraction falls back to the next page anchor and story end', async () => {
    const { extractVerbatimSegments } = await importModule('src/lib/storySegments.mjs');

    const story = 'First page full text ends here. Second page keeps going until the actual end.';
    const pages = [
        {
            startAnchor: 'First page full',
            endAnchor: 'missing ending words',
        },
        {
            startAnchor: 'Second page keeps',
            endAnchor: 'another missing ending',
        },
    ];

    const segments = extractVerbatimSegments(story, pages);
    assert.deepEqual(segments, [
        'First page full text ends here.',
        'Second page keeps going until the actual end.',
    ]);
});

test('project page helpers strip transient image blobs and update stored assets', async () => {
    const {
        clearInlineGeneratedResults,
        getPageGenerationSettings,
        getPersistedOrTransientResult,
        mergePageAtIndex,
        updatePageGeneratedAsset,
    } = await importModule('src/lib/projectPages.mjs');

    const startingPages = [
        {
            pageNumber: 1,
            generatedAsset: {
                bucket: 'pages',
                filename: 'page-001.png',
                url: '/projects/demo/pages/page-001.png',
            },
            generatedResult: {
                type: 'image',
                mimeType: 'image/png',
                data: 'inline',
            },
        },
        { pageNumber: 2 },
    ];

    const mergedPages = mergePageAtIndex(startingPages, 0, {
        pageContent: 'Updated prompt',
        generationSettings: { engine: 'pro' },
    });

    assert.equal(mergedPages[0].pageContent, 'Updated prompt');
    assert.deepEqual(getPageGenerationSettings(mergedPages[0], { engine: 'flash', colorMode: 'bw' }), { colorMode: 'bw' });
    assert.deepEqual(getPageGenerationSettings({}, { engine: 'flash', colorMode: 'color' }), { colorMode: 'color' });

    const updatedPages = updatePageGeneratedAsset(startingPages, 1, {
        bucket: 'pages',
        filename: 'page-002.png',
        url: '/projects/demo/pages/page-002.png',
    });

    assert.equal(updatedPages[1].generatedAsset.filename, 'page-002.png');
    assert.equal(updatedPages[0].generatedAsset.filename, 'page-001.png');

    const strippedPages = clearInlineGeneratedResults(updatedPages);
    assert.ok(!('generatedResult' in strippedPages[0]));
    assert.equal(strippedPages[0].generatedAsset.filename, 'page-001.png');

    assert.deepEqual(
        getPersistedOrTransientResult(updatedPages[0], { success: true, result: { type: 'image', mimeType: 'image/png', data: 'new-inline' } }),
        { type: 'image', mimeType: 'image/png', data: 'new-inline' }
    );
    assert.equal(
        getPersistedOrTransientResult(updatedPages[1], null).filename,
        'page-002.png'
    );
});
