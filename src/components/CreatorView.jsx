import React, { useState, useEffect, useRef } from 'react';
import ImageEditorModal from './ImageEditorModal';
import LayoutSelector from './LayoutSelector';
import LayoutPreviewKonva from './LayoutPreviewKonva';
import StatusMessage from './ui/StatusMessage';
import { getLayoutsByPanelCount } from '../data/layoutTemplates';
import { generatePage as requestGeneratePage, generatePanel as requestGeneratePanel, saveAsset } from '../lib/api.mjs';
import {
    fetchAssetAsDataUrl,
    getDisplayImageSrc,
    inlineImageToSavePayload,
    isInlineImageResult,
    isPersistedAsset,
} from '../lib/assets.mjs';
import { parseStoryboardResult } from '../lib/results.mjs';

const fallbackDefaults = {
    artStyle: 'storybook_classic',
    aspectRatio: 'portrait',
    colorMode: 'bw',
    genMode: 'storyboard',
    textDensity: 'dialog_fx',
};

const CreatorView = ({ aiDefaults, library, onRefresh, initialData, projectId, onUsageUpdate, appMode, onSyncToPlanner, onNotify }) => {
    const mergedDefaults = { ...fallbackDefaults, ...(aiDefaults || {}) };
    const [story, setStory] = useState('');
    const [panels, setPanels] = useState(3);
    const [selectedRefs, setSelectedRefs] = useState([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [result, setResult] = useState(null);
    const [genMode, setGenMode] = useState(mergedDefaults.genMode === 'full' ? 'storyboard' : mergedDefaults.genMode);
    const [panelImages, setPanelImages] = useState({});
    const [drawingPanels, setDrawingPanels] = useState({});
    const [isAssembling, setIsAssembling] = useState(false);
    const [colorMode, setColorMode] = useState(mergedDefaults.colorMode);
    const [textDensity, setTextDensity] = useState(mergedDefaults.textDensity);
    const [aspectRatio, setAspectRatio] = useState(mergedDefaults.aspectRatio);
    const [artStyle, setArtStyle] = useState(mergedDefaults.artStyle);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editingImage, setEditingImage] = useState(null);
    const [editingPanelIndex, setEditingPanelIndex] = useState(null);
    const mainUploadRef = useRef(null);
    const panelUploadRefs = useRef({});
    const [linkedPageIndex, setLinkedPageIndex] = useState(null);
    const [selectedLayout, setSelectedLayout] = useState(null);
    const [panelPositions, setPanelPositions] = useState({});
    const [isLayoutSelectorOpen, setIsLayoutSelectorOpen] = useState(false);
    const [gutterColor, setGutterColor] = useState('#000000');
    const [gutterWidth, setGutterWidth] = useState(4);
    const [showLayoutPreview, setShowLayoutPreview] = useState(false);
    const layoutStageRef = useRef(null);
    const [layoutStageSize, setLayoutStageSize] = useState({ width: 0, height: 0 });
    const [hasMigratedOffsetsToKonva, setHasMigratedOffsetsToKonva] = useState(false);
    const [panelSettings, setPanelSettings] = useState({});
    const [assembledPreview, setAssembledPreview] = useState(null);
    const [showAssemblyConfirm, setShowAssemblyConfirm] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [statusTone, setStatusTone] = useState('error');
    const [allowIncompleteAssembly, setAllowIncompleteAssembly] = useState(false);

    useEffect(() => {
        if (initialData) {
            const incomingSettings = initialData.generationSettings || {};
            const matchedUrls = [];

            setStory(initialData.pageContent || '');
            setPanels(initialData.panelCount || 3);
            setLinkedPageIndex(initialData.pageIndex !== undefined ? initialData.pageIndex : null);
            setResult(initialData.generatedResult || initialData.generatedAsset || null);
            setPanelImages({});
            setPanelSettings({});
            setSelectedLayout(null);
            setPanelPositions({});
            setShowLayoutPreview(false);
            setShowAssemblyConfirm(false);
            setAssembledPreview(null);
            setAllowIncompleteAssembly(false);
            setHasMigratedOffsetsToKonva(false);
            setStatusMessage('');
            setGenMode(incomingSettings.genMode || (mergedDefaults.genMode === 'full' ? 'storyboard' : mergedDefaults.genMode));
            setColorMode(incomingSettings.colorMode || mergedDefaults.colorMode);
            setTextDensity(incomingSettings.textDensity || mergedDefaults.textDensity);
            setAspectRatio(incomingSettings.aspectRatio || mergedDefaults.aspectRatio);
            setArtStyle(incomingSettings.artStyle || mergedDefaults.artStyle);

            if (initialData.suggestedReferences) {
                [...library.characters, ...library.locations, ...library.style].forEach((item) => {
                    const matchTerms = [item.name, item.displayName, item.role].filter(Boolean);
                    if (initialData.suggestedReferences.some((ref) => matchTerms.some((term) => ref.includes(term)))) {
                        matchedUrls.push(item.url);
                    }
                });
            }

            setSelectedRefs(matchedUrls);
        }
    }, [initialData, library, aiDefaults]);

    useEffect(() => {
        if (initialData) {
            return;
        }

        setGenMode(mergedDefaults.genMode === 'full' ? 'storyboard' : mergedDefaults.genMode);
        setColorMode(mergedDefaults.colorMode);
        setTextDensity(mergedDefaults.textDensity);
        setAspectRatio(mergedDefaults.aspectRatio);
        setArtStyle(mergedDefaults.artStyle);
    }, [aiDefaults]);

    const toggleReference = (url) => {
        if (selectedRefs.includes(url)) {
            setSelectedRefs(selectedRefs.filter((reference) => reference !== url));
        } else {
            setSelectedRefs([...selectedRefs, url]);
        }
    };

    const setStatus = (message, tone = 'error', title = null) => {
        setStatusMessage(message);
        setStatusTone(tone);
        if (title) {
            onNotify?.({ message, title, type: tone === 'warning' ? 'error' : tone });
        }
    };

    const buildCurrentPagePatch = (overrides = {}) => ({
        pageContent: overrides.pageContent ?? story,
        panelCount: overrides.panelCount ?? panels,
        generationSettings: {
            genMode,
            colorMode,
            textDensity,
            aspectRatio,
            artStyle,
            ...(overrides.generationSettings || {}),
        },
    });

    const syncToPlanner = async ({ imageResult = null, pagePatch = buildCurrentPagePatch() } = {}) => {
        if (linkedPageIndex === null || !onSyncToPlanner) {
            return null;
        }

        if (imageResult && !isInlineImageResult(imageResult) && !isPersistedAsset(imageResult)) {
            return null;
        }

        try {
            return await onSyncToPlanner(linkedPageIndex, { imageResult, pagePatch });
        } catch (error) {
            setStatus(error.message, 'error', 'Planner Sync Failed');
            return null;
        }
    };

    const syncLinkedDraft = async (overrides = {}) => (
        syncToPlanner({ pagePatch: buildCurrentPagePatch(overrides) })
    );

    const handleStoryBlur = async () => {
        await syncLinkedDraft({ pageContent: story });
    };

    const handlePanelsChange = async (value) => {
        setPanels(value);
        await syncLinkedDraft({ panelCount: value });
    };

    const handleGenerationSettingChange = async (field, value) => {
        const setters = {
            genMode: setGenMode,
            colorMode: setColorMode,
            textDensity: setTextDensity,
            aspectRatio: setAspectRatio,
            artStyle: setArtStyle,
        };

        setters[field]?.(value);
        await syncLinkedDraft({ generationSettings: { [field]: value } });
    };

    const loadSelectedReferenceImages = async () => Promise.all(
        selectedRefs.map(async (url) => ({
            name: url.split('/').pop(),
            data: await fetchAssetAsDataUrl(url),
        }))
    );

    const handleGenerate = async () => {
        if (!story.trim()) {
            setStatus('Please enter a story snippet.');
            return;
        }

        setIsGenerating(true);
        setResult(null);
        setStatusMessage('');

        try {
            await syncLinkedDraft();
            const referenceImages = await loadSelectedReferenceImages();
            const data = await requestGeneratePage({
                prompt: story,
                references: referenceImages,
                panels,
                mode: genMode,
                projectId,
                colorMode,
                textDensity,
                appMode,
                aspectRatio,
                artStyle,
            });

            if (onUsageUpdate) onUsageUpdate(data.route, data.usage);

            setResult(data.result);
            setPanelImages({});
            setAllowIncompleteAssembly(false);

            if (data.result?.type === 'image') {
                await syncToPlanner({ imageResult: data.result, pagePatch: buildCurrentPagePatch() });
            } else {
                await syncLinkedDraft();
            }
        } catch (error) {
            setStatus(error.message, 'error', 'Generation Failed');
        } finally {
            setIsGenerating(false);
        }
    };

    const updatePanelSetting = (panelIndex, setting, value) => {
        setPanelSettings((prev) => ({
            ...prev,
            [panelIndex]: {
                ...prev[panelIndex],
                [setting]: value,
            },
        }));
    };

    const getPanelSetting = (panelIndex, setting) => {
        const panelSetting = panelSettings[panelIndex]?.[setting];
        if (panelSetting !== undefined) return panelSetting;
        switch (setting) {
            case 'colorMode': return colorMode;
            case 'aspectRatio': return aspectRatio;
            default: return null;
        }
    };

    const handleDrawPanel = async (panelIndex, panelData) => {
        setDrawingPanels((prev) => ({ ...prev, [panelIndex]: true }));
        setStatusMessage('');
        try {
            const referenceImages = await loadSelectedReferenceImages();
            const panelColorMode = getPanelSetting(panelIndex, 'colorMode');
            const panelAspectRatio = getPanelSetting(panelIndex, 'aspectRatio');

            const data = await requestGeneratePanel({
                panel: panelData,
                references: referenceImages,
                projectId,
                colorMode: panelColorMode,
                textDensity,
                aspectRatio: panelAspectRatio,
            });

            if (onUsageUpdate) onUsageUpdate(data.route, data.usage);

            if (data.result && data.result.type === 'image') {
                setPanelImages((prev) => ({ ...prev, [panelIndex]: data.result }));
                setAllowIncompleteAssembly(false);
            } else {
                setStatus('Panel generation did not return an image.', 'error', 'Panel Generation Failed');
            }
        } catch (error) {
            setStatus(error.message, 'error', 'Panel Generation Failed');
        } finally {
            setDrawingPanels((prev) => ({ ...prev, [panelIndex]: false }));
        }
    };

    const handleAssemblePage = async () => {
        const parsedResult = getParsedResult();
        const panelsCount = parsedResult?.panels?.length || 0;
        const drawnPanelsCount = Object.keys(panelImages).length;

        if (!selectedLayout) {
            setStatus('Please select a layout first.');
            return;
        }

        if (!layoutStageRef.current || !layoutStageSize.width) {
            setStatus('Open Layout Preview mode first to assemble the page.');
            return;
        }

        if (drawnPanelsCount < panelsCount && !allowIncompleteAssembly) {
            setAllowIncompleteAssembly(true);
            setStatus(`Only ${drawnPanelsCount} of ${panelsCount} panels are ready. Click assemble again to continue anyway.`, 'warning');
            return;
        }

        setAllowIncompleteAssembly(false);
        setIsAssembling(true);
        try {
            const pixelRatio = 800 / layoutStageSize.width;
            const panelNumbers = layoutStageRef.current.find('.panelNumber');
            panelNumbers.forEach((node) => node.hide());
            const assembledData = layoutStageRef.current.toDataURL({ pixelRatio });
            panelNumbers.forEach((node) => node.show());
            setAssembledPreview(assembledData);
            setShowAssemblyConfirm(true);
            setStatusMessage('');
        } catch (error) {
            console.error('Assembly failed:', error);
            setStatus(error.message, 'error', 'Assembly Failed');
        } finally {
            setIsAssembling(false);
        }
    };

    const handleAcceptAssembly = async () => {
        if (!assembledPreview) return;

        const assembledResult = {
            type: 'image',
            data: assembledPreview.split(',')[1],
            mimeType: 'image/png',
        };

        setResult(assembledResult);
        setShowLayoutPreview(false);
        setShowAssemblyConfirm(false);
        setAssembledPreview(null);
        await syncToPlanner({ imageResult: assembledResult, pagePatch: buildCurrentPagePatch() });
    };

    const handleRejectAssembly = () => {
        setShowAssemblyConfirm(false);
        setAssembledPreview(null);
    };

    const saveImageToLibrary = async (filename, imageSource) => {
        if (!imageSource) {
            setStatus('Only image outputs can be saved.');
            return;
        }

        try {
            const { dataUrl } = await inlineImageToSavePayload(imageSource);
            await saveAsset({
                bucket: 'pages',
                filename,
                imageData: dataUrl,
                projectId,
            });
            setStatus(`Saved ${filename} to the project library.`, 'success');
            onNotify?.({ message: `${filename} saved.`, title: 'Asset Saved', type: 'success' });
            await onRefresh?.();
        } catch (error) {
            setStatus(error.message, 'error', 'Save Failed');
        }
    };

    const handleSavePage = async () => {
        if (!result) return;
        await saveImageToLibrary(`page_${Date.now()}.png`, result);
    };

    const handleSavePanel = async (index) => {
        const panelImage = panelImages[index];
        if (!panelImage) return;
        await saveImageToLibrary(`panel_${index}_${Date.now()}.png`, panelImage);
    };

    const handleMainImageUpload = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (loadEvent) => {
            const dataUrl = loadEvent.target.result;
            const uploadedResult = {
                type: 'image',
                data: dataUrl.split(',')[1],
                mimeType: file.type || 'image/png',
            };
            setResult(uploadedResult);
            setPanelImages({});
            setAllowIncompleteAssembly(false);
            await syncToPlanner({ imageResult: uploadedResult, pagePatch: buildCurrentPagePatch() });
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    };

    const handlePanelImageUpload = (panelIndex, event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            const dataUrl = loadEvent.target.result;
            setPanelImages((prev) => ({
                ...prev,
                [panelIndex]: {
                    type: 'image',
                    data: dataUrl.split(',')[1],
                    mimeType: file.type || 'image/png',
                },
            }));
            setAllowIncompleteAssembly(false);
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    };

    // Handle scale change for a panel
    const handlePanelScaleChange = (panelIndex, newScale) => {
        setPanelPositions(prev => ({
            ...prev,
            [panelIndex]: {
                ...prev[panelIndex],
                offsetX: prev[panelIndex]?.offsetX || 0,
                offsetY: prev[panelIndex]?.offsetY || 0,
                scale: newScale
            }
        }));
    };

    // If the user has offsets from the legacy CSS preview, convert them once into Konva's
    // canonical coordinate space (800x1200) when we know the preview stage size.
    useEffect(() => {
        if (!showLayoutPreview) return;
        if (hasMigratedOffsetsToKonva) return;
        if (!layoutStageSize.width) return;
        if (!panelPositions || Object.keys(panelPositions).length === 0) {
            setHasMigratedOffsetsToKonva(true);
            return;
        }

        // Legacy preview applied offsets as (offset/8) in preview pixels.
        // Konva applies offsets directly in 800x1200 units. Convert so on-screen position stays similar:
        // newOffset * (stageW/800) ~= oldOffset/8  =>  newOffset ~= oldOffset * (800 / (8*stageW))
        const factor = 800 / (8 * layoutStageSize.width);
        setPanelPositions(prev => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(prev)) {
                const idx = Number(k);
                if (!Number.isFinite(idx) || !v) continue;
                next[idx] = {
                    ...v,
                    offsetX: (v.offsetX || 0) * factor,
                    offsetY: (v.offsetY || 0) * factor,
                    scale: v.scale || 1
                };
            }
            return next;
        });
        setHasMigratedOffsetsToKonva(true);
    }, [showLayoutPreview, hasMigratedOffsetsToKonva, layoutStageSize.width, panelPositions, setPanelPositions]);

    // Helper to parse result (handles both string JSON and object)
    const getParsedResult = () => parseStoryboardResult(result);

    // Render the live layout preview with draggable panels
    const renderLayoutPreview = () => {
        const parsedResult = getParsedResult();
        if (!selectedLayout || !parsedResult?.panels) return null;

        const panelsCount = Math.min(parsedResult.panels.length, selectedLayout.panels.length);

        return (
            <div className="layout-preview-container">
                <div className="layout-preview-header">
                    <h4>Layout Preview</h4>
                    <p>Drag panels to reposition, use controls to adjust size</p>
                </div>

                <div className="layout-preview-controls">
                    <div className="control-group">
                        <label>Divider Color</label>
                        <div className="color-picker-row">
                            <input
                                type="color"
                                value={gutterColor}
                                onChange={(e) => setGutterColor(e.target.value)}
                                className="color-input"
                            />
                            <div className="color-presets">
                                {['#000000', '#FFFFFF', '#1a1a2e', '#ff6b6b', '#4ecdc4', '#ffe66d'].map(color => (
                                    <button
                                        key={color}
                                        className={`color-preset ${gutterColor === color ? 'active' : ''}`}
                                        style={{ backgroundColor: color }}
                                        onClick={() => setGutterColor(color)}
                                        title={color}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="control-group">
                        <label>Divider Width: {gutterWidth}px</label>
                        <input
                            type="range"
                            min="0"
                            max="12"
                            value={gutterWidth}
                            onChange={(e) => setGutterWidth(Number(e.target.value))}
                            className="range-input"
                        />
                    </div>
                </div>

                {/* Per-panel scale controls */}
                <div className="panel-scale-controls">
                    <label>Panel Sizing</label>
                    <div className="panel-scale-grid">
                        {selectedLayout.panels.slice(0, panelsCount).map((_, i) => {
                            const currentScale = panelPositions[i]?.scale || 1;
                            const hasImage = !!panelImages[i];
                            return (
                                <div key={i} className={`panel-scale-item ${!hasImage ? 'disabled' : ''}`}>
                                    <span className="panel-scale-label">Panel {i + 1}</span>
                                    <div className="panel-scale-slider">
                                        <button
                                            className="scale-btn"
                                            onClick={() => handlePanelScaleChange(i, Math.max(0.2, currentScale - 0.1))}
                                            disabled={!hasImage}
                                        >-</button>
                                        <input
                                            type="range"
                                            min="0.2"
                                            max="2"
                                            step="0.05"
                                            value={currentScale}
                                            onChange={(e) => handlePanelScaleChange(i, parseFloat(e.target.value))}
                                            disabled={!hasImage}
                                            className="scale-range"
                                        />
                                        <button
                                            className="scale-btn"
                                            onClick={() => handlePanelScaleChange(i, Math.min(2, currentScale + 0.1))}
                                            disabled={!hasImage}
                                        >+</button>
                                        <span className="scale-value">{Math.round(currentScale * 100)}%</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <LayoutPreviewKonva
                    selectedLayout={selectedLayout}
                    panelsCount={panelsCount}
                    panelImages={panelImages}
                    panelPositions={panelPositions}
                    setPanelPositions={setPanelPositions}
                    gutterColor={gutterColor}
                    gutterWidth={gutterWidth}
                    stageRef={layoutStageRef}
                    onStageSizeChange={setLayoutStageSize}
                />

                <div className="layout-preview-actions">
                    <button
                        className="btn-secondary"
                        onClick={() => setPanelPositions({})}
                    >
                        Reset All
                    </button>
                    <button
                        className="btn-primary"
                        onClick={handleAssemblePage}
                        disabled={isAssembling || Object.keys(panelImages).length === 0}
                    >
                        {isAssembling ? 'Finalizing...' : 'Finalize Page'}
                    </button>
                </div>
            </div>
        );
    };

    const renderResult = () => {
        if (!result) return null;

        const imageSrc = getDisplayImageSrc(result);
        if (imageSrc) {
            return (
                <div className="preview-content animate-in">
                    <div className="storyboard-header">
                        <div>
                            <h3 className="heading-font" style={{ color: 'var(--accent)', fontSize: '1.4rem' }}>
                                {appMode === 'storybook' ? 'Generated Illustration' : 'Generated Manga Page'}
                            </h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
                                Generated with the configured image route
                            </p>
                        </div>
                        <button className="tab-btn" onClick={handleSavePage} style={{ background: 'var(--accent)', color: 'white', border: 'none' }}>
                            Save to Project Library
                        </button>
                    </div>
                    <div className="full-page-preview image-hover-container">
                        <img
                            src={imageSrc}
                            alt="Generated Manga Page"
                            style={{ width: '100%', borderRadius: 'var(--radius-md)', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
                        />
                        <div className="image-overlay-actions">
                            <button className="action-pill save" onClick={handleSavePage}>Save</button>
                            <button className="action-pill edit" onClick={() => {
                                setEditingImage(imageSrc);
                                setEditingPanelIndex(-1);
                                setIsEditorOpen(true);
                            }}>Edit</button>
                            <button className="action-pill regen" onClick={handleGenerate}>Regenerate</button>
                            <button className="action-pill upload" onClick={() => mainUploadRef.current?.click()}>Upload</button>
                        </div>
                    </div>
                </div>
            );
        }

        const data = parseStoryboardResult(result);
        if (!data) {
            return <div className="ai-output-box">{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</div>;
        }

        if (data && data.panels) {
            return (
                <div className="preview-content animate-in">
                    <div className="storyboard-header">
                        <div>
                            <h3 className="heading-font" style={{ color: 'var(--accent)', fontSize: '1.4rem' }}>
                                {data.title || 'Manga Storyboard Blueprint'}
                            </h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
                                {data.summary || 'Generated narrative blueprint'}
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <button
                                className="tab-btn"
                                onClick={() => setIsLayoutSelectorOpen(true)}
                                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}
                            >
                                {selectedLayout ? `Layout: ${selectedLayout.name}` : 'Select Layout'}
                            </button>
                            {selectedLayout && Object.keys(panelImages).length > 0 && (
                                <button
                                    className={`tab-btn ${showLayoutPreview ? 'active' : ''}`}
                                    onClick={() => setShowLayoutPreview(!showLayoutPreview)}
                                    style={{
                                        background: showLayoutPreview ? 'var(--accent)' : 'var(--bg-tertiary)',
                                        color: showLayoutPreview ? 'white' : 'var(--text)',
                                        border: '1px solid var(--border)'
                                    }}
                                >
                                    {showLayoutPreview ? 'Hide Preview' : 'Preview Layout'}
                                </button>
                            )}
                            {!showLayoutPreview && (
                                <button
                                    className="tab-btn"
                                    onClick={handleAssemblePage}
                                    disabled={isAssembling || Object.keys(panelImages).length === 0}
                                    style={{ background: 'var(--accent-secondary)', color: 'white', border: 'none' }}
                                >
                                    {isAssembling ? 'Assembling...' : 'Assemble Final Page'}
                                </button>
                            )}
                            <button className="tab-btn" onClick={handleSavePage} style={{ background: 'var(--accent)', color: 'white', border: 'none' }}>
                                Save to Library
                            </button>
                        </div>
                    </div>

                    {/* Layout info banner */}
                    {selectedLayout && !showLayoutPreview && (
                        <div className="layout-info-banner">
                            <span>Using <strong>{selectedLayout.name}</strong> layout</span>
                            <button
                                className="layout-change-btn"
                                onClick={() => setIsLayoutSelectorOpen(true)}
                            >
                                Change
                            </button>
                        </div>
                    )}

                    {/* Live Layout Preview Mode */}
                    {showLayoutPreview && renderLayoutPreview()}

                    {/* Panel Cards Grid */}
                    {!showLayoutPreview && <div className="storyboard-grid">
                        {data.panels.map((panel, i) => (
                            <div key={i} className="panel-card animate-in" style={{ animationDelay: `${i * 0.1}s` }}>
                                {/* Per-panel settings row */}
                                <div className="panel-settings-row">
                                    <select
                                        className="panel-setting-select"
                                        value={getPanelSetting(i, 'colorMode')}
                                        onChange={(e) => updatePanelSetting(i, 'colorMode', e.target.value)}
                                        title="Color Mode"
                                    >
                                        <option value="bw">B&W</option>
                                        <option value="color">Color</option>
                                    </select>
                                    <select
                                        className="panel-setting-select"
                                        value={getPanelSetting(i, 'aspectRatio')}
                                        onChange={(e) => updatePanelSetting(i, 'aspectRatio', e.target.value)}
                                        title="Aspect Ratio"
                                    >
                                        <option value="portrait">2:3</option>
                                        <option value="landscape">3:2</option>
                                        <option value="square">1:1</option>
                                        <option value="3:4">3:4</option>
                                        <option value="cinematic">16:9</option>
                                    </select>
                                </div>
                                <div className="panel-visual-area">
                                    <div className="panel-number-badge">{panel.panelNumber}</div>
                                    <div className="panel-layout-badge">{panel.layout}</div>

                                    {panelImages[i] ? (
                                        <div className="image-hover-container" style={{ width: '100%', height: '100%' }}>
                                            <img
                                                src={`data:${panelImages[i].mimeType};base64,${panelImages[i].data}`}
                                                alt={`Panel ${i + 1}`}
                                                style={{
                                                    width: '100%',
                                                    height: '100%',
                                                    objectFit: 'cover',
                                                    objectPosition: `${50 + (panelPositions[i]?.offsetX || 0) / 5}% ${50 + (panelPositions[i]?.offsetY || 0) / 5}%`
                                                }}
                                            />
                                            <div className="image-overlay-actions mini">
                                                <button className="action-pill save" onClick={() => handleSavePanel(i)}>Save</button>
                                                <button className="action-pill edit" onClick={() => {
                                                    setEditingImage(`data:${panelImages[i].mimeType};base64,${panelImages[i].data}`);
                                                    setEditingPanelIndex(i);
                                                    setIsEditorOpen(true);
                                                }}>Edit</button>
                                                <button className="action-pill regen" onClick={() => handleDrawPanel(i, data.panels[i])}>Regen</button>
                                                <button className="action-pill upload" onClick={() => panelUploadRefs.current[i]?.click()}>Upload</button>
                                            </div>
                                            {/* Position adjustment controls - shown when layout is selected */}
                                            {selectedLayout && (
                                                <div className="panel-position-controls">
                                                    <button
                                                        className="pos-btn up"
                                                        onClick={() => setPanelPositions(prev => ({
                                                            ...prev,
                                                            [i]: {
                                                                offsetX: prev[i]?.offsetX || 0,
                                                                offsetY: (prev[i]?.offsetY || 0) - 20
                                                            }
                                                        }))}
                                                        title="Move up"
                                                    >^</button>
                                                    <div className="pos-btn-row">
                                                        <button
                                                            className="pos-btn left"
                                                            onClick={() => setPanelPositions(prev => ({
                                                                ...prev,
                                                                [i]: {
                                                                    offsetX: (prev[i]?.offsetX || 0) - 20,
                                                                    offsetY: prev[i]?.offsetY || 0
                                                                }
                                                            }))}
                                                            title="Move left"
                                                        >&lt;</button>
                                                        <button
                                                            className="pos-btn reset"
                                                            onClick={() => setPanelPositions(prev => ({
                                                                ...prev,
                                                                [i]: { offsetX: 0, offsetY: 0 }
                                                            }))}
                                                            title="Reset position"
                                                        >R</button>
                                                        <button
                                                            className="pos-btn right"
                                                            onClick={() => setPanelPositions(prev => ({
                                                                ...prev,
                                                                [i]: {
                                                                    offsetX: (prev[i]?.offsetX || 0) + 20,
                                                                    offsetY: prev[i]?.offsetY || 0
                                                                }
                                                            }))}
                                                            title="Move right"
                                                        >&gt;</button>
                                                    </div>
                                                    <button
                                                        className="pos-btn down"
                                                        onClick={() => setPanelPositions(prev => ({
                                                            ...prev,
                                                            [i]: {
                                                                offsetX: prev[i]?.offsetX || 0,
                                                                offsetY: (prev[i]?.offsetY || 0) + 20
                                                            }
                                                        }))}
                                                        title="Move down"
                                                    >v</button>
                                                </div>
                                            )}
                                            <input
                                                ref={el => panelUploadRefs.current[i] = el}
                                                type="file"
                                                accept="image/*"
                                                onChange={(e) => handlePanelImageUpload(i, e)}
                                                style={{ display: 'none' }}
                                            />
                                        </div>
                                    ) : (
                                        <div className="panel-visual-placeholder">
                                            {drawingPanels[i] ? <div className="loader small"></div> : '...'}
                                        </div>
                                    )}

                                    {!panelImages[i] && !drawingPanels[i] && (
                                        <div className="panel-action-buttons">
                                            <button
                                                className="draw-panel-btn"
                                                onClick={() => handleDrawPanel(i, panel)}
                                                title="Draw this panel"
                                            >
                                                Draw Art
                                            </button>
                                            <button
                                                className="upload-panel-btn"
                                                onClick={() => panelUploadRefs.current[i]?.click()}
                                                title="Upload image for this panel"
                                            >
                                                Upload
                                            </button>
                                            <input
                                                ref={el => panelUploadRefs.current[i] = el}
                                                type="file"
                                                accept="image/*"
                                                onChange={(e) => handlePanelImageUpload(i, e)}
                                                style={{ display: 'none' }}
                                            />
                                        </div>
                                    )}

                                    <div style={{ position: 'absolute', bottom: '10px', right: '10px', display: 'flex', gap: '5px' }}>
                                        {(panel.characters || []).map((char, ci) => (
                                            <span key={ci} className="tag" style={{ background: 'rgba(0,0,0,0.7)', border: 'none' }}>
                                                {char}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="panel-details">
                                    <div className="panel-composition">
                                        {panel.composition}
                                    </div>
                                    {panel.dialogue && (
                                        <div className="panel-dialogue">
                                            "{panel.dialogue}"
                                        </div>
                                    )}
                                    {(panel.fx || panel.characters?.length > 0) && (
                                        <div className="panel-meta">
                                            {panel.fx && <span className="tag accent">FX: {panel.fx}</span>}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>}

                </div>
            );
        }

        return <div className="ai-output-box">{JSON.stringify(data, null, 2)}</div>;
    };

    return (
        <div className="creator-layout animate-in">
            <aside className="sidebar-panel">
                <div className="field-group">
                    <label className="field-label">Story Content</label>
                    <textarea
                        className="input-glass"
                        placeholder="Draft your manga sequence..."
                        style={{ height: '220px' }}
                        value={story}
                        onChange={(e) => setStory(e.target.value)}
                        onBlur={handleStoryBlur}
                    />
                </div>

                <div className="field-group">
                    <label className="field-label">Reference Materials</label>
                    <div className="reference-shelf">
                        {[...library.characters, ...library.locations, ...library.style]
                            .filter(item => item.type === 'image')
                            .map((item, i) => (
                                <div
                                    key={i}
                                    onClick={() => toggleReference(item.url)}
                                    className={`ref-item ${selectedRefs.includes(item.url) ? 'selected' : ''}`}
                                >
                                    <img src={item.url} alt={item.name} />
                                    {selectedRefs.includes(item.url) && (
                                        <div className="ref-check">OK</div>
                                    )}
                                </div>
                            ))
                        }
                        {library.characters.length === 0 && library.locations.length === 0 && library.style.length === 0 && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                No archives detected
                            </div>
                        )}
                    </div>
                </div>

                {appMode !== 'storybook' && (
                    <div className="field-group">
                        <label className="field-label">Generation Mode</label>
                        <select
                            className="input-glass"
                            value={genMode}
                            onChange={(e) => handleGenerationSettingChange('genMode', e.target.value)}
                        >
                            <option value="storyboard">Storyboard</option>
                            <option value="full">Full Page Generation</option>
                        </select>
                    </div>
                )}

                <div className="field-group">
                    <label className="field-label">Color Mode</label>
                    <select
                        className="input-glass"
                        value={colorMode}
                        onChange={(e) => handleGenerationSettingChange('colorMode', e.target.value)}
                    >
                        <option value="bw">Black & White</option>
                        <option value="color">Full Color</option>
                    </select>
                </div>

                <div className="field-group">
                    <label className="field-label">Aspect Ratio</label>
                    <select
                        className="input-glass"
                        value={['portrait', 'landscape', 'square', 'cinematic', '3:4'].includes(aspectRatio) ? aspectRatio : 'custom'}
                        onChange={(e) => {
                            const val = e.target.value;
                            const nextValue = val === 'custom' ? '' : val;
                            handleGenerationSettingChange('aspectRatio', nextValue);
                        }}
                    >
                        <option value="portrait">Standard Manga (2:3)</option>
                        <option value="landscape">Landscape (3:2)</option>
                        <option value="square">Square (1:1)</option>
                        <option value="3:4">Book Portrait (3:4)</option>
                        <option value="cinematic">Cinematic (16:9)</option>
                        <option value="custom">Custom / Resolution...</option>
                    </select>
                    {!['portrait', 'landscape', 'square', 'cinematic', '3:4'].includes(aspectRatio) && (
                        <input
                            type="text"
                            className="input-glass"
                            style={{ marginTop: '8px' }}
                            placeholder="e.g. 1024x1024 or 21:9"
                            value={aspectRatio}
                            onChange={(e) => setAspectRatio(e.target.value)}
                            onBlur={() => syncLinkedDraft({ generationSettings: { aspectRatio } })}
                        />
                    )}
                </div>

                {appMode === 'storybook' && (
                    <>

                        <div className="field-group">
                            <label className="field-label">Art Style</label>
                            <select
                                className="input-glass"
                                value={artStyle}
                                onChange={(e) => handleGenerationSettingChange('artStyle', e.target.value)}
                            >
                                <option value="storybook_classic">Classic Storybook</option>
                                <option value="watercolor">Watercolor</option>
                                <option value="oil_painting">Oil Painting</option>
                                <option value="digital_illustration">Digital Illustration</option>
                                <option value="anime">Anime</option>
                                <option value="realistic">Realistic</option>
                            </select>
                        </div>
                    </>
                )}

                {appMode !== 'storybook' && genMode !== 'storybook' && (
                    <>
                        <div className="field-group">
                            <label className="field-label">Windows</label>
                            <select
                                className="input-glass"
                                value={panels}
                                onChange={(e) => handlePanelsChange(Number(e.target.value))}
                            >
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n} Panels</option>)}
                            </select>
                        </div>

                        <div className="field-group">
                            <label className="field-label">Text Density</label>
                            <select
                                className="input-glass"
                                value={textDensity}
                                onChange={(e) => handleGenerationSettingChange('textDensity', e.target.value)}
                            >
                                <option value="minimal">Minimal (Visual Only)</option>
                                <option value="dialog">Dialog Only</option>
                                <option value="dialog_fx">Dialog & Effects</option>
                                <option value="dialog_fx_narration">Dialog, Effects & Narration</option>
                                <option value="full">Full (Dialog, FX, Narration, Explanation)</option>
                            </select>
                        </div>
                    </>
                )}

                <StatusMessage message={statusMessage} tone={statusTone} />

                <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="btn-primary"
                        style={{ flex: 1 }}
                    >
                        {isGenerating ? 'Drawing...' : appMode === 'storybook' ? 'Generate Illustration' : (genMode === 'storybook' ? 'Generate Illustration' : 'Generate Page')}
                    </button>
                    <button
                        onClick={() => mainUploadRef.current?.click()}
                        className="btn-secondary"
                        style={{ flex: 0, padding: '0 15px' }}
                        title="Upload an image instead of generating"
                    >
                        Upload
                    </button>
                    <input
                        ref={mainUploadRef}
                        type="file"
                        accept="image/*"
                        onChange={handleMainImageUpload}
                        style={{ display: 'none' }}
                    />
                </div>
            </aside>

            <section className="preview-container">
                {!result && !isGenerating && (
                    <div className="preview-placeholder">
                        <div style={{ fontSize: '3rem', opacity: 0.2 }}>...</div>
                        <p>Awaiting your artistic vision</p>
                    </div>
                )}

                {isGenerating && (
                    <div className="preview-placeholder">
                        <div className="loader"></div>
                        <p style={{ marginTop: '10px' }}>Synthesizing Storyboard...</p>
                    </div>
                )}

                {result && renderResult()}
            </section>

            <ImageEditorModal
                isOpen={isEditorOpen}
                onClose={() => setIsEditorOpen(false)}
                imageData={editingImage}
                projectId={projectId}
                onNotify={onNotify}
                onSaveEdit={async (newImage) => {
                    if (editingPanelIndex === -1) {
                        setResult(newImage);
                        await syncToPlanner({ imageResult: newImage, pagePatch: buildCurrentPagePatch() });
                    } else {
                        setPanelImages((prev) => ({ ...prev, [editingPanelIndex]: newImage }));
                        setAllowIncompleteAssembly(false);
                    }
                }}
            />

            {/* Assembly Confirmation Modal */}
            {showAssemblyConfirm && assembledPreview && (
                <div className="modal-overlay" style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.85)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div className="assembly-confirm-modal" style={{
                        background: 'var(--bg-secondary)',
                        borderRadius: 'var(--radius-lg)',
                        padding: '24px',
                        maxWidth: '90vw',
                        maxHeight: '90vh',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '16px'
                    }}>
                        <h3 style={{ color: 'var(--accent)', margin: 0 }}>Preview Assembled Page</h3>
                        <p style={{ color: 'var(--text-muted)', margin: 0 }}>
                            Review the assembled page. Accept to finalize or go back to make adjustments.
                        </p>
                        <div style={{
                            flex: 1,
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            overflow: 'auto'
                        }}>
                            <img
                                src={assembledPreview}
                                alt="Assembled Page Preview"
                                style={{
                                    maxWidth: '100%',
                                    maxHeight: '60vh',
                                    objectFit: 'contain',
                                    borderRadius: 'var(--radius-md)',
                                    border: '2px solid var(--border)'
                                }}
                            />
                        </div>
                        <div style={{
                            display: 'flex',
                            gap: '12px',
                            justifyContent: 'center'
                        }}>
                            <button
                                className="btn-secondary"
                                onClick={handleRejectAssembly}
                                style={{ padding: '12px 24px' }}
                            >
                                Go Back & Adjust
                            </button>
                            <button
                                className="btn-primary"
                                onClick={handleAcceptAssembly}
                                style={{ padding: '12px 24px' }}
                            >
                                Accept & Finalize
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <LayoutSelector
                isOpen={isLayoutSelectorOpen}
                onClose={() => setIsLayoutSelectorOpen(false)}
                panelCount={result?.panels?.length || panels}
                selectedLayoutId={selectedLayout?.id}
                onSelectLayout={(layout) => {
                    setSelectedLayout(layout);
                    // Reset panel positions when layout changes
                    setPanelPositions({});
                }}
            />
        </div>
    );
};

export default CreatorView;
