import React, { useState, useMemo, useRef, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

const StorybookAssembler = ({ isOpen, onClose, project, appMode }) => {
    const [currentPage, setCurrentPage] = useState(0);
    // Layouts: 'overlay-bottom', 'overlay-top', 'side-left', 'side-right', 'below'
    const [layout, setLayout] = useState('overlay-bottom');

    // Style State
    const [textOpacity, setTextOpacity] = useState(0.7);
    const [fontSize, setFontSize] = useState(24);
    const [padding, setPadding] = useState(40);
    const [textColor, setTextColor] = useState('#ffffff');
    const [bgColor, setBgColor] = useState('#000000');

    // Content State
    const [richTextContent, setRichTextContent] = useState({});

    // Export State
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);

    // Auto-scale state
    const [scale, setScale] = useState(0.65);

    const previewRef = useRef(null);
    const containerRef = useRef(null);
    const editableRef = useRef(null);
    const pages = project?.plannedPages || [];
    const currentData = pages[currentPage];

    // Sync content to editable div when page changes
    useEffect(() => {
        if (editableRef.current) {
            const currentContent = richTextContent[currentPage] || "";
            if (editableRef.current.innerHTML !== currentContent) {
                editableRef.current.innerHTML = currentContent;
            }
        }
    }, [currentPage, richTextContent]);

    // Reuse verbatim extraction logic
    const verbatimSegments = useMemo(() => {
        if (!project?.story || !pages.length) return [];
        // ... (Same extraction logic as before) ...
        const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const makeFuzzy = (anchor) => {
            if (!anchor) return null;
            const words = anchor.trim().split(/\s+/).filter(w => w.length > 0);
            if (words.length === 0) return null;
            return words.map(word => escapeRegExp(word)).join('[^\\w\\s]*\\s+[^\\w\\s]*');
        };

        const results = [];
        let currentSearchPos = 0;
        const fullStory = project.story;

        pages.forEach((page, idx) => {
            try {
                const startPattern = makeFuzzy(page?.startAnchor);
                const endPattern = makeFuzzy(page?.endAnchor);
                if (!startPattern || !endPattern) { results.push(null); return; }

                const startRegex = new RegExp(startPattern, 'i');
                const endRegex = new RegExp(endPattern, 'i');
                const startSlice = fullStory.slice(currentSearchPos);
                const startMatch = startSlice.match(startRegex);

                if (!startMatch) {
                    const globalStartMatch = fullStory.match(startRegex);
                    if (!globalStartMatch) { results.push(null); return; }
                    const globalStartIdx = globalStartMatch.index;
                    const searchSlice = fullStory.slice(globalStartIdx);
                    const endMatch = searchSlice.match(endRegex);
                    if (!endMatch) { results.push(null); return; }
                    const text = fullStory.substring(globalStartIdx, globalStartIdx + endMatch.index + endMatch[0].length).trim();
                    results.push(text);
                    currentSearchPos = globalStartIdx + endMatch.index + endMatch[0].length;
                    return;
                }

                const startIdx = currentSearchPos + startMatch.index;
                const searchSlice = fullStory.slice(startIdx);
                const endMatch = searchSlice.match(endRegex);
                if (!endMatch) { results.push(null); return; }

                const endIdxInSlice = endMatch.index + endMatch[0].length;
                const text = fullStory.substring(startIdx, startIdx + endIdxInSlice).trim();
                results.push(text);
                currentSearchPos = startIdx + endIdxInSlice;
            } catch (err) {
                console.error(`Extraction error at page ${idx}:`, err);
                results.push(null);
            }
        });
        return results;
    }, [project?.story, pages]);

    // Initialize content map
    useEffect(() => {
        if (verbatimSegments.length > 0 && Object.keys(richTextContent).length === 0) {
            const initialContent = {};
            pages.forEach((page, idx) => {
                initialContent[idx] = verbatimSegments[idx] || page?.storySegment || "Click to add text...";
            });
            setRichTextContent(initialContent);
        }
    }, [verbatimSegments, pages]);

    // Auto-scale logic
    useEffect(() => {
        const handleResize = () => {
            if (containerRef.current) {
                const { clientWidth, clientHeight } = containerRef.current;
                // Available space minus padding and toolbar/nav space
                // container padding is 30px * 2 = 60px
                // toolbar ~ 50px, nav ~ 60px, gap ~ 20px

                // We want to fit 1200x800 into this box
                const availableW = clientWidth - 20;
                const availableH = clientHeight - 120; // approximate vertical space taken by UI elements

                const scaleX = availableW / 1200;
                const scaleY = availableH / 800;

                // Use the smaller scale to ensure fit, max out at 1.0
                const newScale = Math.min(scaleX, scaleY, 1.0);
                // slight buffer
                setScale(newScale * 0.95);
            }
        };

        // Initial calc
        handleResize();

        // Listen
        window.addEventListener('resize', handleResize);

        // Also use ResizeObserver for container-specific changes
        const observer = new ResizeObserver(handleResize);
        if (containerRef.current) observer.observe(containerRef.current);

        return () => {
            window.removeEventListener('resize', handleResize);
            observer.disconnect();
        };
    }, [isOpen]); // Recalc when opened

    const handleTextChange = (e) => {
        const newValue = e.currentTarget.innerHTML;
        setRichTextContent(prev => ({
            ...prev,
            [currentPage]: newValue
        }));
    };

    const handleFormat = (command, value = null) => {
        document.execCommand(command, false, value);
    };

    // Helper: Capture function using html2canvas
    // Helper: Capture function using html2canvas
    const capturePage = async (pageIdx, outputScale = 2) => {
        // Temporarily render the target page if not current
        if (pageIdx !== currentPage) {
            setCurrentPage(pageIdx);
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const element = previewRef.current;
        if (!element) return null;

        // Create a clone to capture without UI scaling interference
        const clone = element.cloneNode(true);

        // Setup container for clone
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.top = '0';
        container.style.width = '1200px';
        container.style.height = '800px';
        container.style.overflow = 'hidden'; // Ensure consistent context
        container.appendChild(clone);
        document.body.appendChild(container);

        // Ensure images in clone are loaded (optional but good practice)
        // With html2canvas, it usually handles it, but since we just cloned, the browser might need a tick.
        // However, since it's a clone of an already loaded node, it usually display immediately.

        try {
            const canvas = await html2canvas(clone, {
                scale: outputScale,
                useCORS: true,
                backgroundColor: null,
                logging: false,
                // Ensure we capture at full size
                windowWidth: 1200,
                windowHeight: 800,
                onclone: (clonedDoc) => {
                    // Good place for any final tweaks if needed
                }
            });
            return canvas;
        } catch (err) {
            console.error("Capture failed:", err);
            return null;
        } finally {
            document.body.removeChild(container);
        }
    };

    const handleDownloadCurrent = async () => {
        const canvas = await capturePage(currentPage);
        if (canvas) {
            const link = document.createElement('a');
            link.download = `storybook_page_${currentPage + 1}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        }
    };

    const handleExportAllImages = async () => {
        setIsExporting(true);
        setExportProgress(0);

        try {
            for (let i = 0; i < pages.length; i++) {
                const canvas = await capturePage(i);
                if (canvas) {
                    const link = document.createElement('a');
                    link.download = `storybook_page_${i + 1}.png`;
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                }
                setExportProgress(Math.round(((i + 1) / pages.length) * 100));
                await new Promise(r => setTimeout(r, 200)); // Breather
            }
            alert('All pages downloaded!');
        } catch (err) {
            alert('Export failed: ' + err.message);
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportPDF = async () => {
        setIsExporting(true);
        setExportProgress(0);

        try {
            // Standard A4 landscapeish, or based on pixel dims.
            // Let's use 1200x800 px (3:2) as base unit
            const doc = new jsPDF({
                orientation: 'landscape',
                unit: 'px',
                format: [1200, 800]
            });

            for (let i = 0; i < pages.length; i++) {
                if (i > 0) doc.addPage([1200, 800], 'landscape');

                // Capture at a defined scale to match PDF dims roughly
                // Scale 1 on 1200px css width -> 1200px actual
                const canvas = await capturePage(i, 1.5);
                const imgData = canvas.toDataURL('image/jpeg', 0.9);

                doc.addImage(imgData, 'JPEG', 0, 0, 1200, 800);
                setExportProgress(Math.round(((i + 1) / pages.length) * 100));
                await new Promise(r => setTimeout(r, 100));
            }
            doc.save(`${project.name || 'Storybook'}.pdf`);
        } catch (err) {
            console.error(err);
            alert('PDF Export failed: ' + err.message);
        } finally {
            setIsExporting(false);
        }
    };

    // Helper: Hex to RGB for opacity
    const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '0,0,0';
    };

    if (!isOpen || !project) return null;

    const currentImgData = currentData?.generatedResult;
    const currentImgSrc = currentImgData ? `data:${currentImgData.mimeType};base64,${currentImgData.data}` : null;

    // CSS variables for dynamic styling of the preview container
    const previewStyle = {
        '--bg-color': bgColor,
        '--text-color': textColor,
        '--font-size': `${fontSize}px`,
        '--padding': `${padding}px`,
        '--overlay-bg': `rgba(${hexToRgb(bgColor)}, ${textOpacity})`,
        width: '1200px',
        height: '800px',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
    };

    return (
        <div className="modal-overlay assembler-overlay" onClick={onClose}>
            <div className="assembler-card animate-in" onClick={e => e.stopPropagation()}>
                <div className="assembler-header">
                    <div className="project-info">
                        <h3 className="heading-font">Storybook Assembler (WYSIWYG)</h3>
                        <span className="page-indicator">Page {currentPage + 1} of {pages.length}</span>
                    </div>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>

                <div className="assembler-body">
                    <div className="assembler-preview-side" ref={containerRef}>
                        {/* Editor Toolbar */}
                        <div className="wysiwyg-toolbar">
                            <button onClick={() => handleFormat('bold')} title="Bold"><b>B</b></button>
                            <button onClick={() => handleFormat('italic')} title="Italic"><i>I</i></button>
                            <button onClick={() => handleFormat('underline')} title="Underline"><u>U</u></button>
                            <span className="separator">|</span>
                            <button onClick={() => handleFormat('justifyLeft')} title="Align Left">Align L</button>
                            <button onClick={() => handleFormat('justifyCenter')} title="Align Center">Center</button>
                            <button onClick={() => handleFormat('justifyRight')} title="Align Right">Align R</button>
                        </div>

                        {/* Exportable DOM Container */}
                        {/* Apply dynamic scale here */}
                        <div
                            className="canvas-wrapper-dom"
                            style={{
                                transform: `scale(${scale})`,
                                transformOrigin: 'center top',
                                width: '1200px', // Explicit size for wrapper so scaling works predictably?
                                // Actually, if we scale down a 1200px box, it takes less space.
                                // But CSS transform doesn't affect Layout flow by default unless we set width/height.
                                // A better way for centering is setting a fixed size on the child and scaling it.
                                maxHeight: '800px', // Prevent overflow
                                marginBottom: `${(800 * scale) - 800}px` // Negative margin hack to pull bottom content up?
                                // Or simpler: Just rely on flex centering in parent.
                            }}
                        >
                            {/* Ref goes on the UN-SCALED inner content for html2canvas */}
                            <div className={`page-composer layout-${layout}`} style={previewStyle} ref={previewRef}>
                                {/* Background/Image Area */}
                                <div className="composer-image-area" style={{
                                    backgroundImage: currentImgSrc ? `url(${currentImgSrc})` : 'none',
                                    backgroundColor: '#222'
                                }}>
                                    {!currentImgSrc && <div className="placeholder-msg">No Image Generated</div>}
                                </div>

                                {/* Editable Text Overlay */}
                                <div
                                    className="composer-text-area"
                                    ref={editableRef}
                                    contentEditable
                                    suppressContentEditableWarning
                                    onInput={handleTextChange}
                                    onKeyDown={e => e.stopPropagation()}
                                />
                            </div>
                        </div>

                        {/*
                           Since transform: scale doesn't change element flow size which stays 800px high,
                           we might have a huge empty gap.
                           However, `.canvas-wrapper-dom` with no width/height will shrink to fit content? No, child is 1200x800 fixed.

                           Improvement: Wrap the scaled element in a box that is sized to the *scaled* dimensions.
                        */}
                        <div style={{ height: `${800 * scale}px`, display: 'none' }}></div> {/* Spacer idea, or just use flex gap */}

                        <div className="preview-nav" style={{ marginTop: '20px' }}>
                            <button className="nav-arrow" onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}>←</button>
                            <div className="progress-dots">
                                {pages.map((_, i) => (
                                    <div key={i} className={`dot ${i === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(i)} />
                                ))}
                            </div>
                            <button className="nav-arrow" onClick={() => setCurrentPage(p => Math.min(pages.length - 1, p + 1))} disabled={currentPage === pages.length - 1}>→</button>
                        </div>
                    </div>

                    <aside className="assembler-controls">
                        {/* Wrapper for scroll */}
                        <div className="field-group">
                            <label className="field-label">Layout Preset</label>
                            <div className="preset-grid">
                                <button className={`preset-btn ${layout === 'overlay-bottom' ? 'active' : ''}`} onClick={() => setLayout('overlay-bottom')}>Bottom Overlay</button>
                                <button className={`preset-btn ${layout === 'overlay-top' ? 'active' : ''}`} onClick={() => setLayout('overlay-top')}>Top Overlay</button>
                                <button className={`preset-btn ${layout === 'side-left' ? 'active' : ''}`} onClick={() => setLayout('side-left')}>Side-by-Side</button>
                                <button className={`preset-btn ${layout === 'side-right' ? 'active' : ''}`} onClick={() => setLayout('side-right')}>Side-by-Side (Rev)</button>
                                <button className={`preset-btn ${layout === 'below' ? 'active' : ''}`} onClick={() => setLayout('below')}>Text Below</button>
                            </div>
                        </div>

                        <div className="field-group">
                            <label className="field-label">Font Size: {fontSize}px</label>
                            <input type="range" min="12" max="80" value={fontSize} onChange={e => setFontSize(parseInt(e.target.value))} />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Padding: {padding}px</label>
                            <input type="range" min="0" max="100" value={padding} onChange={e => setPadding(parseInt(e.target.value))} />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Overlay Opacity: {Math.round(textOpacity * 100)}%</label>
                            <input type="range" min="0" max="100" value={textOpacity * 100} onChange={e => setTextOpacity(parseInt(e.target.value) / 100)} />
                        </div>

                        <div className="color-row">
                            <div className="field-group">
                                <label className="field-label">Text Color</label>
                                <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)} />
                            </div>
                            <div className="field-group">
                                <label className="field-label">Theme Color</label>
                                <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} />
                            </div>
                        </div>

                        <div className="action-row" style={{ marginTop: 'auto', paddingTop: '20px', display: 'flex', gap: '10px', flexDirection: 'column' }}>
                            <button className="btn-secondary" onClick={handleDownloadCurrent} style={{ width: '100%', textAlign: 'center' }}>Download Page Image</button>
                            <button
                                className="btn-secondary"
                                onClick={handleExportAllImages}
                                disabled={isExporting}
                                style={{ width: '100%', textAlign: 'center' }}
                            >
                                {isExporting ? `Processing...` : 'Download All Pages (Images)'}
                            </button>
                            <button
                                className="btn-primary"
                                onClick={handleExportPDF}
                                disabled={isExporting}
                                style={{ width: '100%', textAlign: 'center' }}
                            >
                                {isExporting ? `Exporting (${exportProgress}%)` : 'Export Book PDF'}
                            </button>
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
};

export default StorybookAssembler;
