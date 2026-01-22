import React, { useState, useEffect } from 'react';
import ImageEditorModal from './ImageEditorModal';

const CreatorView = ({ library, onRefresh, initialData, onClearInitialData, projectId, onUsageUpdate, appMode }) => {
    const [story, setStory] = useState('');
    const [panels, setPanels] = useState(3);
    const [selectedRefs, setSelectedRefs] = useState([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [result, setResult] = useState(null);
    const [engine, setEngine] = useState('flash');
    const [genMode, setGenMode] = useState('storyboard');
    const [panelImages, setPanelImages] = useState({});
    const [drawingPanels, setDrawingPanels] = useState({});
    const [isAssembling, setIsAssembling] = useState(false);
    const [colorMode, setColorMode] = useState('bw');
    const [textDensity, setTextDensity] = useState('dialog_fx');
    // Storybook-specific settings
    const [aspectRatio, setAspectRatio] = useState('portrait');
    const [artStyle, setArtStyle] = useState('storybook_classic');
    // Editor State
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editingImage, setEditingImage] = useState(null);
    const [editingPanelIndex, setEditingPanelIndex] = useState(null);

    // Handle incoming data from Story Planner
    useEffect(() => {
        if (initialData) {
            setStory(initialData.pageContent || '');
            setPanels(initialData.panelCount || 3);

            // Match suggested reference names to local library URLs
            if (initialData.suggestedReferences) {
                const matchedUrls = [];
                [...library.characters, ...library.locations, ...library.style].forEach(item => {
                    if (initialData.suggestedReferences.some(ref => ref.includes(item.name))) {
                        matchedUrls.push(item.url);
                    }
                });
                setSelectedRefs(matchedUrls);
            }

            // Clear the shared state after applying to local state
            if (onClearInitialData) onClearInitialData();
        }
    }, [initialData, library, onClearInitialData]);

    const toggleReference = (url) => {
        if (selectedRefs.includes(url)) {
            setSelectedRefs(selectedRefs.filter(r => r !== url));
        } else {
            setSelectedRefs([...selectedRefs, url]);
        }
    };

    const handleGenerate = async () => {
        if (!story.trim()) return alert('Please enter a story snippet');

        setIsGenerating(true);
        setResult(null);

        try {
            const referenceImages = await Promise.all(
                selectedRefs.map(async (url) => {
                    const response = await fetch(url);
                    const blob = await response.blob();
                    const filename = url.split('/').pop();

                    return new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve({
                            name: filename,
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
                    prompt: story,
                    references: referenceImages,
                    panels,
                    mode: genMode,
                    engine,
                    projectId,
                    colorMode,
                    textDensity,
                    appMode,
                    aspectRatio,
                    artStyle
                })
            });

            const data = await res.json();
            if (data.error) throw new Error(data.error);

            if (onUsageUpdate) onUsageUpdate(engine, data.usage, genMode === 'full' || genMode === 'storybook' || appMode === 'storybook');

            setResult(data.result);
            setPanelImages({}); // Clear previous manual panels
            onRefresh();
        } catch (err) {
            alert('Generation failed: ' + err.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDrawPanel = async (panelIndex, panelData) => {
        setDrawingPanels(prev => ({ ...prev, [panelIndex]: true }));
        try {
            const referenceImages = await Promise.all(
                selectedRefs.map(async (url) => {
                    const response = await fetch(url);
                    const blob = await response.blob();
                    const filename = url.split('/').pop();
                    return new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve({ name: filename, data: reader.result });
                        reader.readAsDataURL(blob);
                    });
                })
            );

            const res = await fetch('/api/generate-panel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    panel: panelData,
                    references: referenceImages,
                    engine,
                    projectId,
                    colorMode,
                    textDensity
                })
            });

            const data = await res.json();
            if (data.error) throw new Error(data.error);

            if (onUsageUpdate) onUsageUpdate(engine, data.usage, true); // Drawing art is always image generation

            if (data.result && data.result.type === 'image') {
                setPanelImages(prev => ({ ...prev, [panelIndex]: data.result }));
            } else {
                alert('Panel generation did not return an image.');
            }
        } catch (err) {
            alert('Panel generation failed: ' + err.message);
        } finally {
            setDrawingPanels(prev => ({ ...prev, [panelIndex]: false }));
        }
    };

    const handleAssemblePage = async () => {
        const panelsCount = result.panels.length;
        const drawnPanelsCount = Object.keys(panelImages).length;

        if (drawnPanelsCount < panelsCount) {
            if (!confirm(`You have only drawn ${drawnPanelsCount} out of ${panelsCount} panels. Assemble anyway?`)) return;
        }

        setIsAssembling(true);
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Set canvas size (vertical layout for demo)
            const panelWidth = 800;
            const panelHeight = 600;
            canvas.width = panelWidth;
            canvas.height = panelHeight * panelsCount;

            // Black background
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            for (let i = 0; i < panelsCount; i++) {
                const imgData = panelImages[i];
                if (imgData) {
                    const img = new Image();
                    img.src = `data:${imgData.mimeType};base64,${imgData.data}`;
                    await new Promise(resolve => img.onload = resolve);
                    ctx.drawImage(img, 0, i * panelHeight, panelWidth, panelHeight);
                } else {
                    // Placeholder for undrawn panels
                    ctx.strokeStyle = '#333';
                    ctx.strokeRect(10, i * panelHeight + 10, panelWidth - 20, panelHeight - 20);
                    ctx.fillStyle = '#555';
                    ctx.font = '30px Inter';
                    ctx.fillText(`Panel ${i + 1} (Undrawn)`, 100, i * panelHeight + panelHeight / 2);
                }
            }

            const assembledData = canvas.toDataURL('image/png');
            setResult({
                type: 'image',
                data: assembledData.split(',')[1],
                mimeType: 'image/png'
            });
            alert('Page assembled! You can now save the final artwork.');
        } catch (err) {
            alert('Assembly failed: ' + err.message);
        } finally {
            setIsAssembling(false);
        }
    };

    const handleSavePage = async () => {
        if (!result) return;
        saveImageToLibrary(`page_${Date.now()}.png`, result.type === 'image' ? `data:${result.mimeType};base64,${result.data}` : null);
    };

    const handleSavePanel = async (index) => {
        const p = panelImages[index];
        if (!p) return;
        saveImageToLibrary(`panel_${index}_${Date.now()}.png`, `data:${p.mimeType};base64,${p.data}`);
    };

    const saveImageToLibrary = async (filename, imageData) => {
        if (!imageData) {
            // Simulated fallback for JSON-only results
            imageData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
        }

        try {
            const res = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename,
                    imageData,
                    projectId
                })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            alert('Saved to project library!');
            onRefresh();
        } catch (err) {
            alert('Save failed: ' + err.message);
        }
    };

    const renderResult = () => {
        if (!result) return null;

        if (result.type === 'image') {
            return (
                <div className="preview-content animate-in">
                    <div className="storyboard-header">
                        <div>
                            <h3 className="heading-font" style={{ color: 'var(--accent)', fontSize: '1.4rem' }}>
                                {genMode === 'storybook' ? 'Generated Illustration' : 'Generated Manga Page'}
                            </h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
                                High-fidelity art by Nano Banana Pro
                            </p>
                        </div>
                        <button className="tab-btn" onClick={handleSavePage} style={{ background: 'var(--accent)', color: 'white', border: 'none' }}>
                            Save to Project Library
                        </button>
                    </div>
                    <div className="full-page-preview image-hover-container">
                        <img
                            src={`data:${result.mimeType};base64,${result.data}`}
                            alt="Generated Manga Page"
                            style={{ width: '100%', borderRadius: 'var(--radius-md)', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
                        />
                        <div className="image-overlay-actions">
                            <button className="action-pill save" onClick={handleSavePage}>Save</button>
                            <button className="action-pill edit" onClick={() => {
                                setEditingImage(`data:${result.mimeType};base64,${result.data}`);
                                setEditingPanelIndex(-1); // -1 for full page
                                setIsEditorOpen(true);
                            }}>Edit</button>
                            <button className="action-pill regen" onClick={handleGenerate}>Regenerate</button>
                        </div>
                    </div>
                </div>
            );
        }

        let data = result;
        if (typeof result === 'string') {
            try {
                data = JSON.parse(result);
            } catch (e) {
                return <div className="ai-output-box">{result}</div>;
            }
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
                                {data.summary || 'Generated narrative blueprint by Nano Banana'}
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                className="tab-btn"
                                onClick={handleAssemblePage}
                                disabled={isAssembling || Object.keys(panelImages).length === 0}
                                style={{ background: 'var(--accent-secondary)', color: 'white', border: 'none' }}
                            >
                                {isAssembling ? 'Assembling...' : 'Assemble Final Page'}
                            </button>
                            <button className="tab-btn" onClick={handleSavePage} style={{ background: 'var(--accent)', color: 'white', border: 'none' }}>
                                Save Project Library
                            </button>
                        </div>
                    </div>

                    <div className="storyboard-grid">
                        {data.panels.map((panel, i) => (
                            <div key={i} className="panel-card animate-in" style={{ animationDelay: `${i * 0.1}s` }}>
                                <div className="panel-visual-area">
                                    <div className="panel-number-badge">{panel.panelNumber}</div>
                                    <div className="panel-layout-badge">{panel.layout}</div>

                                    {panelImages[i] ? (
                                        <div className="image-hover-container" style={{ width: '100%', height: '100%' }}>
                                            <img
                                                src={`data:${panelImages[i].mimeType};base64,${panelImages[i].data}`}
                                                alt={`Panel ${i + 1}`}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                            />
                                            <div className="image-overlay-actions mini">
                                                <button className="action-pill save" onClick={() => handleSavePanel(i)}>Save</button>
                                                <button className="action-pill edit" onClick={() => {
                                                    setEditingImage(`data:${panelImages[i].mimeType};base64,${panelImages[i].data}`);
                                                    setEditingPanelIndex(i);
                                                    setIsEditorOpen(true);
                                                }}>Edit</button>
                                                <button className="action-pill regen" onClick={() => handleDrawPanel(i, data.panels[i])}>Regen</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="panel-visual-placeholder">
                                            {drawingPanels[i] ? <div className="loader small"></div> : '✦'}
                                        </div>
                                    )}

                                    {!panelImages[i] && !drawingPanels[i] && (
                                        <button
                                            className="draw-panel-btn"
                                            onClick={() => handleDrawPanel(i, panel)}
                                            title="Draw this panel"
                                        >
                                            Draw Art
                                        </button>
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
                    </div>

                    <div style={{
                        marginTop: '30px',
                        padding: '15px',
                        background: 'rgba(255,165,0,0.05)',
                        border: '1px solid rgba(255,165,0,0.2)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.8rem',
                        color: '#ffb347'
                    }}>
                        <strong>Nano Banana Note:</strong> This is a **Blueprint Storyboard**. To generate the actual high-fidelity manga page art, switch the <strong>Engine</strong> to <strong>N. Banana Pro</strong> in the sidebar and click Generate Page again.
                    </div>
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
                                        <div className="ref-check">✓</div>
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
                            onChange={(e) => setGenMode(e.target.value)}
                        >
                            <option value="storyboard">Storyboard</option>
                            <option value="full">Full Page Generation</option>
                        </select>
                    </div>
                )}

                <div className="field-group">
                    <label className="field-label">Engine</label>
                    <select
                        className="input-glass"
                        value={engine}
                        onChange={(e) => setEngine(e.target.value)}
                    >
                        <option value="flash">Nano Banana</option>
                        <option value="pro">Nano Banana Pro</option>
                    </select>
                </div>

                <div className="field-group">
                    <label className="field-label">Color Mode</label>
                    <select
                        className="input-glass"
                        value={colorMode}
                        onChange={(e) => setColorMode(e.target.value)}
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
                            if (val === 'custom') setAspectRatio(''); // Clear for custom input
                            else setAspectRatio(val);
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
                                onChange={(e) => setArtStyle(e.target.value)}
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
                                onChange={(e) => setPanels(Number(e.target.value))}
                            >
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n} Panels</option>)}
                            </select>
                        </div>

                        <div className="field-group">
                            <label className="field-label">Text Density</label>
                            <select
                                className="input-glass"
                                value={textDensity}
                                onChange={(e) => setTextDensity(e.target.value)}
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

                <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="btn-primary"
                    style={{ marginTop: '20px' }}
                >
                    {isGenerating ? 'Drawing...' : appMode === 'storybook' ? 'Generate Illustration' : (genMode === 'storybook' ? 'Generate Illustration' : 'Generate Page')}
                </button>
            </aside>

            <section className="preview-container">
                {!result && !isGenerating && (
                    <div className="preview-placeholder">
                        <div style={{ fontSize: '3rem', opacity: 0.2 }}>✦</div>
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
                engine={engine}
                projectId={projectId}
                onSaveEdit={(newImage) => {
                    if (editingPanelIndex === -1) {
                        setResult(newImage);
                    } else {
                        setPanelImages(prev => ({ ...prev, [editingPanelIndex]: newImage }));
                    }
                }}
            />
        </div>
    );
};

export default CreatorView;
