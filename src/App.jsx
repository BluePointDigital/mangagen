import React, { Suspense, lazy, startTransition, useEffect, useState } from 'react';
import NotificationCenter from './components/ui/NotificationCenter';
import {
    exportProject,
    getLibrary,
    getAiSettings,
    getProject,
    importProject,
    isBackendUnavailableError,
    saveAsset,
    updateProject,
} from './lib/api.mjs';
import { inlineImageToSavePayload } from './lib/assets.mjs';
import { clearInlineGeneratedResults, mergePageAtIndex, updatePageGeneratedAsset } from './lib/projectPages.mjs';
import { calculateUsageCost } from './lib/usageCost.mjs';

const CreatorView = lazy(() => import('./components/CreatorView'));
const LibraryView = lazy(() => import('./components/LibraryView'));
const PlannerView = lazy(() => import('./components/PlannerView'));
const ProjectPreviewer = lazy(() => import('./components/ProjectPreviewer'));
const ProjectSelector = lazy(() => import('./components/ProjectSelector'));
const SettingsPanel = lazy(() => import('./components/SettingsPanel'));
const StorybookAssembler = lazy(() => import('./components/StorybookAssembler'));

const LoadingPane = ({ label = 'Loading...' }) => <div className="loading-screen">{label}</div>;

const bannerStyles = {
    container: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        padding: '14px 18px',
        margin: '16px',
        borderRadius: '16px',
        background: 'rgba(120, 53, 15, 0.2)',
        border: '1px solid rgba(251, 191, 36, 0.35)',
        color: '#fde68a',
        backdropFilter: 'blur(12px)',
    },
    compact: {
        margin: '12px 0 0',
    },
    body: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
    },
    title: {
        fontSize: '0.95rem',
        fontWeight: 700,
    },
    detail: {
        fontSize: '0.82rem',
        color: '#fef3c7',
    },
    button: {
        border: '1px solid rgba(255,255,255,0.18)',
        borderRadius: '999px',
        background: 'rgba(255,255,255,0.1)',
        color: '#fff7ed',
        cursor: 'pointer',
        fontSize: '0.82rem',
        fontWeight: 600,
        padding: '9px 16px',
        whiteSpace: 'nowrap',
    },
};

const BackendStatusBanner = ({ compact = false, isRetrying, lastKnownProjectId, message, onRetry }) => {
    if (!message) {
        return null;
    }

    return (
        <div style={{ ...bannerStyles.container, ...(compact ? bannerStyles.compact : {}) }}>
            <div style={bannerStyles.body}>
                <span style={bannerStyles.title}>Backend Connection Required</span>
                <span style={bannerStyles.detail}>{message}</span>
                {!compact && lastKnownProjectId && (
                    <span style={bannerStyles.detail}>Last project: {lastKnownProjectId}</span>
                )}
            </div>
            <button type="button" style={bannerStyles.button} onClick={onRetry} disabled={isRetrying}>
                {isRetrying ? 'Retrying...' : 'Retry Connection'}
            </button>
        </div>
    );
};

