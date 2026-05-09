const path = require('path');
const { SCHEMA_VERSION } = require('../constants');
const { AppError } = require('../errors');
const { listDirectories, pathExists, readJson, writeJson } = require('./storage');
const { assertProjectBucket, assertSafeFilename, assertValidProjectId, slugifyProjectName } = require('./validation');

const createProjectStore = ({ assetStore, rootDir }) => {
    const projectsDir = path.join(rootDir, 'projects');

    const getProjectPath = (projectId) => path.join(projectsDir, assertValidProjectId(projectId));
    const getProjectConfigPath = (projectId) => path.join(getProjectPath(projectId), 'project.json');

    const normalizeAssetReference = (asset) => {
        if (!asset) {
            return null;
        }

        return {
            bucket: assertProjectBucket(asset.bucket),
            filename: assertSafeFilename(asset.filename),
            mimeType: typeof asset.mimeType === 'string' ? asset.mimeType : 'image/png',
            updatedAt: typeof asset.updatedAt === 'string'
                ? asset.updatedAt
                : new Date().toISOString(),
        };
    };

    const hydrateAssetReference = (projectId, asset) => {
        if (!asset) {
            return null;
        }

        return assetStore.buildAssetRecord({
            bucket: asset.bucket,
            filename: asset.filename,
            mimeType: asset.mimeType,
            projectId,
            updatedAt: asset.updatedAt,
        });
    };

    const normalizeBookletCover = (cover) => {
        const normalizedCover = { ...(cover || {}) };

        if (cover?.generatedAsset) {
            normalizedCover.generatedAsset = normalizeAssetReference(cover.generatedAsset);
        } else {
            delete normalizedCover.generatedAsset;
        }

        return normalizedCover;
    };

    const normalizeStorybookBooklet = (booklet) => ({
        covers: {
            front: normalizeBookletCover(booklet?.covers?.front),
            back: normalizeBookletCover(booklet?.covers?.back),
        },
    });

    const normalizeGenerationQueue = (queue) => ({
        items: Array.isArray(queue?.items)
            ? queue.items.map((item) => ({
                error: typeof item?.error === 'string' ? item.error : '',
                pageIndex: Number.isInteger(item?.pageIndex) ? item.pageIndex : 0,
                status: ['queued', 'running', 'succeeded', 'failed', 'skipped'].includes(item?.status)
                    ? item.status
                    : 'queued',
                updatedAt: typeof item?.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
            }))
            : [],
        state: ['idle', 'running', 'paused', 'completed'].includes(queue?.state) ? queue.state : 'idle',
        updatedAt: typeof queue?.updatedAt === 'string' ? queue.updatedAt : new Date().toISOString(),
    });

    const hydrateStorybookBooklet = (projectId, booklet) => {
        const normalizedBooklet = normalizeStorybookBooklet(booklet);

        return {
            ...normalizedBooklet,
            covers: {
                front: normalizedBooklet.covers.front.generatedAsset
                    ? {
                        ...normalizedBooklet.covers.front,
                        generatedAsset: hydrateAssetReference(projectId, normalizedBooklet.covers.front.generatedAsset),
                    }
                    : normalizedBooklet.covers.front,
                back: normalizedBooklet.covers.back.generatedAsset
                    ? {
                        ...normalizedBooklet.covers.back,
                        generatedAsset: hydrateAssetReference(projectId, normalizedBooklet.covers.back.generatedAsset),
                    }
                    : normalizedBooklet.covers.back,
            },
        };
    };

    const normalizePlannedPages = (pages) => (
        Array.isArray(pages)
            ? pages.map((page) => {
                const normalizedPage = { ...(page || {}) };
                delete normalizedPage.generatedResult;

                if (page?.generatedAsset) {
                    normalizedPage.generatedAsset = normalizeAssetReference(page.generatedAsset);
                } else {
                    delete normalizedPage.generatedAsset;
                }

                return normalizedPage;
            })
            : []
    );

    const normalizeProject = (project, fallbackId = null) => {
        const projectId = assertValidProjectId(project?.id || fallbackId);

        return {
            createdAt: typeof project?.createdAt === 'string' ? project.createdAt : new Date().toISOString(),
            id: projectId,
            generationQueue: normalizeGenerationQueue(project?.generationQueue),
            mode: project?.mode === 'storybook' ? 'storybook' : 'manga',
            name: typeof project?.name === 'string' && project.name.trim() ? project.name.trim() : projectId,
            plannedPages: normalizePlannedPages(project?.plannedPages),
            schemaVersion: SCHEMA_VERSION,
            story: typeof project?.story === 'string' ? project.story : '',
            storybookBooklet: normalizeStorybookBooklet(project?.storybookBooklet),
        };
    };

    const hydrateProjectAssets = (project) => ({
        ...project,
        plannedPages: project.plannedPages.map((page) => {
            if (!page.generatedAsset) {
                return page;
            }

            return {
                ...page,
                generatedAsset: hydrateAssetReference(project.id, page.generatedAsset),
            };
        }),
        storybookBooklet: hydrateStorybookBooklet(project.id, project.storybookBooklet),
    });

    const getProject = async (projectId) => {
        const safeProjectId = assertValidProjectId(projectId);
        const filePath = getProjectConfigPath(safeProjectId);
        const rawProject = await readJson(filePath, null);

        if (!rawProject || rawProject.schemaVersion !== SCHEMA_VERSION) {
            throw new AppError(404, 'Project not found');
        }

        return hydrateProjectAssets(normalizeProject(rawProject, safeProjectId));
    };

    const listProjects = async () => {
        await assetStore.ensureBaseDirs();
        const projectIds = await listDirectories(projectsDir);
        const projects = [];

        for (const projectId of projectIds) {
            try {
                const project = await getProject(projectId);
                projects.push(project);
            } catch (error) {
                if (!(error instanceof AppError)) {
                    throw error;
                }
            }
        }

        return projects.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    };

    const createProject = async ({ mode, name }) => {
        await assetStore.ensureBaseDirs();
        const projectId = slugifyProjectName(name);
        const projectPath = getProjectPath(projectId);

        if (await pathExists(projectPath)) {
            throw new AppError(400, 'Project already exists');
        }

        await assetStore.ensureProjectDirs(projectId);

        const project = normalizeProject({
            createdAt: new Date().toISOString(),
            id: projectId,
            mode,
            name: String(name || '').trim(),
            plannedPages: [],
            schemaVersion: SCHEMA_VERSION,
            story: '',
            storybookBooklet: undefined,
        });

        await writeJson(getProjectConfigPath(projectId), project);
        return hydrateProjectAssets(project);
    };

    const updateProject = async (projectId, patch) => {
        const currentProject = await getProject(projectId);
        const nextProject = normalizeProject(
            {
                ...currentProject,
                ...patch,
                id: currentProject.id,
                schemaVersion: SCHEMA_VERSION,
            },
            currentProject.id
        );

        await writeJson(getProjectConfigPath(currentProject.id), nextProject);
        return hydrateProjectAssets(nextProject);
    };

    return {
        createProject,
        getProject,
        listProjects,
        updateProject,
    };
};

module.exports = {
    createProjectStore,
};
