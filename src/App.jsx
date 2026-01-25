import React, { useState, useEffect } from 'react';
import LibraryView from './components/LibraryView';
import CreatorView from './components/CreatorView';
import PlannerView from './components/PlannerView';
import ProjectSelector from './components/ProjectSelector';
import ProjectPreviewer from './components/ProjectPreviewer';
import StorybookAssembler from './components/StorybookAssembler';

const App = () => {
    const [activeTab, setActiveTab] = useState('creator');
    const [library, setLibrary] = useState({ characters: [], locations: [], style: [], pages: [] });
    const [sharedPageData, setSharedPageData] = useState(null);
    const [currentProject, setCurrentProject] = useState(null);
    const [loadingProject, setLoadingProject] = useState(true);
    const [appMode, setAppMode] = useState('manga'); // 'manga' or 'storybook'
    const [usageStats, setUsageStats] = useState({
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0
    });
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [isAssemblerOpen, setIsAssemblerOpen] = useState(false);
    const [isModeChangeDialogOpen, setIsModeChangeDialogOpen] = useState(false);

    const GEMINI_PRICING = {
        'flash': { // Nano Banana (Gemini 2.5 Flash Image)
            input: 0.30 / 1000000,
            output: 2.50 / 1000000,
            image: 0.039
        },
        'pro': { // Nano Banana Pro (Gemini 3 Pro Image Preview)
            input: 2.00 / 1000000,
            output: 12.00 / 1000000,
            image: 0.134
        }
    };

    const handleUsageUpdate = (modelType, usage, isImage = false) => {
        if (!usage) return;

        const price = GEMINI_PRICING[modelType] || GEMINI_PRICING['flash'];
        let cost = (usage.promptTokenCount * price.input) + (usage.candidatesTokenCount * price.output);

        if (isImage) {
            cost = (usage.promptTokenCount * price.input) + price.image;
        }

        setUsageStats(prev => ({
            inputTokens: prev.inputTokens + (usage.promptTokenCount || 0),
            outputTokens: prev.outputTokens + (usage.candidatesTokenCount || 0),
            totalCost: prev.totalCost + cost
        }));
    };

    const fetchLibrary = async () => {
        try {
            const url = currentProject
                ? `/api/library?projectId=${currentProject.id}`
                : '/api/library';
            const res = await fetch(url);
            const data = await res.json();
            setLibrary(data);
        } catch (err) {
            console.error('Failed to fetch library:', err);
        }
    };

    const handleProjectSelect = (project) => {
        setCurrentProject(project);
        setAppMode(project.mode || 'manga'); // Sync mode from project
        localStorage.setItem('manga_maker_last_project', project.id);
    };

    const handleProjectUpdate = (updatedMetadata) => {
        setCurrentProject(prev => ({ ...prev, ...updatedMetadata }));
    };

    const handleOpenPreview = async () => {
        // Refresh project data from server before opening preview
        if (currentProject?.id) {
            try {
                const res = await fetch(`/api/projects/${currentProject.id}`);
                if (res.ok) {
                    const latestProject = await res.json();
                    setCurrentProject(latestProject);
                }
            } catch (err) {
                console.error('Failed to refresh project for preview:', err);
            }
        }
        setIsPreviewOpen(true);
    };

    const loadLastProject = async () => {
        const lastId = localStorage.getItem('manga_maker_last_project');
        if (lastId) {
            try {
                const res = await fetch(`/api/projects/${lastId}`);
                if (res.ok) {
                    const project = await res.json();
                    setCurrentProject(project);
                    setAppMode(project.mode || 'manga'); // Sync mode from project
                }
            } catch (err) {
                console.error('Failed to load last project:', err);
            }
        }
        setLoadingProject(false);
    };

    const handleSendToCreator = (pageData) => {
        setSharedPageData(pageData);
        setActiveTab('creator');
    };

    // Generic handler for updating plannedPages (used by assembler and others)
    const handleUpdatePlannedPages = async (updatedPages) => {
        if (!currentProject?.id) return;

        const updatedProject = {
            ...currentProject,
            plannedPages: updatedPages
        };

        setCurrentProject(updatedProject);

        // Persist to server
        try {
            await fetch(`/api/projects/${currentProject.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plannedPages: updatedPages })
            });
        } catch (err) {
            console.error('Failed to save updated plannedPages:', err);
        }
    };

    // Handler for updating a page's image (used by StorybookAssembler upload)
    const handleUpdatePageImage = async (pageIndex, imageResult) => {
        if (!currentProject?.plannedPages) return;

        const updatedPages = [...currentProject.plannedPages];
        updatedPages[pageIndex] = {
            ...updatedPages[pageIndex],
            generatedResult: imageResult
        };
        await handleUpdatePlannedPages(updatedPages);
    };

    // Handler for changing project mode with confirmation
    const handleModeChange = async () => {
        const newMode = appMode === 'manga' ? 'storybook' : 'manga';
        
        try {
            const res = await fetch(`/api/projects/${currentProject.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: newMode })
            });
            
            if (res.ok) {
                const updatedProject = await res.json();
                setCurrentProject(updatedProject);
                setAppMode(newMode);
            }
        } catch (err) {
            console.error('Failed to change project mode:', err);
        }
        
        setIsModeChangeDialogOpen(false);
    };

    useEffect(() => {
        loadLastProject();
    }, []);

    useEffect(() => {
        if (currentProject) {
            fetchLibrary();
        }
    }, [currentProject]);

    if (loadingProject) return <div className="loading-screen">Waking Up...</div>;

    if (!currentProject) {
        return <ProjectSelector onSelect={handleProjectSelect} />;
    }

    return (
        <div className="app-container" data-mode={appMode}>
            <header className="main-header">
                <div className="logo-section">
                    <div className="logo" onClick={() => setCurrentProject(null)} style={{ cursor: 'pointer' }}>MANGAGEN</div>
                    <span className="project-badge">{currentProject.name}</span>
                </div>
                <div className="project-mode-indicator" data-mode={appMode}>
                    <span className="mode-badge">
                        {appMode === 'storybook' ? '🎨 Storybook' : '📖 Manga'}
                    </span>
                    <button 
                        className="change-mode-btn" 
                        onClick={() => setIsModeChangeDialogOpen(true)}
                        title="Change project mode"
                    >
                        Change
                    </button>
                </div>
                <nav className="nav-tabs">
                    <button
                        className={`tab-btn ${activeTab === 'planner' ? 'active' : ''}`}
                        onClick={() => setActiveTab('planner')}
                    >
                        Story Planner
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'creator' ? 'active' : ''}`}
                        onClick={() => setActiveTab('creator')}
                    >
                        Creator Studio
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'library' ? 'active' : ''}`}
                        onClick={() => setActiveTab('library')}
                    >
                        Asset Library
                    </button>
                    <button
                        className={`tab-btn preview-btn`}
                        onClick={handleOpenPreview}
                        style={{ marginLeft: '10px', background: 'var(--accent-secondary)', color: 'white' }}
                    >
                        👁️ Preview Project
                    </button>
                    {appMode === 'storybook' && (
                        <button
                            className="tab-btn assemble-btn"
                            onClick={() => setIsAssemblerOpen(true)}
                            style={{ marginLeft: '10px', background: 'var(--accent)', color: 'white' }}
                        >
                            📚 Assemble Book
                        </button>
                    )}
                </nav>
            </header>

            <main className="content-area">
                {activeTab === 'planner' && (
                    <PlannerView
                        library={library}
                        onSendToCreator={handleSendToCreator}
                        projectId={currentProject.id}
                        initialMetadata={currentProject}
                        onUsageUpdate={handleUsageUpdate}
                        appMode={appMode}
                        onProjectUpdate={handleProjectUpdate}
                    />
                )}
                {activeTab === 'creator' && (
                    <CreatorView
                        library={library}
                        onRefresh={fetchLibrary}
                        initialData={sharedPageData}
                        onClearInitialData={() => setSharedPageData(null)}
                        projectId={currentProject.id}
                        onUsageUpdate={handleUsageUpdate}
                        appMode={appMode}
                        onSyncToPlanner={handleUpdatePageImage}
                    />
                )}
                {activeTab === 'library' && (
                    <LibraryView
                        library={library}
                        onRefresh={fetchLibrary}
                        projectId={currentProject.id}
                    />
                )}
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
                <div className="usage-hint">Based on Google Gemini Pricing</div>
            </footer>

            <ProjectPreviewer
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                project={currentProject}
                appMode={appMode}
            />

            <StorybookAssembler
                isOpen={isAssemblerOpen}
                onClose={() => setIsAssemblerOpen(false)}
                project={currentProject}
                appMode={appMode}
                onUpdatePageImage={handleUpdatePageImage}
                onUpdatePlannedPages={handleUpdatePlannedPages}
            />

            {/* Mode Change Confirmation Dialog */}
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
                            <button 
                                className="btn-cancel" 
                                onClick={() => setIsModeChangeDialogOpen(false)}
                            >
                                Cancel
                            </button>
                            <button 
                                className="btn-confirm-change" 
                                onClick={handleModeChange}
                            >
                                Change Mode
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
