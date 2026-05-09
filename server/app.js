const path = require('path');
const express = require('express');
const { getConfig } = require('./config');
const { isAppError } = require('./errors');
const { createAiSettingsStore } = require('./services/ai-settings-store');
const { createAiService } = require('./services/ai-service');
const { createAssetStore } = require('./services/asset-store');
const { createGenerationHistoryStore } = require('./services/generation-history-store');
const { createProjectStore } = require('./services/project-store');
const { createProjectPortability } = require('./services/project-portability');
const { assertGlobalBucket, assertProjectBucket, assertValidProjectId } = require('./services/validation');

const isAllowedLocalOrigin = (originValue) => {
    if (!originValue) {
        return true;
    }

    try {
        const parsed = new URL(originValue);
        return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    } catch (error) {
        return false;
    }
};

const localOnlyMiddleware = (req, res, next) => {
    if (!isAllowedLocalOrigin(req.headers.origin)) {
        return res.status(403).json({ error: 'Local access only' });
    }

    next();
};

const createApp = ({ appRoot, rootDir } = {}) => {
    const baseConfig = getConfig(appRoot);
    const config = {
        ...baseConfig,
        ...(rootDir ? { rootDir } : {}),
    };
    const aiSettingsStore = createAiSettingsStore({ config });
    const assetStore = createAssetStore({ rootDir: config.rootDir });
    const generationHistoryStore = createGenerationHistoryStore({ rootDir: config.rootDir });
    const projectStore = createProjectStore({ assetStore, rootDir: config.rootDir });
    const projectPortability = createProjectPortability({ projectStore, rootDir: config.rootDir });
    const aiService = createAiService({ aiSettingsStore });

    assetStore.ensureBaseDirs().catch((error) => {
        console.error('Failed to ensure base directories:', error);
    });

    const app = express();
    app.use(localOnlyMiddleware);
    app.post('/api/projects/import', express.raw({ limit: '500mb', type: ['application/zip', 'application/octet-stream'] }), async (req, res, next) => {
        try {
            res.status(201).json(await projectPortability.importProject(req.body));
        } catch (error) {
            next(error);
        }
    });
    app.use(express.json({ limit: '100mb' }));
    app.use(express.urlencoded({ extended: true, limit: '100mb' }));

    app.use('/library/:bucket', (req, res, next) => {
        try {
            const bucket = assertGlobalBucket(req.params.bucket);
            return express.static(assetStore.getGlobalBucketDir(bucket))(req, res, next);
        } catch (error) {
            return next(error);
        }
    });

    app.use('/projects/:projectId/:bucket', (req, res, next) => {
        try {
            const projectId = assertValidProjectId(req.params.projectId);
            const bucket = assertProjectBucket(req.params.bucket);
            return express.static(assetStore.getProjectBucketDir(projectId, bucket))(req, res, next);
        } catch (error) {
            return next(error);
        }
    });

    app.get('/api/projects', async (req, res, next) => {
        try {
            res.json(await projectStore.listProjects());
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/projects', async (req, res, next) => {
        try {
            const project = await projectStore.createProject(req.body || {});
            res.status(201).json(project);
        } catch (error) {
            next(error);
        }
    });

    app.get('/api/projects/:id', async (req, res, next) => {
        try {
            res.json(await projectStore.getProject(req.params.id));
        } catch (error) {
            next(error);
        }
    });

    app.get('/api/projects/:id/export', async (req, res, next) => {
        try {
            const project = await projectStore.getProject(req.params.id);
            const zipBuffer = await projectPortability.exportProject(req.params.id);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${project.id}.mangagen.zip"`);
            res.send(zipBuffer);
        } catch (error) {
            next(error);
        }
    });

    app.put('/api/projects/:id', async (req, res, next) => {
        try {
            res.json(await projectStore.updateProject(req.params.id, req.body || {}));
        } catch (error) {
            next(error);
        }
    });

    app.get('/api/library', async (req, res, next) => {
        try {
            res.json(await assetStore.listLibrary(req.query.projectId || null));
        } catch (error) {
            next(error);
        }
    });

    app.get('/api/settings/ai', async (req, res, next) => {
        try {
            res.json(await aiSettingsStore.getPublicSettings());
        } catch (error) {
            next(error);
        }
    });

    app.put('/api/settings/ai', async (req, res, next) => {
        try {
            res.json(await aiSettingsStore.updateSettings(req.body || {}));
        } catch (error) {
            next(error);
        }
    });

    app.get('/api/projects/:id/generation-history', async (req, res, next) => {
        try {
            res.json(await generationHistoryStore.listHistory(req.params.id));
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/generate', async (req, res, next) => {
        try {
            const payload = req.body || {};
            const response = await aiService.generate(payload);
            await generationHistoryStore.appendHistory(payload.projectId, {
                operation: 'generate-page',
                prompt: payload.prompt,
                references: (payload.references || []).map((reference) => reference.name),
                resultType: response.result?.type || 'text',
                route: response.route,
                settings: {
                    appMode: payload.appMode,
                    artStyle: payload.artStyle,
                    aspectRatio: payload.aspectRatio,
                    colorMode: payload.colorMode,
                    mode: payload.mode,
                    panels: payload.panels,
                    textDensity: payload.textDensity,
                },
                usage: response.usage,
            });
            res.json(response);
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/generate-panel', async (req, res, next) => {
        try {
            const payload = req.body || {};
            const response = await aiService.generatePanel(payload);
            await generationHistoryStore.appendHistory(payload.projectId, {
                operation: 'generate-panel',
                prompt: payload.panel?.composition,
                references: (payload.references || []).map((reference) => reference.name),
                resultType: response.result?.type || 'text',
                route: response.route,
                settings: {
                    aspectRatio: payload.aspectRatio,
                    colorMode: payload.colorMode,
                    textDensity: payload.textDensity,
                },
                usage: response.usage,
            });
            res.json(response);
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/plan', async (req, res, next) => {
        try {
            const payload = req.body || {};
            const response = await aiService.planStory(payload);
            await generationHistoryStore.appendHistory(payload.projectId, {
                operation: 'plan-story',
                prompt: payload.story,
                references: payload.assetList || [],
                resultType: 'json',
                route: response.route,
                settings: {
                    appMode: payload.appMode,
                    targetPageCount: payload.targetPageCount,
                },
                usage: response.usage,
            });
            res.json(response);
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/edit', async (req, res, next) => {
        try {
            const payload = req.body || {};
            const response = await aiService.editImage(payload);
            await generationHistoryStore.appendHistory(payload.projectId, {
                operation: 'edit-image',
                prompt: payload.prompt,
                resultType: response.result?.type || 'text',
                route: response.route,
                settings: {
                    mode: payload.mode,
                },
                usage: response.usage,
            });
            res.json(response);
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/save', async (req, res, next) => {
        try {
            const asset = await assetStore.saveAsset(req.body || {});
            res.json({ asset });
        } catch (error) {
            next(error);
        }
    });

    if (process.env.NODE_ENV === 'production') {
        const distDir = path.join(config.appRoot, 'dist');
        app.use(express.static(distDir));
        app.get(/.*/, (req, res) => {
            res.sendFile(path.join(distDir, 'index.html'));
        });
    }

    app.use((error, req, res, next) => {
        if (isAppError(error)) {
            return res.status(error.status).json({ error: error.message });
        }

        console.error('Unhandled server error:', error);
        return res.status(500).json({ error: error.message || 'Internal server error' });
    });

    return app;
};

module.exports = {
    createApp,
};
