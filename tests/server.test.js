const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { once } = require('node:events');
const AdmZip = require('adm-zip');
const express = require('express');
const { createApp } = require('../server/app');
const { getConfig } = require('../server/config');

const makeDataUrl = (mimeType, value) => `data:${mimeType};base64,${Buffer.from(value).toString('base64')}`;

const PNG_DATA_URL = makeDataUrl('image/png', 'png-payload');
const JPG_DATA_URL = makeDataUrl('image/jpeg', 'jpg-payload');

const createHarness = async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mangagen-test-'));
    const app = createApp({ rootDir });
    const server = app.listen(0);
    await once(server, 'listening');

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const request = async (pathname, { body, headers, method = 'GET' } = {}) => {
        const response = await fetch(`${baseUrl}${pathname}`, {
            method,
            headers: {
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...(headers || {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        const rawText = await response.text();
        const contentType = response.headers.get('content-type') || '';
        let payload = rawText;

        if (contentType.includes('application/json') && rawText) {
            payload = JSON.parse(rawText);
        }

        return {
            body: payload,
            response,
            status: response.status,
        };
    };

    const close = async () => {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
        await fs.rm(rootDir, { force: true, recursive: true });
    };

    return { baseUrl, close, request, rootDir };
};

test('creates, lists, and fetches schema v2 projects', async (t) => {
    const harness = await createHarness();
    t.after(async () => harness.close());

    const createResponse = await harness.request('/api/projects', {
        method: 'POST',
        body: { mode: 'storybook', name: 'My Test Project' },
    });

    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.body.id, 'my-test-project');
    assert.equal(createResponse.body.mode, 'storybook');
    assert.equal(createResponse.body.schemaVersion, 2);
    assert.deepEqual(createResponse.body.plannedPages, []);

    const listResponse = await harness.request('/api/projects');
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.body.length, 1);
    assert.equal(listResponse.body[0].id, 'my-test-project');
    assert.equal(listResponse.body[0].schemaVersion, 2);

    const getResponse = await harness.request('/api/projects/my-test-project');
    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.body.name, 'My Test Project');
    assert.equal(getResponse.body.schemaVersion, 2);
});

test('returns default AI settings without exposing the Google API key', async (t) => {
    const originalApiKey = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = 'secret-test-key';
    const harness = await createHarness();
    t.after(async () => {
        process.env.GOOGLE_API_KEY = originalApiKey;
        await harness.close();
    });

    const settings = await harness.request('/api/settings/ai');
    assert.equal(settings.status, 200);
    assert.equal(settings.body.hasGoogleApiKey, true);
    assert.equal(settings.body.schemaVersion, 2);
    assert.equal(settings.body.providers.google.hasApiKey, true);
    assert.equal(settings.body.providers.google.textModel, process.env.PLANNER_MODEL || 'gemini-3-flash-preview');
    assert.equal(settings.body.routes.planner.provider, 'google');
    assert.ok(!('engine' in settings.body.defaults));
    assert.equal(settings.body.pricing.routes.planner.image, 0);
    assert.equal(settings.body.pricing.routes.pageImage.image, 0.134);
    assert.ok(!('googleApiKey' in settings.body));
    assert.ok(!('apiKey' in settings.body.providers.google));
});

test('saves AI settings and keeps existing API key when update key is blank', async (t) => {
    const originalApiKey = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = 'initial-key';
    const harness = await createHarness();
    t.after(async () => {
        process.env.GOOGLE_API_KEY = originalApiKey;
        await harness.close();
    });

    const update = await harness.request('/api/settings/ai', {
        method: 'PUT',
        body: {
            defaults: { colorMode: 'color', engine: 'flash' },
            providers: {
                google: {
                    apiKey: '',
                    textModel: 'planner-test-model',
                },
            },
            pricing: { routes: { planner: { image: 0.01, input: 0.02, output: 0.03 } } },
            routes: {
                planner: { provider: 'google', model: 'planner-test-model' },
            },
        },
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.hasGoogleApiKey, true);
    assert.equal(update.body.providers.google.textModel, 'planner-test-model');
    assert.equal(update.body.routes.planner.model, 'planner-test-model');
    assert.equal(update.body.defaults.colorMode, 'color');
    assert.ok(!('engine' in update.body.defaults));
    assert.equal(update.body.pricing.routes.planner.image, 0.01);
    assert.ok(!('googleApiKey' in update.body));

    const rawSettings = JSON.parse(await fs.readFile(path.join(harness.rootDir, 'settings', 'ai-config.json'), 'utf8'));
    assert.equal(rawSettings.providers.google.apiKey, 'initial-key');
    assert.ok(!('engine' in rawSettings.defaults));
});

test('migrates legacy v1 AI settings to provider routes', async (t) => {
    const harness = await createHarness();
    t.after(async () => harness.close());

    const settingsDir = path.join(harness.rootDir, 'settings');
    await fs.mkdir(settingsDir, { recursive: true });
    await fs.writeFile(path.join(settingsDir, 'ai-config.json'), JSON.stringify({
        googleApiKey: 'legacy-key',
        models: {
            creatorPro: 'legacy-storyboard',
            planner: 'legacy-planner',
            proImage: 'legacy-image',
        },
        defaults: { engine: 'pro' },
        pricing: {
            pro: { image: 0.5, input: 0.01, output: 0.02 },
        },
        schemaVersion: 1,
    }, null, 2));

    const settings = await harness.request('/api/settings/ai');
    assert.equal(settings.status, 200);
    assert.equal(settings.body.schemaVersion, 2);
    assert.equal(settings.body.providers.google.hasApiKey, true);
    assert.equal(settings.body.routes.planner.model, 'legacy-planner');
    assert.equal(settings.body.routes.pageImage.model, 'legacy-image');
    assert.ok(!('engine' in settings.body.defaults));
    assert.deepEqual(settings.body.pricing.routes.planner, { image: 0, input: 0.01, output: 0.02 });
    assert.deepEqual(settings.body.pricing.routes.pageImage, { image: 0.5, input: 0.01, output: 0.02 });
});

test('AI responses include route metadata and history stores the route', async (t) => {
    const providerServer = express().use(express.json());
    providerServer.post('/chat/completions', (req, res) => {
        res.json({
            choices: [{
                message: {
                    content: JSON.stringify([{ pageNumber: 1, pageContent: 'A planned page', panelCount: 1 }]),
                },
            }],
            usage: { completion_tokens: 4, prompt_tokens: 8, total_tokens: 12 },
        });
    });
    const localProvider = providerServer.listen(0);
    await once(localProvider, 'listening');

    const harness = await createHarness();
    t.after(async () => {
        await new Promise((resolve, reject) => localProvider.close((error) => (error ? reject(error) : resolve())));
        await harness.close();
    });

    const providerUrl = `http://127.0.0.1:${localProvider.address().port}`;
    await harness.request('/api/settings/ai', {
        method: 'PUT',
        body: {
            providers: {
                custom: {
                    apiKey: '',
                    baseUrl: providerUrl,
                    enabled: true,
                    textModel: 'local-planner',
                },
            },
            routes: {
                planner: { provider: 'custom', model: 'local-planner' },
            },
        },
    });

    const project = await harness.request('/api/projects', {
        method: 'POST',
        body: { mode: 'manga', name: 'Route History Project' },
    });
    const plan = await harness.request('/api/plan', {
        method: 'POST',
        body: {
            appMode: 'manga',
            assetList: [],
            projectId: project.body.id,
            story: 'A short story',
            targetPageCount: 1,
        },
    });

    assert.equal(plan.status, 200);
    assert.deepEqual(plan.body.route, { model: 'local-planner', provider: 'custom', routeKey: 'planner' });
    const history = await harness.request(`/api/projects/${project.body.id}/generation-history`);
    assert.deepEqual(history.body[0].route, { model: 'local-planner', provider: 'custom', routeKey: 'planner' });
    assert.ok(!('engine' in history.body[0].settings));
});

test('provider routes report missing credentials for selected provider', async (t) => {
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const harness = await createHarness();
    t.after(async () => {
        if (originalOpenAiKey === undefined) {
            delete process.env.OPENAI_API_KEY;
        } else {
            process.env.OPENAI_API_KEY = originalOpenAiKey;
        }
        await harness.close();
    });

    await harness.request('/api/settings/ai', {
        method: 'PUT',
        body: {
            providers: {
                openai: {
                    apiKey: '',
                    enabled: true,
                    textModel: 'gpt-test',
                },
            },
            routes: {
                planner: { provider: 'openai', model: 'gpt-test' },
            },
        },
    });

    const planResponse = await harness.request('/api/plan', {
        method: 'POST',
        body: {
            appMode: 'manga',
            assetList: [],
            story: 'A short story',
            targetPageCount: 1,
        },
    });
    assert.equal(planResponse.status, 400);
    assert.match(planResponse.body.error, /API key not configured/);
});

test('DATA_DIR controls the storage root', () => {
    const originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = path.join(os.tmpdir(), 'mangagen-data-dir-test');
    try {
        assert.equal(getConfig('/app/root').rootDir, path.resolve(process.env.DATA_DIR));
        assert.equal(getConfig('/app/root').appRoot, '/app/root');
    } finally {
        if (originalDataDir === undefined) {
            delete process.env.DATA_DIR;
        } else {
            process.env.DATA_DIR = originalDataDir;
        }
    }
});

test('rejects duplicate projects and remote browser origins', async (t) => {
    const harness = await createHarness();
    t.after(async () => harness.close());

    const first = await harness.request('/api/projects', {
        method: 'POST',
        body: { mode: 'manga', name: 'Duplicate Name' },
    });
    assert.equal(first.status, 201);

    const duplicate = await harness.request('/api/projects', {
        method: 'POST',
        body: { mode: 'manga', name: 'Duplicate Name' },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.error, 'Project already exists');

    const remoteOrigin = await harness.request('/api/projects', {
        headers: { Origin: 'https://example.com' },
    });
    assert.equal(remoteOrigin.status, 403);
    assert.equal(remoteOrigin.body.error, 'Local access only');
});

test('rejects invalid project ids, buckets, and filenames', async (t) => {
    const harness = await createHarness();
    t.after(async () => harness.close());

    const project = await harness.request('/api/projects', {
        method: 'POST',
        body: { mode: 'manga', name: 'Validation Project' },
    });

    const invalidProjectId = await harness.request('/api/save', {
        method: 'POST',
        body: {
            bucket: 'pages',
            imageData: PNG_DATA_URL,
            pageIndex: 0,
            projectId: '../escape',
        },
    });
    assert.equal(invalidProjectId.status, 400);
    assert.equal(invalidProjectId.body.error, 'Invalid project id');

    const invalidBucket = await harness.request('/api/save', {
        method: 'POST',
        body: {
            bucket: 'not-a-bucket',
            imageData: PNG_DATA_URL,
            projectId: project.body.id,
        },
    });
    assert.equal(invalidBucket.status, 400);
    assert.equal(invalidBucket.body.error, 'Invalid asset bucket');

    const invalidFilename = await harness.request('/api/save', {
        method: 'POST',
        body: {
            bucket: 'characters',
            filename: '../villain.png',
            imageData: PNG_DATA_URL,
            projectId: project.body.id,
        },
    });
    assert.equal(invalidFilename.status, 400);
    assert.equal(invalidFilename.body.error, 'Invalid filename');
});

test('replaces deterministic page assets and returns bucket-aware library items', async (t) => {
    const harness = await createHarness();
    t.after(async () => harness.close());

    const project = await harness.request('/api/projects', {
        method: 'POST',
        body: { mode: 'storybook', name: 'Asset Project' },
    });
    const projectId = project.body.id;

    const firstPageSave = await harness.request('/api/save', {
        method: 'POST',
        body: {
            bucket: 'pages',
            imageData: PNG_DATA_URL,
            pageIndex: 0,
            projectId,
        },
    });
    assert.equal(firstPageSave.status, 200);
    assert.equal(firstPageSave.body.asset.filename, 'page-001.png');
    assert.equal(firstPageSave.body.asset.bucket, 'pages');
    assert.equal(firstPageSave.body.asset.url, `/projects/${projectId}/pages/page-001.png`);

    const secondPageSave = await harness.request('/api/save', {
        method: 'POST',
        body: {
            bucket: 'pages',
            imageData: JPG_DATA_URL,
            pageIndex: 0,
            projectId,
        },
    });
    assert.equal(secondPageSave.status, 200);
    assert.equal(secondPageSave.body.asset.filename, 'page-001.jpg');

    const characterSave = await harness.request('/api/save', {
        method: 'POST',
        body: {
            bucket: 'characters',
            filename: 'hero-reference.png',
            imageData: PNG_DATA_URL,
            projectId,
        },
    });
    assert.equal(characterSave.status, 200);
    assert.equal(characterSave.body.asset.bucket, 'characters');

    const pageFiles = await fs.readdir(path.join(harness.rootDir, 'projects', projectId, 'pages'));
    assert.deepEqual(pageFiles, ['page-001.jpg']);

    const library = await harness.request(`/api/library?projectId=${projectId}`);
    assert.equal(library.status, 200);
    assert.equal(library.body.pages.length, 1);
    assert.equal(library.body.pages[0].bucket, 'pages');
    assert.equal(library.body.pages[0].url, `/projects/${projectId}/pages/page-001.jpg`);
    assert.equal(library.body.characters.length, 1);
    assert.equal(library.body.characters[0].bucket, 'characters');
    assert.equal(library.body.characters[0].url, `/projects/${projectId}/characters/hero-reference.png`);
});

test('exports and imports full project bundles with conflict-safe ids', async (t) => {
    const harness = await createHarness();
    t.after(async () => harness.close());

    const project = await harness.request('/api/projects', {
        method: 'POST',
        body: { mode: 'manga', name: 'Portable Project' },
    });
    const projectId = project.body.id;

    await harness.request('/api/save', {
        method: 'POST',
        body: {
            bucket: 'characters',
            filename: 'hero.png',
            imageData: PNG_DATA_URL,
            metadata: { displayName: 'Hero', role: 'protagonist' },
            projectId,
        },
    });

    await fs.writeFile(
        path.join(harness.rootDir, 'projects', projectId, 'generation-history.json'),
        JSON.stringify([{ id: 'run-1', operation: 'plan-story' }], null, 2)
    );

    const exportResponse = await fetch(`${harness.baseUrl}/api/projects/${projectId}/export`);
    assert.equal(exportResponse.status, 200);
    assert.equal(exportResponse.headers.get('content-type'), 'application/zip');
    const zipBuffer = Buffer.from(await exportResponse.arrayBuffer());
    const zip = new AdmZip(zipBuffer);
    assert.ok(zip.getEntry('mangagen-export.json'));
    assert.ok(zip.getEntry('project.json'));
    assert.ok(zip.getEntry('characters/hero.png'));
    assert.ok(zip.getEntry('characters/hero.json'));
    assert.ok(zip.getEntry('generation-history.json'));

    const importResponse = await fetch(`${harness.baseUrl}/api/projects/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zipBuffer,
    });
    const importedProject = await importResponse.json();
    assert.equal(importResponse.status, 201);
    assert.equal(importedProject.id, 'portable-project-imported-2');
    assert.equal(importedProject.name, 'Portable Project Imported');
    const importedFiles = await fs.readdir(path.join(harness.rootDir, 'projects', importedProject.id, 'characters'));
    assert.deepEqual(importedFiles.sort(), ['hero.json', 'hero.png']);
});

test('rejects project import zips with unsafe paths', async (t) => {
    const harness = await createHarness();
    t.after(async () => harness.close());

    const zip = new AdmZip();
    zip.addFile('mangagen-export.json', Buffer.from(JSON.stringify({
        projectId: 'bad-project',
        schemaVersion: 2,
        type: 'mangagen-project',
    })));
    zip.addFile('project.json', Buffer.from(JSON.stringify({
        id: 'bad-project',
        name: 'Bad Project',
        schemaVersion: 2,
    })));
    zip.addFile('../escape.txt', Buffer.from('nope'));

    const response = await fetch(`${harness.baseUrl}/api/projects/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zip.toBuffer(),
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error, 'Project zip contains unsafe paths');
});

test('persists generatedAsset metadata and strips inline generatedResult data from project.json', async (t) => {
    const harness = await createHarness();
    t.after(async () => harness.close());

    const project = await harness.request('/api/projects', {
        method: 'POST',
        body: { mode: 'storybook', name: 'Project Metadata' },
    });
    const projectId = project.body.id;

    const saveResponse = await harness.request('/api/save', {
        method: 'POST',
        body: {
            bucket: 'pages',
            imageData: PNG_DATA_URL,
            pageIndex: 0,
            projectId,
        },
    });
    const savedAsset = saveResponse.body.asset;

    const updateResponse = await harness.request(`/api/projects/${projectId}`, {
        method: 'PUT',
        body: {
            plannedPages: [
                {
                    endAnchor: 'the end',
                    generatedAsset: savedAsset,
                    generatedResult: {
                        data: 'should-not-persist',
                        mimeType: 'image/png',
                        type: 'image',
                    },
                    pageContent: 'A bright scene.',
                    pageNumber: 1,
                    panelCount: 1,
                    startAnchor: 'once upon',
                    storySegment: 'A short beat.',
                    suggestedReferences: ['hero-reference.png'],
                },
            ],
            story: 'Once upon a time. The end.',
        },
    });

    assert.equal(updateResponse.status, 200);
    assert.equal(updateResponse.body.plannedPages[0].generatedAsset.url, `/projects/${projectId}/pages/${savedAsset.filename}`);
    assert.ok(!('generatedResult' in updateResponse.body.plannedPages[0]));

    const rawProjectPath = path.join(harness.rootDir, 'projects', projectId, 'project.json');
    const rawProject = JSON.parse(await fs.readFile(rawProjectPath, 'utf8'));

    assert.equal(rawProject.schemaVersion, 2);
    assert.ok(!('generatedResult' in rawProject.plannedPages[0]));
    assert.deepEqual(rawProject.plannedPages[0].generatedAsset, {
        bucket: 'pages',
        filename: savedAsset.filename,
        mimeType: savedAsset.mimeType,
        updatedAt: savedAsset.updatedAt,
    });
    assert.ok(!('url' in rawProject.plannedPages[0].generatedAsset));
});
test('persists storybook booklet cover assets without storing hydrated urls', async (t) => {
    const harness = await createHarness();
    t.after(async () => harness.close());

    const project = await harness.request('/api/projects', {
        method: 'POST',
        body: { mode: 'storybook', name: 'Booklet Cover Project' },
    });
    const projectId = project.body.id;

    const frontCoverSave = await harness.request('/api/save', {
        method: 'POST',
        body: {
            bucket: 'pages',
            filename: 'cover-front',
            imageData: PNG_DATA_URL,
            projectId,
        },
    });
    assert.equal(frontCoverSave.status, 200);

    const backCoverSave = await harness.request('/api/save', {
        method: 'POST',
        body: {
            bucket: 'pages',
            filename: 'cover-back',
            imageData: JPG_DATA_URL,
            projectId,
        },
    });
    assert.equal(backCoverSave.status, 200);

    const updateResponse = await harness.request(`/api/projects/${projectId}`, {
        method: 'PUT',
        body: {
            storybookBooklet: {
                covers: {
                    front: {
                        generatedAsset: frontCoverSave.body.asset,
                        image: { fit: 'cover', posX: 50, posY: 50, zoom: 1 },
                        overlay: { bgColor: '#000000', paddingPx: 40, textColor: '#ffffff', textOpacity: 0.6 },
                        text: { html: '<p>Front cover</p>', source: 'manual' },
                        textStyle: { fontFamily: 'Plus Jakarta Sans', fontSizePx: 28, lineHeight: 1.3, letterSpacingPx: 0 },
                    },
                    back: {
                        generatedAsset: backCoverSave.body.asset,
                        image: { fit: 'cover', posX: 50, posY: 50, zoom: 1 },
                        overlay: { bgColor: '#000000', paddingPx: 40, textColor: '#ffffff', textOpacity: 0.6 },
                        text: { html: '<p>Back cover</p>', source: 'manual' },
                        textStyle: { fontFamily: 'Plus Jakarta Sans', fontSizePx: 28, lineHeight: 1.3, letterSpacingPx: 0 },
                    },
                },
            },
        },
    });

    assert.equal(updateResponse.status, 200);
    assert.equal(updateResponse.body.storybookBooklet.covers.front.generatedAsset.url, `/projects/${projectId}/pages/${frontCoverSave.body.asset.filename}`);
    assert.equal(updateResponse.body.storybookBooklet.covers.back.generatedAsset.url, `/projects/${projectId}/pages/${backCoverSave.body.asset.filename}`);

    const rawProjectPath = path.join(harness.rootDir, 'projects', projectId, 'project.json');
    const rawProject = JSON.parse(await fs.readFile(rawProjectPath, 'utf8'));

    assert.deepEqual(rawProject.storybookBooklet.covers.front.generatedAsset, {
        bucket: 'pages',
        filename: frontCoverSave.body.asset.filename,
        mimeType: frontCoverSave.body.asset.mimeType,
        updatedAt: frontCoverSave.body.asset.updatedAt,
    });
    assert.deepEqual(rawProject.storybookBooklet.covers.back.generatedAsset, {
        bucket: 'pages',
        filename: backCoverSave.body.asset.filename,
        mimeType: backCoverSave.body.asset.mimeType,
        updatedAt: backCoverSave.body.asset.updatedAt,
    });
    assert.ok(!('url' in rawProject.storybookBooklet.covers.front.generatedAsset));
    assert.ok(!('url' in rawProject.storybookBooklet.covers.back.generatedAsset));
});

test('hydrates missing storybookBooklet data for legacy schema-v2 projects', async (t) => {
    const harness = await createHarness();
    t.after(async () => harness.close());

    const project = await harness.request('/api/projects', {
        method: 'POST',
        body: { mode: 'storybook', name: 'Legacy Booklet Project' },
    });
    const projectId = project.body.id;
    const rawProjectPath = path.join(harness.rootDir, 'projects', projectId, 'project.json');
    const rawProject = JSON.parse(await fs.readFile(rawProjectPath, 'utf8'));

    delete rawProject.storybookBooklet;
    await fs.writeFile(rawProjectPath, JSON.stringify(rawProject, null, 2));

    const getResponse = await harness.request(`/api/projects/${projectId}`);
    assert.equal(getResponse.status, 200);
    assert.deepEqual(getResponse.body.storybookBooklet, {
        covers: {
            front: {},
            back: {},
        },
    });
});
