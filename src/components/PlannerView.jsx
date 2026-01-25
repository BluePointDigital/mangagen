import React, { useState, useEffect, useRef } from 'react';
import ImageEditorModal from './ImageEditorModal';

const PlannerView = ({ library, onSendToCreator, projectId, initialMetadata, onUsageUpdate, appMode, onProjectUpdate }) => {
    // Upload refs for each page
    const pageUploadRefs = useRef({});
    const [fullStory, setFullStory] = useState(initialMetadata?.story || '');
    const [isPlanning, setIsPlanning] = useState(false);
    const [plannedPages, setPlannedPages] = useState(initialMetadata?.plannedPages || []);
    const [targetPageCount, setTargetPageCount] = useState(0); // 0 for Auto
    const [isLocalUpdate, setIsLocalUpdate] = useState(false); // Guard to prevent useEffect loop

    // Default settings for new pages
    const [defaultSettings, setDefaultSettings] = useState({
        genMode: 'full',
        engine: 'pro',
        colorMode: 'bw',
        textDensity: 'dialog_fx',
        aspectRatio: 'portrait',
        artStyle: 'storybook_classic'
    });

    // Per-page settings (indexed by page index)
    const [pageSettings, setPageSettings] = useState({});

    // Batch generation state
    const [generatingPages, setGeneratingPages] = useState({});
    const [generatedResults, setGeneratedResults] = useState({});
    const [batchProgress, setBatchProgress] = useState(null);
    const [expandedPages, setExpandedPages] = useState({});
    
    // Image editor state
    const [editingPageIndex, setEditingPageIndex] = useState(null);
    const [editingImageData, setEditingImageData] = useState(null);

    useEffect(() => {
        if (initialMetadata && !isLocalUpdate) {
            setFullStory(initialMetadata.story || '');
            setPlannedPages(initialMetadata.plannedPages || []);
            
            // Restore generatedResults from persisted plannedPages data
            if (initialMetadata.plannedPages?.length > 0) {
                const restoredResults = {};
                initialMetadata.plannedPages.forEach((page, idx) => {
                    if (page.generatedResult) {
                        restoredResults[idx] = { success: true, result: page.generatedResult };
                    }
                });
                if (Object.keys(restoredResults).length > 0) {
                    setGeneratedResults(restoredResults);
                }
            }
        }
        if (isLocalUpdate) setIsLocalUpdate(false);
    }, [initialMetadata]);

    // Initialize page settings when pages are parsed
    useEffect(() => {
        if (plannedPages.length > 0) {
            const newSettings = {};
            plannedPages.forEach((_, idx) => {
                if (!pageSettings[idx]) {
                    newSettings[idx] = { ...defaultSettings };
                }
            });
            if (Object.keys(newSettings).length > 0) {
                setPageSettings(prev => ({ ...prev, ...newSettings }));
            }
        }
    }, [plannedPages]);

    const saveProjectState = async (story, pages) => {
        if (!projectId) return;
        setIsLocalUpdate(true);
        try {
            const updatedData = { story, plannedPages: pages };
            await fetch(`/api/projects/${projectId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedData)
            });
            if (onProjectUpdate) onProjectUpdate(updatedData);
        } catch (err) {
            console.error('Failed to save project state:', err);
            setIsLocalUpdate(false);
        }
    };

    const handleParseStory = async () => {
        if (!fullStory.trim()) return alert('Please enter your story text');

        setIsPlanning(true);
        setGeneratedResults({});
        setPageSettings({});
        try {
            const assetList = [
                ...library.characters.map(c => `[Character] ${c.name}`),
                ...library.locations.map(l => `[Location] ${l.name}`),
                ...library.style.map(s => `[Style] ${s.name}`)
            ];

            const res = await fetch('/api/plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    story: fullStory,
                    assetList,
                    appMode,
                    targetPageCount: targetPageCount > 0 ? targetPageCount : null
                })
            });

            const data = await res.json();
            if (data.error) throw new Error(data.error);

            if (onUsageUpdate) onUsageUpdate('pro', data.usage, false); // Story parsing is always text-based

            const pages = Array.isArray(data) ? data : data.pages || [];
            setPlannedPages(pages);
            saveProjectState(fullStory, pages);
        } catch (err) {
            alert('Planning failed: ' + err.message);
        } finally {
            setIsPlanning(false);
        }
    };

    const getReferencesForPage = (page) => {
        const refs = [];
        [...library.characters, ...library.locations, ...library.style].forEach(item => {
            if ((page.suggestedReferences || []).some(ref => ref.includes(item.name))) {
                refs.push(item);
            }
        });
        return refs;
    };

    const updatePageSetting = (pageIndex, setting, value) => {
        setPageSettings(prev => ({
            ...prev,
            [pageIndex]: {
                ...prev[pageIndex],
                [setting]: value
            }
        }));
    };

    const updatePageContent = (pageIndex, newContent) => {
        setPlannedPages(prevPages => {
            const newPages = [...prevPages];
            newPages[pageIndex] = { ...newPages[pageIndex], pageContent: newContent };
            return newPages;
        });
    };

    const handleContentBlur = () => {
        saveProjectState(fullStory, plannedPages);
    };

    const applyDefaultsToAll = () => {
        const newSettings = {};
        plannedPages.forEach((_, idx) => {
            newSettings[idx] = { ...defaultSettings };
        });
        setPageSettings(newSettings);
    };

    const generatePage = async (pageIndex, page) => {
        const settings = pageSettings[pageIndex] || defaultSettings;
        setGeneratingPages(prev => ({ ...prev, [pageIndex]: true }));

        try {
            const matchedRefs = getReferencesForPage(page);
            const referenceImages = await Promise.all(
                matchedRefs.filter(item => item.type === 'image').map(async (item) => {
                    const response = await fetch(item.url);
                    const blob = await response.blob();
                    return new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve({
                            name: item.name,
                            data: reader.result
                        });
                        reader.readAsDataURL(blob);
                    });
                })
            );

            const res = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: page.pageContent,
                    references: referenceImages,
                    panels: page.panelCount || 3,
                    mode: settings.genMode,
                    engine: settings.engine,
                    projectId,
                    colorMode: settings.colorMode,
                    textDensity: settings.textDensity,
                    appMode,
                    aspectRatio: settings.aspectRatio,
                    artStyle: settings.artStyle
                })
            });

            const data = await res.json();
            if (data.error) throw new Error(data.error);

            if (onUsageUpdate) onUsageUpdate(settings.engine, data.usage, settings.genMode === 'full' || settings.genMode === 'storybook' || appMode === 'storybook');

            const resultObj = { success: true, result: data.result };
            setGeneratedResults(prev => ({
                ...prev,
                [pageIndex]: resultObj
            }));

            // Sync with plannedPages for persistence and preview
            setPlannedPages(prevPages => {
                const newPages = [...prevPages];
                newPages[pageIndex] = { ...newPages[pageIndex], generatedResult: data.result };
                saveProjectState(fullStory, newPages); // Persist to server
                return newPages;
            });
        } catch (err) {
            setGeneratedResults(prev => ({
                ...prev,
                [pageIndex]: { success: false, error: err.message }
            }));
        } finally {
            setGeneratingPages(prev => ({ ...prev, [pageIndex]: false }));
        }
    };

    const handleBatchGenerate = async () => {
        if (plannedPages.length === 0) return;

        setBatchProgress({ current: 0, total: plannedPages.length });

        for (let i = 0; i < plannedPages.length; i++) {
            setBatchProgress({ current: i + 1, total: plannedPages.length });
            await generatePage(i, plannedPages[i]);
        }

        setBatchProgress(null);
    };

    const toggleExpanded = (idx) => {
        setExpandedPages(prev => ({ ...prev, [idx]: !prev[idx] }));
    };

    const handleSendToCreatorWithResult = (page, pageIndex) => {
        const result = generatedResults[pageIndex];
        const resultData = result?.result || page.generatedResult;
        // Parse if it's a string (handles markdown-wrapped JSON)
        const parsedResult = parseResultData(resultData);
        onSendToCreator({
            ...page,
            pageIndex,  // Include the page index so Creator can sync back
            generatedResult: parsedResult || resultData
        });
    };

    // Open image editor for a page
    const handleEditPage = (pageIndex) => {
        const result = generatedResults[pageIndex];
        const parsedResult = parseResultData(result?.result);
        if (result?.success && parsedResult?.type === 'image') {
            const imageDataUrl = `data:${parsedResult.mimeType};base64,${parsedResult.data}`;
            setEditingImageData(imageDataUrl);
            setEditingPageIndex(pageIndex);
        }
    };

    // Handle save from image editor
    const handleSaveEdit = (editedResult) => {
        if (editingPageIndex === null) return;
        
        // Update generatedResults
        setGeneratedResults(prev => ({
            ...prev,
            [editingPageIndex]: { success: true, result: editedResult }
        }));

        // Sync with plannedPages for persistence
        setPlannedPages(prevPages => {
            const newPages = [...prevPages];
            newPages[editingPageIndex] = { ...newPages[editingPageIndex], generatedResult: editedResult };
            saveProjectState(fullStory, newPages);
            return newPages;
        });

        // Close editor
        setEditingPageIndex(null);
        setEditingImageData(null);
    };

    // Close image editor without saving
    const handleCloseEditor = () => {
        setEditingPageIndex(null);
        setEditingImageData(null);
    };

    // Upload handler for replacing generated images with uploaded ones
    const handlePageImageUpload = (pageIndex, e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target.result;
            const base64Data = dataUrl.split(',')[1];
            const mimeType = file.type || 'image/png';

            const uploadedResult = {
                type: 'image',
                data: base64Data,
                mimeType: mimeType
            };

            // Update generatedResults
            setGeneratedResults(prev => ({
                ...prev,
                [pageIndex]: { success: true, result: uploadedResult }
            }));

            // Sync with plannedPages for persistence
            setPlannedPages(prevPages => {
                const newPages = [...prevPages];
                newPages[pageIndex] = { ...newPages[pageIndex], generatedResult: uploadedResult };
                saveProjectState(fullStory, newPages);
                return newPages;
            });
        };
        reader.readAsDataURL(file);
        e.target.value = ''; // Reset input
    };

    // Helper to parse result data, handling markdown-wrapped JSON strings
    const parseResultData = (resultData) => {
        if (!resultData) return null;
        if (typeof resultData === 'object') return resultData;
        if (typeof resultData === 'string') {
            try {
                let textToParse = resultData.trim();
                if (textToParse.startsWith('```')) {
                    textToParse = textToParse.replace(/^```(?:json)?\s*\n?/, '');
                    textToParse = textToParse.replace(/\n?```\s*$/, '');
                }
                return JSON.parse(textToParse);
            } catch (e) {
                return null;
            }
        }
        return null;
    };

    const renderGeneratedPreview = (pageIndex) => {
        const result = generatedResults[pageIndex];
        if (!result) return null;

        if (!result.success) {
            return (
                <div className="generation-error">
                    <span>⚠️</span> {result.error}
                </div>
            );
        }

        // Parse the result data (handles string results with markdown wrapping)
        const parsedResult = parseResultData(result.result);

        if (parsedResult?.type === 'image') {
            return (
                <div className="generated-preview">
                    <img
                        src={`data:${parsedResult.mimeType};base64,${parsedResult.data}`}
                        alt="Generated page"
                    />
                    <div className="preview-badge">✓ Generated</div>
                </div>
            );
        }

        if (parsedResult?.panels) {
            return (
                <div className="storyboard-preview">
                    <div className="preview-badge storyboard">📋 Storyboard Ready</div>
                    <div className="mini-panels">
                        {parsedResult.panels.slice(0, 4).map((panel, i) => (
                            <div key={i} className="mini-panel">
                                <span className="mini-panel-num">{panel.panelNumber}</span>
                            </div>
                        ))}
                        {parsedResult.panels.length > 4 && (
                            <div className="mini-panel more">+{parsedResult.panels.length - 4}</div>
                        )}
                    </div>
                </div>
            );
        }

        return null;
    };

    const completedCount = Object.values(generatedResults).filter(r => r?.success).length;

    return (
        <div className="planner-layout animate-in">
            {/* Left Sidebar - Input */}
            <aside className="planner-sidebar">
                <div className="sidebar-section">
                    <h2 className="heading-font sidebar-title">
                        <span className="title-icon">📖</span>
                        Story Parser
                    </h2>
                    <p className="sidebar-desc">
                        {appMode === 'storybook'
                            ? 'Paste your story. AI will break it into illustration sections, each with a single evocative image.'
                            : 'Paste your script or story. AI will break it into manga pages with individual generation settings.'}
                    </p>
                </div>

                <div className="field-group">
                    <label className="field-label">Story Script</label>
                    <textarea
                        className="input-glass story-input"
                        placeholder="Once upon a time in a digital world..."
                        value={fullStory}
                        onChange={(e) => setFullStory(e.target.value)}
                    />
                </div>

                <div className="field-group">
                    <label className="field-label">Target Pages (0 for Auto)</label>
                    <div className="input-with-hint">
                        <input
                            type="number"
                            min="0"
                            max="50"
                            className="input-glass"
                            value={targetPageCount}
                            onChange={(e) => setTargetPageCount(parseInt(e.target.value) || 0)}
                        />
                        {targetPageCount === 0 && <span className="input-hint">Auto-detect</span>}
                    </div>
                </div>

                <button
                    onClick={handleParseStory}
                    disabled={isPlanning}
                    className="btn-primary"
                >
                    {isPlanning ? (
                        <><span className="btn-loader"></span> Analyzing...</>
                    ) : (
                        '✨ Parse to Pages'
                    )}
                </button>

                {plannedPages.length > 0 && (
                    <>
                        {/* Generation Settings Section */}
                        <div className="sidebar-settings-section">
                            <div className="settings-section-header">
                                <span className="settings-section-icon">⚙️</span>
                                <span className="settings-section-title">Generation Settings</span>
                            </div>
                            
                            <div className="settings-card">
                                <div className="settings-card-header">Engine & Output</div>
                                <div className="settings-grid">
                                    {appMode !== 'storybook' && (
                                        <div className="field-group compact">
                                            <label className="field-label">Mode</label>
                                            <select
                                                className="input-glass"
                                                value={defaultSettings.genMode}
                                                onChange={(e) => setDefaultSettings(prev => ({ ...prev, genMode: e.target.value }))}
                                            >
                                                <option value="storyboard">Storyboard</option>
                                                <option value="full">Full Page Art</option>
                                            </select>
                                        </div>
                                    )}

                                    <div className="field-group compact">
                                        <label className="field-label">Engine</label>
                                        <select
                                            className="input-glass"
                                            value={defaultSettings.engine}
                                            onChange={(e) => setDefaultSettings(prev => ({ ...prev, engine: e.target.value }))}
                                        >
                                            <option value="flash">Nano Banana</option>
                                            <option value="pro">Nano Banana Pro</option>
                                        </select>
                                    </div>

                                    <div className="field-group compact">
                                        <label className="field-label">Color</label>
                                        <select
                                            className="input-glass"
                                            value={defaultSettings.colorMode}
                                            onChange={(e) => setDefaultSettings(prev => ({ ...prev, colorMode: e.target.value }))}
                                        >
                                            <option value="bw">Black & White</option>
                                            <option value="color">Full Color</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="settings-card">
                                <div className="settings-card-header">Layout & Size</div>
                                <div className="settings-grid">
                                    <div className="field-group compact" style={{ gridColumn: '1 / -1' }}>
                                        <label className="field-label">Aspect Ratio</label>
                                        <select
                                            className="input-glass"
                                            value={['portrait', 'landscape', 'square', 'cinematic', '3:4'].includes(defaultSettings.aspectRatio) ? defaultSettings.aspectRatio : 'custom'}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (val === 'custom') setDefaultSettings(prev => ({ ...prev, aspectRatio: '' }));
                                                else setDefaultSettings(prev => ({ ...prev, aspectRatio: val }));
                                            }}
                                        >
                                            <option value="portrait">Standard Manga (2:3)</option>
                                            <option value="landscape">Landscape (3:2)</option>
                                            <option value="square">Square (1:1)</option>
                                            <option value="3:4">Book Portrait (3:4)</option>
                                            <option value="cinematic">Cinematic (16:9)</option>
                                            <option value="custom">Custom / Resolution...</option>
                                        </select>
                                    </div>
                                    {!['portrait', 'landscape', 'square', 'cinematic', '3:4'].includes(defaultSettings.aspectRatio) && (
                                        <div className="field-group compact" style={{ gridColumn: '1 / -1' }}>
                                            <input
                                                type="text"
                                                className="input-glass"
                                                placeholder="e.g. 1024x1024 or 21:9"
                                                value={defaultSettings.aspectRatio}
                                                onChange={(e) => setDefaultSettings(prev => ({ ...prev, aspectRatio: e.target.value }))}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Storybook-specific: Art Style */}
                            {appMode === 'storybook' && (
                                <div className="settings-card mode-specific storybook">
                                    <div className="settings-card-header">
                                        <span>🎨</span> Art Style
                                    </div>
                                    <div className="settings-grid">
                                        <div className="field-group compact" style={{ gridColumn: '1 / -1' }}>
                                            <select
                                                className="input-glass"
                                                value={defaultSettings.artStyle}
                                                onChange={(e) => setDefaultSettings(prev => ({ ...prev, artStyle: e.target.value }))}
                                            >
                                                <option value="storybook_classic">Classic Storybook</option>
                                                <option value="watercolor">Watercolor</option>
                                                <option value="oil_painting">Oil Painting</option>
                                                <option value="digital_illustration">Digital Illustration</option>
                                                <option value="anime">Anime</option>
                                                <option value="realistic">Realistic</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Manga-specific: Text Density */}
                            {appMode !== 'storybook' && (
                                <div className="settings-card mode-specific manga">
                                    <div className="settings-card-header">
                                        <span>💬</span> Text & Dialogue
                                    </div>
                                    <div className="settings-grid">
                                        <div className="field-group compact" style={{ gridColumn: '1 / -1' }}>
                                            <label className="field-label">Text Density</label>
                                            <select
                                                className="input-glass"
                                                value={defaultSettings.textDensity}
                                                onChange={(e) => setDefaultSettings(prev => ({ ...prev, textDensity: e.target.value }))}
                                            >
                                                <option value="minimal">Minimal (clean panels)</option>
                                                <option value="dialog">Dialog Only</option>
                                                <option value="dialog_fx">Dialog & Sound FX</option>
                                                <option value="dialog_fx_narration">Dialog, FX & Narration</option>
                                                <option value="full">Full Detail</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={applyDefaultsToAll}
                                className="btn-secondary"
                            >
                                Apply to All Pages
                            </button>
                        </div>

                        {/* Generate Section */}
                        <div className="sidebar-generate-section">
                            <button
                                onClick={handleBatchGenerate}
                                disabled={batchProgress !== null || plannedPages.length === 0}
                                className="btn-batch"
                            >
                                {batchProgress ? (
                                    <>
                                        <span className="btn-loader"></span>
                                        Generating {batchProgress.current}/{batchProgress.total}...
                                    </>
                                ) : (
                                    <>✨ Generate All Pages</>
                                )}
                            </button>

                            {(completedCount > 0 || batchProgress) && (
                                <div className="batch-status">
                                    <div className="status-bar">
                                        <div
                                            className="status-fill"
                                            style={{ width: `${(completedCount / plannedPages.length) * 100}%` }}
                                        />
                                    </div>
                                    <span className="status-text">
                                        {completedCount}/{plannedPages.length} pages complete
                                    </span>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </aside>

            {/* Main Content - Results */}
            <main className="planner-content">
                {plannedPages.length === 0 && !isPlanning && (
                    <div className="empty-state glass-panel">
                        <div className="empty-icon">📚</div>
                        <h3>No Pages Planned Yet</h3>
                        <p>Enter your story on the left and click "Parse to Pages" to begin.</p>
                    </div>
                )}

                {isPlanning && (
                    <div className="empty-state glass-panel">
                        <div className="loader"></div>
                        <p style={{ marginTop: '15px' }}>Constructing Storyboards...</p>
                    </div>
                )}

                {plannedPages.length > 0 && (
                    <div className="pages-container">
                        <div className="pages-header">
                            <h3 className="section-title">
                                Planned Sequence
                                <span className="page-count">{plannedPages.length} Pages</span>
                            </h3>
                        </div>

                        <div className="pages-grid">
                            {plannedPages.map((page, idx) => {
                                const matchedRefs = getReferencesForPage(page);
                                const isGenerating = generatingPages[idx];
                                const hasResult = generatedResults[idx];
                                const parsedResultData = hasResult?.success ? parseResultData(hasResult.result) : null;
                                const isExpanded = expandedPages[idx];
                                const settings = pageSettings[idx] || defaultSettings;

                                return (
                                    <div
                                        key={idx}
                                        className={`page-card animate-in ${hasResult?.success ? 'completed' : ''} ${isGenerating ? 'generating' : ''} ${isExpanded ? 'expanded-view' : ''}`}
                                        style={{ animationDelay: `${idx * 0.05}s` }}
                                    >
                                        <div className="page-header" onClick={() => toggleExpanded(idx)}>
                                            <div className="page-number">
                                                {page.pageNumber || idx + 1}
                                            </div>
                                            <div className="page-meta">
                                                <span className="panel-count">{appMode === 'storybook' ? '🎨 Illustration' : `${page.panelCount} Panels`}</span>
                                                {hasResult?.success && <span className="status-dot success">●</span>}
                                                {hasResult && !hasResult.success && <span className="status-dot error">●</span>}
                                            </div>
                                            <button className="expand-btn">
                                                {isExpanded ? '▼' : '▶'}
                                            </button>
                                        </div>

                                        {/* Per-Page Generation Settings */}
                                        <div className="page-settings">
                                            {appMode !== 'storybook' && (
                                                <select
                                                    className="page-setting-select"
                                                    value={settings.genMode}
                                                    onChange={(e) => updatePageSetting(idx, 'genMode', e.target.value)}
                                                    title="Generation Mode"
                                                >
                                                    <option value="storyboard">📋 Storyboard</option>
                                                    <option value="full">🎨 Full Art</option>
                                                </select>
                                            )}
                                            <select
                                                className="page-setting-select"
                                                value={settings.engine}
                                                onChange={(e) => updatePageSetting(idx, 'engine', e.target.value)}
                                                title="Engine"
                                            >
                                                <option value="flash">⚡ Fast</option>
                                                <option value="pro">✨ Pro</option>
                                            </select>
                                            <select
                                                className="page-setting-select"
                                                value={settings.colorMode}
                                                onChange={(e) => updatePageSetting(idx, 'colorMode', e.target.value)}
                                                title="Color Mode"
                                            >
                                                <option value="bw">⬛ B&W</option>
                                                <option value="color">🌈 Color</option>
                                            </select>
                                            <select
                                                className="page-setting-select"
                                                value={['portrait', 'landscape', 'square', 'cinematic', '3:4'].includes(settings.aspectRatio) ? settings.aspectRatio : 'custom'}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    if (val === 'custom') updatePageSetting(idx, 'aspectRatio', '');
                                                    else updatePageSetting(idx, 'aspectRatio', val);
                                                }}
                                                title="Aspect Ratio"
                                            >
                                                <option value="portrait">📐 Port (2:3)</option>
                                                <option value="landscape">📐 Land (3:2)</option>
                                                <option value="square">📐 Sq (1:1)</option>
                                                <option value="3:4">📐 Book (3:4)</option>
                                                <option value="cinematic">📐 Cine (16:9)</option>
                                                <option value="custom">✏️ Custom...</option>
                                            </select>

                                            {appMode === 'storybook' ? (
                                                <>
                                                    <select
                                                        className="page-setting-select"
                                                        value={settings.artStyle}
                                                        onChange={(e) => updatePageSetting(idx, 'artStyle', e.target.value)}
                                                        title="Art Style"
                                                    >
                                                        <option value="storybook_classic">🎨 Classic</option>
                                                        <option value="watercolor">🎨 Water</option>
                                                        <option value="oil_painting">🎨 Oil</option>
                                                        <option value="digital_illustration">🎨 Digital</option>
                                                        <option value="anime">🎨 Anime</option>
                                                        <option value="realistic">🎨 Real</option>
                                                    </select>
                                                </>
                                            ) : (
                                                <select
                                                    className="page-setting-select"
                                                    value={settings.textDensity}
                                                    onChange={(e) => updatePageSetting(idx, 'textDensity', e.target.value)}
                                                    title="Text Density"
                                                >
                                                    <option value="minimal">💭 Minimal</option>
                                                    <option value="dialog">💬 Dialog</option>
                                                    <option value="dialog_fx">💥 Dialog+FX</option>
                                                    <option value="dialog_fx_narration">📝 +Narration</option>
                                                    <option value="full">📖 Full</option>
                                                </select>
                                            )}
                                        </div>
                                        {!['portrait', 'landscape', 'square', 'cinematic', '3:4'].includes(settings.aspectRatio) && (
                                            <div className="page-settings" style={{ marginTop: '5px' }}>
                                                <input
                                                    type="text"
                                                    className="input-glass"
                                                    style={{ height: '25px', fontSize: '0.8rem' }}
                                                    placeholder="Custom Resolution (e.g. 1024x1024)"
                                                    value={settings.aspectRatio}
                                                    onChange={(e) => updatePageSetting(idx, 'aspectRatio', e.target.value)}
                                                />
                                            </div>
                                        )}

                                        {/* Reference Thumbnails */}
                                        {matchedRefs.length > 0 && (
                                            <div className="ref-thumbnails">
                                                {matchedRefs.filter(r => r.type === 'image').slice(0, 4).map((ref, i) => (
                                                    <img
                                                        key={i}
                                                        src={ref.url}
                                                        alt={ref.name}
                                                        title={ref.name}
                                                    />
                                                ))}
                                                {matchedRefs.length > 4 && (
                                                    <div className="ref-more">+{matchedRefs.length - 4}</div>
                                                )}
                                            </div>
                                        )}

                                        {/* Generated Preview */}
                                        {renderGeneratedPreview(idx)}

                                        {/* Expandable Content */}
                                        <div className={`page-content ${isExpanded ? 'expanded' : ''}`}>
                                            <textarea
                                                className="content-text-editable input-glass"
                                                value={page.pageContent}
                                                onChange={(e) => updatePageContent(idx, e.target.value)}
                                                onBlur={handleContentBlur}
                                                placeholder="Enter prompt or story text..."
                                                style={{ width: '100%', minHeight: '80px', background: 'rgba(255,255,255,0.05)', border: 'none', resize: 'vertical' }}
                                            />

                                            {(page.suggestedReferences || []).length > 0 && (
                                                <div className="ref-tags">
                                                    {page.suggestedReferences.map((ref, i) => (
                                                        <span key={i} className="ref-tag">📎 {ref}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Actions */}
                                        <div className="page-actions">
                                            <button
                                                className="action-btn generate"
                                                onClick={() => generatePage(idx, page)}
                                                disabled={isGenerating || batchProgress !== null}
                                            >
                                                {isGenerating ? (
                                                    <><span className="btn-loader small"></span> Generating...</>
                                                ) : hasResult?.success ? (
                                                    '↻ Regenerate'
                                                ) : (
                                                    '⚡ Generate'
                                                )}
                                            </button>
                                            {hasResult?.success && parsedResultData?.type === 'image' && (
                                                <button
                                                    className="action-btn edit"
                                                    onClick={() => handleEditPage(idx)}
                                                    title="Edit this image"
                                                >
                                                    ✏️ Edit
                                                </button>
                                            )}
                                            <button
                                                className="action-btn upload"
                                                onClick={() => pageUploadRefs.current[idx]?.click()}
                                                title="Upload an image instead of generating"
                                            >
                                                📤 Upload
                                            </button>
                                            <input
                                                ref={el => pageUploadRefs.current[idx] = el}
                                                type="file"
                                                accept="image/*"
                                                onChange={(e) => handlePageImageUpload(idx, e)}
                                                style={{ display: 'none' }}
                                            />
                                            <button
                                                className="action-btn send"
                                                onClick={() => handleSendToCreatorWithResult(page, idx)}
                                            >
                                                Open in Creator →
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </main>

            {/* Image Editor Modal */}
            <ImageEditorModal
                isOpen={editingPageIndex !== null}
                onClose={handleCloseEditor}
                imageData={editingImageData}
                onSaveEdit={handleSaveEdit}
                engine="pro"
                projectId={projectId}
            />
        </div >
    );
};

export default PlannerView;