const App = () => {
    const [activeTab, setActiveTab] = useState('creator');
    const [library, setLibrary] = useState({ characters: [], locations: [], style: [], pages: [] });
    const [sharedPageData, setSharedPageData] = useState(null);
    const [currentProject, setCurrentProject] = useState(null);
    const [loadingProject, setLoadingProject] = useState(true);
    const [appMode, setAppMode] = useState('manga');
    const [usageStats, setUsageStats] = useState({ inputTokens: 0, outputTokens: 0, totalCost: 0 });
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [isAssemblerOpen, setIsAssemblerOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
    const [isModeChangeDialogOpen, setIsModeChangeDialogOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [backendMessage, setBackendMessage] = useState('');
    const [isRetryingBackend, setIsRetryingBackend] = useState(false);
    const [lastKnownProjectId, setLastKnownProjectId] = useState('');
    const [projectSelectorKey, setProjectSelectorKey] = useState(0);
    const [aiSettings, setAiSettings] = useState(null);

    const dismissNotification = (notificationId) => {
        setNotifications((previous) => previous.filter((notification) => notification.id !== notificationId));
    };

    const notify = ({ message, title = 'Notice', type = 'info' }) => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        setNotifications((previous) => [...previous, { id, message, title, type }]);
        window.setTimeout(() => {
            setNotifications((previous) => previous.filter((notification) => notification.id !== id));
        }, 4500);
    };

    const clearBackendStatus = () => {
        setBackendMessage('');
    };

    const handleRequestError = (error, title = 'Request Failed') => {
        if (isBackendUnavailableError(error)) {
            if (backendMessage !== error.message) {
                notify({ message: error.message, title: 'Backend Unavailable', type: 'error' });
            }
            setBackendMessage(error.message);
            return;
        }

        notify({ message: error.message, title, type: 'error' });
    };

    const handleUsageUpdate = (route, usage) => {
        if (!usage) return;

        const cost = calculateUsageCost(route, usage, aiSettings?.pricing);

        setUsageStats((previous) => ({
            inputTokens: previous.inputTokens + (usage.promptTokenCount || 0),
            outputTokens: previous.outputTokens + (usage.candidatesTokenCount || 0),
            totalCost: previous.totalCost + cost,
        }));
    };

    const fetchLibrary = async (project = currentProject) => {
        try {
            const data = await getLibrary(project?.id || null);
            setLibrary({
                characters: data.characters || [],
                locations: data.locations || [],
                pages: data.pages || [],
                style: data.style || [],
            });
            clearBackendStatus();
            return data;
        } catch (error) {
            console.error('Failed to fetch library:', error);
            handleRequestError(error, 'Library Sync Failed');
            throw error;
        }
    };

    const sanitizeProjectPatch = (patch = {}) => ({
        ...patch,
        ...(Array.isArray(patch.plannedPages) ? { plannedPages: clearInlineGeneratedResults(patch.plannedPages) } : {}),
    });

    const persistProjectPatch = async (projectId, patch) => {
        const updatedProject = await updateProject(projectId, sanitizeProjectPatch(patch));
        setCurrentProject(updatedProject);
        clearBackendStatus();
        return updatedProject;
    };

    const handleProjectSelect = async (project) => {
        setCurrentProject(project);
        setAppMode(project.mode || 'manga');
        setLastKnownProjectId(project.id);
        localStorage.setItem('manga_maker_last_project', project.id);

        try {
            await fetchLibrary(project);
        } catch (error) {
            console.error('Failed to load project library:', error);
        }
    };

    const handleProjectUpdate = (updatedMetadata) => {
        if (updatedMetadata?.id) {
            setLastKnownProjectId(updatedMetadata.id);
        }
        setCurrentProject((previous) => ({ ...previous, ...updatedMetadata }));
    };

    const handleOpenPreview = async () => {
        if (currentProject?.id) {
            try {
                const latestProject = await getProject(currentProject.id);
                setCurrentProject(latestProject);
                clearBackendStatus();
            } catch (error) {
                console.error('Failed to refresh project for preview:', error);
                handleRequestError(error, 'Preview Refresh Failed');
                return;
            }
        }
        setIsPreviewOpen(true);
    };

    const handleExportProject = async (project = currentProject) => {
        if (!project?.id) return;
        try {
            const blob = await exportProject(project.id);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${project.id}.mangagen.zip`;
            link.click();
            URL.revokeObjectURL(url);
            notify({ message: `${project.name} exported.`, title: 'Project Exported', type: 'success' });
        } catch (error) {
            handleRequestError(error, 'Project Export Failed');
        }
    };

    const handleImportProjectFile = async (file) => {
        if (!file) return null;
        try {
            const project = await importProject(file);
            notify({ message: `${project.name} imported.`, title: 'Project Imported', type: 'success' });
            await handleProjectSelect(project);
            setProjectSelectorKey((previous) => previous + 1);
            return project;
        } catch (error) {
            handleRequestError(error, 'Project Import Failed');
            throw error;
        }
    };

    const loadLastProject = async () => {
        try {
            setAiSettings(await getAiSettings());
            clearBackendStatus();
        } catch (error) {
            console.error('Failed to load AI settings:', error);
            handleRequestError(error, 'Settings Load Failed');
        }

        const storedProjectId = localStorage.getItem('manga_maker_last_project') || '';
        setLastKnownProjectId(storedProjectId);

        if (storedProjectId) {
            try {
                const project = await getProject(storedProjectId);
                setCurrentProject(project);
                setAppMode(project.mode || 'manga');
                clearBackendStatus();
                await fetchLibrary(project);
            } catch (error) {
                console.error('Failed to load last project:', error);
                if (!isBackendUnavailableError(error)) {
                    localStorage.removeItem('manga_maker_last_project');
                    setLastKnownProjectId('');
                }
                handleRequestError(error, 'Project Load Failed');
            }
        }
        setLoadingProject(false);
    };

    const handleSendToCreator = (pageData) => {
        setSharedPageData(pageData);
        startTransition(() => setActiveTab('creator'));
    };

    const handlePersistProjectPatch = async (projectPatch) => {
        if (!currentProject?.id) return;

        try {
            await persistProjectPatch(currentProject.id, projectPatch);
        } catch (error) {
            console.error('Failed to save updated project data:', error);
            handleRequestError(error, 'Project Save Failed');
        }
    };

    const handleSyncCreatorPage = async (pageIndex, { imageResult = null, pagePatch = {} } = {}) => {
        if (!currentProject?.id) {
            return { asset: null, updatedProject: null };
        }

        try {
            let nextPages = mergePageAtIndex(currentProject.plannedPages || [], pageIndex, pagePatch);
            let asset = null;

            if (imageResult) {
                const { dataUrl } = await inlineImageToSavePayload(imageResult);
                const response = await saveAsset({
                    bucket: 'pages',
                    imageData: dataUrl,
                    pageIndex,
                    projectId: currentProject.id,
                });
                asset = response.asset;
                nextPages = updatePageGeneratedAsset(nextPages, pageIndex, asset);
            }

            const updatedProject = await persistProjectPatch(currentProject.id, { plannedPages: nextPages });
            if (imageResult) {
                await fetchLibrary(updatedProject);
            }
            clearBackendStatus();
            return { asset, updatedProject };
        } catch (error) {
            console.error('Failed to sync creator page:', error);
            handleRequestError(error, imageResult ? 'Page Save Failed' : 'Project Save Failed');
            throw error;
        }
    };

    const handleSaveProjectAsset = async (payload) => {
        if (!currentProject?.id) {
            return null;
        }

        try {
            const response = await saveAsset({
                ...payload,
                projectId: currentProject.id,
            });
            clearBackendStatus();
            return response.asset;
        } catch (error) {
            console.error('Failed to save project asset:', error);
            handleRequestError(error, 'Asset Save Failed');
            throw error;
        }
    };

    const handleModeChange = async () => {
        if (!currentProject?.id) {
            return;
        }

        const newMode = appMode === 'manga' ? 'storybook' : 'manga';

        try {
            const updatedProject = await updateProject(currentProject.id, { mode: newMode });
            setCurrentProject(updatedProject);
            setAppMode(newMode);
            clearBackendStatus();
            notify({
                message: `Project mode changed to ${newMode}.`,
                title: 'Mode Updated',
                type: 'success',
            });
        } catch (error) {
            console.error('Failed to change project mode:', error);
            handleRequestError(error, 'Mode Change Failed');
        }

        setIsModeChangeDialogOpen(false);
    };

    const handleRetryBackend = async () => {
        setIsRetryingBackend(true);
        try {
            const projectIdToRestore = currentProject?.id || lastKnownProjectId;

            if (projectIdToRestore) {
                const project = await getProject(projectIdToRestore);
                setCurrentProject(project);
                setAppMode(project.mode || 'manga');
                setLastKnownProjectId(project.id);
                localStorage.setItem('manga_maker_last_project', project.id);
                await fetchLibrary(project);
                clearBackendStatus();
            } else {
                clearBackendStatus();
                setProjectSelectorKey((previous) => previous + 1);
            }
        } catch (error) {
            console.error('Failed to reconnect backend:', error);
            handleRequestError(error, 'Reconnect Failed');
            if (!currentProject) {
                setProjectSelectorKey((previous) => previous + 1);
            }
        } finally {
            setIsRetryingBackend(false);
            setLoadingProject(false);
        }
    };

    useEffect(() => {
        loadLastProject();
    }, []);

    if (loadingProject) {
        return <LoadingPane label="Waking Up..." />;
    }

    return (
        <>
            <NotificationCenter notifications={notifications} onDismiss={dismissNotification} />
            {!currentProject ? (
                <>
                    <BackendStatusBanner
                        isRetrying={isRetryingBackend}
                        lastKnownProjectId={lastKnownProjectId}
                        message={backendMessage}
                        onRetry={handleRetryBackend}
                    />
                    <Suspense fallback={<LoadingPane label="Loading projects..." />}>
                        <ProjectSelector
                            key={projectSelectorKey}
                            onBackendReady={clearBackendStatus}
                            onBackendUnavailable={setBackendMessage}
                            onNotify={notify}
                            onImportProject={handleImportProjectFile}
                            onExportProject={handleExportProject}
                            onSelect={handleProjectSelect}
                        />
                    </Suspense>
                </>
            ) : (
                <div className="app-container" data-mode={appMode}>
                    <header className="main-header">
                        <div className="logo-section">
                            <div className="logo" onClick={() => setCurrentProject(null)} style={{ cursor: 'pointer' }}>MANGAGEN</div>
                            <span className="project-badge">{currentProject.name}</span>
                        </div>
                        <div className="project-mode-indicator" data-mode={appMode}>
                            <span className="mode-badge">
                                {appMode === 'storybook' ? 'Storybook' : 'Manga'}
                            </span>
                            <button className="change-mode-btn" onClick={() => setIsModeChangeDialogOpen(true)} title="Change project mode">
                                Change
                            </button>
                        </div>
                        <nav className="nav-tabs">
                            <button className={`tab-btn ${activeTab === 'planner' ? 'active' : ''}`} onClick={() => startTransition(() => setActiveTab('planner'))}>
                                Story Planner
                            </button>
                            <button className={`tab-btn ${activeTab === 'creator' ? 'active' : ''}`} onClick={() => startTransition(() => setActiveTab('creator'))}>
                                Creator Studio
                            </button>
                            <button className={`tab-btn ${activeTab === 'library' ? 'active' : ''}`} onClick={() => startTransition(() => setActiveTab('library'))}>
                                Asset Library
                            </button>
                            <div className="project-menu">
                                <button className="tab-btn project-menu-trigger" onClick={() => setIsProjectMenuOpen((open) => !open)}>
                                    Project
                                </button>
                                {isProjectMenuOpen && (
                                    <div className="project-menu-popover">
                                        <button type="button" onClick={() => { setIsProjectMenuOpen(false); handleOpenPreview(); }}>Preview Project</button>
                                        {appMode === 'storybook' && (
                                            <button type="button" onClick={() => { setIsProjectMenuOpen(false); setIsAssemblerOpen(true); }}>Assemble Book</button>
                                        )}
                                        <button type="button" onClick={() => { setIsProjectMenuOpen(false); handleExportProject(); }}>Export Project</button>
                                        <button type="button" onClick={() => { setIsProjectMenuOpen(false); setIsSettingsOpen(true); }}>Settings</button>
                                        <button type="button" onClick={() => { setIsProjectMenuOpen(false); setIsModeChangeDialogOpen(true); }}>Change Mode</button>
                                        <button type="button" onClick={() => { setIsProjectMenuOpen(false); setCurrentProject(null); }}>Back to Projects</button>
                                    </div>
                                )}
                            </div>
                        </nav>
                    </header>

                    <BackendStatusBanner
                        compact
                        isRetrying={isRetryingBackend}
                        lastKnownProjectId={lastKnownProjectId}
                        message={backendMessage}
                        onRetry={handleRetryBackend}
                    />

                    <main className="content-area">
                        <Suspense fallback={<LoadingPane />}>
                            {activeTab === 'planner' && (
                                <PlannerView
                                    appMode={appMode}
                                    initialMetadata={currentProject}
                                    library={library}
                                    onNotify={notify}
                                    onProjectUpdate={handleProjectUpdate}
                                    onSendToCreator={handleSendToCreator}
                                    onUsageUpdate={handleUsageUpdate}
                                    aiDefaults={aiSettings?.defaults}
                                    projectId={currentProject.id}
                                />
                            )}
                            {activeTab === 'creator' && (
                                <CreatorView
                                    appMode={appMode}
                                    initialData={sharedPageData}
                                    library={library}
                                    onNotify={notify}
                                    onRefresh={fetchLibrary}
                                    onSyncToPlanner={handleSyncCreatorPage}
                                    onUsageUpdate={handleUsageUpdate}
                                    aiDefaults={aiSettings?.defaults}
                                    projectId={currentProject.id}
                                />
                            )}
                            {activeTab === 'library' && (
                                <LibraryView
                                    library={library}
                                    onNotify={notify}
                                    onRefresh={fetchLibrary}
                                    projectId={currentProject.id}
                                />
                            )}
                        </Suspense>
                    </main>

                    <footer className="usage-bar">
                        <div className="usage-content">
                            <div className="usage-segment">
                                <span className="usage-label">Tokens Used:</span>
                                <span className="usage-value">In: {usageStats.inputTokens.toLocaleString()} / Out: {usageStats.outputTokens.toLocaleString()}</span>
                            </div>
                            <div className="usage-segment">
                                <span className="usage-label">Estimated Cost:</span>
                                <span className="usage-value cost">${usageStats.totalCost.toFixed(4)}</span>
                            </div>
                        </div>
                        <div className="usage-hint">Based on configured route estimates</div>
                    </footer>

                    <Suspense fallback={null}>
                        <SettingsPanel
                            isOpen={isSettingsOpen}
                            onClose={() => setIsSettingsOpen(false)}
                            onNotify={notify}
                            onSaved={setAiSettings}
                            settings={aiSettings}
                        />
                    </Suspense>

                    <Suspense fallback={null}>
                        <ProjectPreviewer
                            appMode={appMode}
                            isOpen={isPreviewOpen}
                            onClose={() => setIsPreviewOpen(false)}
                            project={currentProject}
                        />
                    </Suspense>

                    <Suspense fallback={null}>
                        <StorybookAssembler
                            isOpen={isAssemblerOpen}
                            onClose={() => setIsAssemblerOpen(false)}
                            onNotify={notify}
                            onPersistProjectPatch={handlePersistProjectPatch}
                            onSaveProjectAsset={handleSaveProjectAsset}
                            project={currentProject}
                        />
                    </Suspense>

                    {isModeChangeDialogOpen && (
                        <div className="mode-change-overlay">
                            <div className="mode-change-dialog">
                                <h3>Change Project Mode?</h3>
                                <p>
                                    Switching from <strong>{appMode === 'manga' ? 'Manga' : 'Storybook'}</strong> to{' '}
                                    <strong>{appMode === 'manga' ? 'Storybook' : 'Manga'}</strong> mode.
                                </p>
                                <p className="mode-change-warning">
                                    Some settings may not transfer between modes. Panel counts and text density settings may be reset for existing pages.
                                </p>
                                <div className="mode-change-actions">
                                    <button className="btn-cancel" onClick={() => setIsModeChangeDialogOpen(false)}>
                                        Cancel
                                    </button>
                                    <button className="btn-confirm-change" onClick={handleModeChange}>
                                        Change Mode
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </>
    );
};

export default App;
