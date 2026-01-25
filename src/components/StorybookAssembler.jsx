import React, { useMemo, useRef, useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import FontFamily from '@tiptap/extension-font-family';
import { StorybookRichTextContent, StorybookRichTextToolbar } from './StorybookRichTextEditor';

const DEFAULT_LAYOUT = 'overlay-bottom';

const escapeHtml = (unsafe) => {
    if (unsafe == null) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const textToHtml = (text) => {
    const safe = escapeHtml(text || '').trim();
    if (!safe) return '<p></p>';
    // Preserve simple newlines for initial content
    return `<p>${safe.replace(/\n/g, '<br />')}</p>`;
};

const defaultImageFitForLayout = (layout) => {
    if (layout === 'side-left' || layout === 'side-right') return 'contain';
    return 'cover';
};

const normalizeStorybookAssembly = (existing, { fallbackText, layoutFallback } = {}) => {
    const layout = existing?.layout || layoutFallback || DEFAULT_LAYOUT;
    const imageFit = existing?.image?.fit || defaultImageFitForLayout(layout);
    const textHtml =
        existing?.text?.html != null
            ? existing.text.html
            : textToHtml(fallbackText || 'Click to add text...');

    return {
        layout,
        image: {
            fit: imageFit,
            posX: typeof existing?.image?.posX === 'number' ? existing.image.posX : 50,
            posY: typeof existing?.image?.posY === 'number' ? existing.image.posY : 50,
            zoom: typeof existing?.image?.zoom === 'number' ? existing.image.zoom : 1.0,
        },
        text: {
            html: textHtml,
        },
        textStyle: {
            fontFamily: existing?.textStyle?.fontFamily || 'Plus Jakarta Sans',
            fontSizePx: typeof existing?.textStyle?.fontSizePx === 'number' ? existing.textStyle.fontSizePx : 24,
            lineHeight: typeof existing?.textStyle?.lineHeight === 'number' ? existing.textStyle.lineHeight : 1.6,
            letterSpacingPx:
                typeof existing?.textStyle?.letterSpacingPx === 'number' ? existing.textStyle.letterSpacingPx : 0,
        },
        overlay: {
            paddingPx: typeof existing?.overlay?.paddingPx === 'number' ? existing.overlay.paddingPx : 40,
            textOpacity: typeof existing?.overlay?.textOpacity === 'number' ? existing.overlay.textOpacity : 0.7,
            textColor: existing?.overlay?.textColor || '#ffffff',
            bgColor: existing?.overlay?.bgColor || '#000000',
        },
    };
};

const StorybookAssembler = ({
    isOpen,
    onClose,
    project,
    onUpdatePageImage,
    onUpdatePlannedPages,
}) => {
    const [currentPage, setCurrentPage] = useState(0);
    const [draftPages, setDraftPages] = useState([]);
    const [isInitialized, setIsInitialized] = useState(false);
    const initializedProjectIdRef = useRef(null);

    // Export State
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);

    // Auto-scale state
    const [scale, setScale] = useState(0.65);
    const [capturePageIndex, setCapturePageIndex] = useState(0);

    const previewRef = useRef(null);
    const containerRef = useRef(null);
    const capturePreviewRef = useRef(null);
    const imageUploadRef = useRef(null);

    const persistTimerRef = useRef(null);
    const hiddenTextColorInputRef = useRef(null);
    const hiddenHighlightColorInputRef = useRef(null);

    const schedulePersistPages = (nextPages, { immediate = false } = {}) => {
        if (!onUpdatePlannedPages) return;
        if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
        if (immediate) {
            onUpdatePlannedPages(nextPages);
            return;
        }
        persistTimerRef.current = window.setTimeout(() => {
            onUpdatePlannedPages(nextPages);
        }, 650);
    };

    const pages = draftPages;
    const currentData = pages[currentPage];

    // Reuse verbatim extraction logic
    const verbatimSegments = useMemo(() => {
        if (!project?.story || !project?.plannedPages?.length) return [];
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
        (project.plannedPages || []).forEach((page, idx) => {
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
    }, [project?.story, project?.plannedPages]);

    // Initialize local editable pages for this modal session (and ensure storybookAssembly exists)
    useEffect(() => {
        if (!isOpen || !project) {
            setIsInitialized(false);
            initializedProjectIdRef.current = null;
            return;
        }

        // IMPORTANT: do not re-initialize on every project.plannedPages update while open,
        // otherwise the UI jumps back to page 1 after each persisted change.
        const shouldInit = !isInitialized || initializedProjectIdRef.current !== project.id;
        if (!shouldInit) return;

        initializedProjectIdRef.current = project.id;

        const basePages = project.plannedPages || [];
        let changed = false;
        const nextPages = basePages.map((page, idx) => {
            const fallbackText = verbatimSegments[idx] || page?.storySegment || page?.pageContent || '';
            const normalized = normalizeStorybookAssembly(page?.storybookAssembly, { fallbackText });

            // If any key is missing, treat as changed
            const hadAssembly = !!page?.storybookAssembly;
            if (!hadAssembly) changed = true;
            else {
                // Very small heuristic: if text.html missing or image.fit missing, etc.
                if (page.storybookAssembly?.text?.html == null) changed = true;
                if (page.storybookAssembly?.image?.fit == null) changed = true;
            }

            return {
                ...page,
                storybookAssembly: normalized,
            };
        });

        setDraftPages(nextPages);
        setCurrentPage(0);
        setIsInitialized(true);

        if (changed) {
            // Persist once so the user doesn't lose defaults on refresh/reopen
            schedulePersistPages(nextPages, { immediate: true });
        }
    }, [isOpen, project?.id, isInitialized, verbatimSegments]);

    // Auto-scale logic
    useEffect(() => {
        const handleResize = () => {
            if (containerRef.current) {
                const { clientWidth, clientHeight } = containerRef.current;
                // Available space calculation:
                // - Container padding: 30px * 2 = 60px (horizontal)
                // - WYSIWYG toolbar: ~50px
                // - Navigation area: ~80px (including margin)
                // - Additional gaps: ~40px
                // Total vertical overhead: ~170px

                // We want to fit 1200x800 into this box
                const availableW = clientWidth - 60;
                const availableH = clientHeight - 170;

                const scaleX = availableW / 1200;
                const scaleY = availableH / 800;

                // Use the smaller scale to ensure fit, max out at 1.0, min at 0.3
                const newScale = Math.max(0.3, Math.min(scaleX, scaleY, 1.0));
                // Apply with a slight buffer
                setScale(newScale * 0.92);
            }
        };

        // Initial calc with slight delay to ensure DOM is ready
        const timeoutId = setTimeout(handleResize, 50);

        // Listen
        window.addEventListener('resize', handleResize);

        // Also use ResizeObserver for container-specific changes
        const observer = new ResizeObserver(handleResize);
        if (containerRef.current) observer.observe(containerRef.current);

        return () => {
            clearTimeout(timeoutId);
            window.removeEventListener('resize', handleResize);
            observer.disconnect();
        };
    }, [isOpen]); // Recalc when opened

    // Clamp current page index if page count changes
    useEffect(() => {
        if (!pages.length) return;
        setCurrentPage((p) => Math.min(Math.max(0, p), pages.length - 1));
    }, [pages.length]);

    // Handle uploading a replacement image for the current page
    const handleImageUpload = (e) => {
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

            // Call the callback to update the page image in parent
            if (onUpdatePageImage) {
                onUpdatePageImage(currentPage, uploadedResult);
            }
        };
        reader.readAsDataURL(file);
        e.target.value = ''; // Reset input
    };

    const updateStorybookAssembly = (pageIdx, patch, { persist = 'debounced' } = {}) => {
        setDraftPages(prev => {
            const next = [...prev];
            const page = next[pageIdx];
            if (!page) return prev;

            const currentAssembly = normalizeStorybookAssembly(page.storybookAssembly, {
                fallbackText: verbatimSegments[pageIdx] || page?.storySegment || page?.pageContent || '',
            });

            const updatedAssembly = {
                ...currentAssembly,
                ...patch,
                image: { ...currentAssembly.image, ...(patch.image || {}) },
                text: { ...currentAssembly.text, ...(patch.text || {}) },
                textStyle: { ...currentAssembly.textStyle, ...(patch.textStyle || {}) },
                overlay: { ...currentAssembly.overlay, ...(patch.overlay || {}) },
            };

            next[pageIdx] = { ...page, storybookAssembly: updatedAssembly };
            schedulePersistPages(next, { immediate: persist === 'immediate' });
            return next;
        });
    };

    const applyLayoutToAllPages = (layoutValue) => {
        setDraftPages(prev => {
            const next = prev.map((p, idx) => {
                const currentAssembly = normalizeStorybookAssembly(p.storybookAssembly, {
                    fallbackText: verbatimSegments[idx] || p?.storySegment || p?.pageContent || '',
                });

                return {
                    ...p,
                    storybookAssembly: {
                        ...currentAssembly,
                        layout: layoutValue,
                        image: {
                            ...currentAssembly.image,
                            fit: defaultImageFitForLayout(layoutValue),
                        },
                    },
                };
            });

            schedulePersistPages(next, { immediate: true });
            return next;
        });
    };

    // Helper: Capture function using html2canvas
    // Helper: Capture function using html2canvas
    const capturePage = async (pageIdx, outputScale = 2) => {
        const waitForImages = async (element) => {
            const imgs = Array.from(element.querySelectorAll('img'));
            await Promise.all(
                imgs.map(async (img) => {
                    if (!img) return;
                    if (img.complete && img.naturalWidth > 0) {
                        if (typeof img.decode === 'function') {
                            try { await img.decode(); } catch { }
                        }
                        return;
                    }
                    await new Promise((resolve) => {
                        img.onload = () => resolve();
                        img.onerror = () => resolve();
                    });
                })
            );
        };

        setCapturePageIndex(pageIdx);
        // Wait a couple frames for React to render the hidden capture page
        await new Promise((r) => requestAnimationFrame(() => r()));
        await new Promise((r) => requestAnimationFrame(() => r()));

        const element = capturePreviewRef.current;
        if (!element) return null;

        await waitForImages(element);

        try {
            const canvas = await html2canvas(element, {
                scale: outputScale,
                useCORS: true,
                backgroundColor: null,
                logging: false,
                windowWidth: 1200,
                windowHeight: 800,
            });
            return canvas;
        } catch (err) {
            console.error("Capture failed:", err);
            return null;
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

    const safeCurrentPage = Math.min(Math.max(0, currentPage), Math.max(0, pages.length - 1));
    const safeCurrentData = pages[safeCurrentPage];

    const currentImgData = safeCurrentData?.generatedResult;
    const currentImgSrc = currentImgData ? `data:${currentImgData.mimeType};base64,${currentImgData.data}` : null;

    const currentAssembly = normalizeStorybookAssembly(safeCurrentData?.storybookAssembly, {
        fallbackText: verbatimSegments[safeCurrentPage] || safeCurrentData?.storySegment || safeCurrentData?.pageContent || '',
    });

    // Per-page styling (CSS variables)
    const previewStyle = {
        '--bg-color': currentAssembly.overlay.bgColor,
        '--text-color': currentAssembly.overlay.textColor,
        '--padding': `${currentAssembly.overlay.paddingPx}px`,
        '--overlay-bg': `rgba(${hexToRgb(currentAssembly.overlay.bgColor)}, ${currentAssembly.overlay.textOpacity})`,
        '--rt-font-family': currentAssembly.textStyle.fontFamily,
        '--rt-font-size': `${currentAssembly.textStyle.fontSizePx}px`,
        '--rt-line-height': String(currentAssembly.textStyle.lineHeight),
        '--rt-letter-spacing': `${currentAssembly.textStyle.letterSpacingPx}px`,
        width: '1200px',
        height: '800px',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
    };

    // Hidden capture page (static HTML, no flicker)
    const captureData = pages[capturePageIndex];
    const captureImgData = captureData?.generatedResult;
    const captureImgSrc = captureImgData ? `data:${captureImgData.mimeType};base64,${captureImgData.data}` : null;
    const captureAssembly = normalizeStorybookAssembly(captureData?.storybookAssembly, {
        fallbackText: verbatimSegments[capturePageIndex] || captureData?.storySegment || captureData?.pageContent || '',
    });
    const captureStyle = {
        '--bg-color': captureAssembly.overlay.bgColor,
        '--text-color': captureAssembly.overlay.textColor,
        '--padding': `${captureAssembly.overlay.paddingPx}px`,
        '--overlay-bg': `rgba(${hexToRgb(captureAssembly.overlay.bgColor)}, ${captureAssembly.overlay.textOpacity})`,
        '--rt-font-family': captureAssembly.textStyle.fontFamily,
        '--rt-font-size': `${captureAssembly.textStyle.fontSizePx}px`,
        '--rt-line-height': String(captureAssembly.textStyle.lineHeight),
        '--rt-letter-spacing': `${captureAssembly.textStyle.letterSpacingPx}px`,
        width: '1200px',
        height: '800px',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
    };

    const editor = useEditor(
        {
            extensions: [
                StarterKit,
                Underline,
                TextStyle,
                Color,
                Highlight.configure({ multicolor: true }),
                TextAlign.configure({ types: ['heading', 'paragraph'] }),
                FontFamily,
            ],
            content: currentAssembly.text.html || '<p></p>',
            editable: !!isOpen,
            onUpdate: ({ editor: ed }) => {
                if (!isOpen) return;
                const html = ed.getHTML();
                updateStorybookAssembly(safeCurrentPage, { text: { html } }, { persist: 'debounced' });
            },
        },
        [safeCurrentPage, isOpen, isInitialized]
    );

    if (!isOpen || !project) return null;
    if (!isInitialized) return null;

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
                        {/* Editor Toolbar (excluded from export) */}
                        <StorybookRichTextToolbar
                            editor={editor}
                            onPickTextColor={() => hiddenTextColorInputRef.current?.click()}
                            onPickHighlightColor={() => hiddenHighlightColorInputRef.current?.click()}
                        />
                        <input
                            ref={hiddenTextColorInputRef}
                            type="color"
                            style={{ display: 'none' }}
                            onChange={(e) => editor?.chain().focus().setColor(e.target.value).run()}
                        />
                        <input
                            ref={hiddenHighlightColorInputRef}
                            type="color"
                            style={{ display: 'none' }}
                            onChange={(e) => editor?.chain().focus().setHighlight({ color: e.target.value }).run()}
                        />

                        {/* Exportable DOM Container */}
                        {/* Apply dynamic scale here */}
                        <div
                            className="canvas-wrapper-dom"
                            style={{
                                transform: `scale(${scale})`,
                                transformOrigin: 'center top',
                                width: '1200px',
                                height: '800px',
                                flexShrink: 0,
                            }}
                        >
                            {/* Ref goes on the UN-SCALED inner content for html2canvas */}
                            <div className={`page-composer layout-${currentAssembly.layout}`} style={previewStyle} ref={previewRef}>
                                {/* Background/Image Area */}
                                <div className="composer-image-area" style={{ backgroundColor: '#222' }}>
                                    {!currentImgSrc && <div className="placeholder-msg">No Image Generated</div>}
                                    {currentImgSrc && (
                                        <img
                                            className="composer-image"
                                            src={currentImgSrc}
                                            alt={`Page ${safeCurrentPage + 1}`}
                                            style={{
                                                objectFit: currentAssembly.image.fit,
                                                objectPosition: `${currentAssembly.image.posX}% ${currentAssembly.image.posY}%`,
                                                transform: `scale(${currentAssembly.image.zoom})`,
                                                transformOrigin: `${currentAssembly.image.posX}% ${currentAssembly.image.posY}%`,
                                            }}
                                        />
                                    )}
                                    {/* Image upload overlay button */}
                                    <button
                                        className="assembler-upload-btn"
                                        data-html2canvas-ignore="true"
                                        onClick={() => imageUploadRef.current?.click()}
                                        title="Upload or replace image for this page"
                                        style={{
                                            position: 'absolute',
                                            bottom: '15px',
                                            right: '15px',
                                            background: 'rgba(0,0,0,0.7)',
                                            color: 'white',
                                            border: '1px solid rgba(255,255,255,0.2)',
                                            padding: '8px 16px',
                                            borderRadius: '20px',
                                            fontSize: '0.8rem',
                                            cursor: 'pointer',
                                            zIndex: 100,
                                            transition: 'all 0.2s ease',
                                            backdropFilter: 'blur(4px)'
                                        }}
                                        onMouseOver={e => {
                                            e.target.style.background = 'linear-gradient(135deg, #3b82f6, #06b6d4)';
                                            e.target.style.borderColor = 'transparent';
                                        }}
                                        onMouseOut={e => {
                                            e.target.style.background = 'rgba(0,0,0,0.7)';
                                            e.target.style.borderColor = 'rgba(255,255,255,0.2)';
                                        }}
                                    >
                                        📤 {currentImgSrc ? 'Replace Image' : 'Upload Image'}
                                    </button>
                                    <input
                                        ref={imageUploadRef}
                                        type="file"
                                        accept="image/*"
                                        onChange={handleImageUpload}
                                        data-html2canvas-ignore="true"
                                        style={{ display: 'none' }}
                                    />
                                </div>

                                {/* Editable Text Overlay */}
                                <div className="composer-text-area">
                                    <StorybookRichTextContent editor={editor} />
                                </div>
                            </div>
                        </div>

                        <div className="preview-nav" style={{ marginTop: `${Math.max(20, 800 - (800 * scale))}px` }}>
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
                                <button
                                    className={`preset-btn ${currentAssembly.layout === 'overlay-bottom' ? 'active' : ''}`}
                                    onClick={() => updateStorybookAssembly(safeCurrentPage, { layout: 'overlay-bottom', image: { fit: defaultImageFitForLayout('overlay-bottom') } }, { persist: 'immediate' })}
                                >
                                    Bottom Overlay
                                </button>
                                <button
                                    className={`preset-btn ${currentAssembly.layout === 'overlay-top' ? 'active' : ''}`}
                                    onClick={() => updateStorybookAssembly(safeCurrentPage, { layout: 'overlay-top', image: { fit: defaultImageFitForLayout('overlay-top') } }, { persist: 'immediate' })}
                                >
                                    Top Overlay
                                </button>
                                <button
                                    className={`preset-btn ${currentAssembly.layout === 'side-left' ? 'active' : ''}`}
                                    onClick={() => updateStorybookAssembly(safeCurrentPage, { layout: 'side-left', image: { fit: defaultImageFitForLayout('side-left') } }, { persist: 'immediate' })}
                                >
                                    Side-by-Side
                                </button>
                                <button
                                    className={`preset-btn ${currentAssembly.layout === 'side-right' ? 'active' : ''}`}
                                    onClick={() => updateStorybookAssembly(safeCurrentPage, { layout: 'side-right', image: { fit: defaultImageFitForLayout('side-right') } }, { persist: 'immediate' })}
                                >
                                    Side-by-Side (Rev)
                                </button>
                                <button
                                    className={`preset-btn ${currentAssembly.layout === 'below' ? 'active' : ''}`}
                                    onClick={() => updateStorybookAssembly(safeCurrentPage, { layout: 'below', image: { fit: defaultImageFitForLayout('below') } }, { persist: 'immediate' })}
                                >
                                    Text Below
                                </button>
                            </div>
                            <button
                                className="btn-secondary"
                                style={{ marginTop: '10px' }}
                                onClick={() => applyLayoutToAllPages(currentAssembly.layout)}
                                type="button"
                            >
                                Apply this layout to all pages
                            </button>
                        </div>

                        <div className="field-group">
                            <label className="field-label">Font Family</label>
                            <select
                                className="input-glass"
                                value={currentAssembly.textStyle.fontFamily}
                                onChange={(e) => updateStorybookAssembly(safeCurrentPage, { textStyle: { fontFamily: e.target.value } }, { persist: 'debounced' })}
                            >
                                <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
                                <option value="Outfit">Outfit</option>
                                <option value="Arial">Arial</option>
                                <option value="Georgia">Georgia</option>
                                <option value="Times New Roman">Times New Roman</option>
                            </select>
                        </div>

                        <div className="field-group">
                            <label className="field-label">Font Size: {currentAssembly.textStyle.fontSizePx}px</label>
                            <input
                                type="range"
                                min="12"
                                max="80"
                                value={currentAssembly.textStyle.fontSizePx}
                                onChange={(e) => updateStorybookAssembly(safeCurrentPage, { textStyle: { fontSizePx: parseInt(e.target.value) } }, { persist: 'debounced' })}
                            />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Line Height: {currentAssembly.textStyle.lineHeight.toFixed(2)}</label>
                            <input
                                type="range"
                                min="1"
                                max="2.2"
                                step="0.05"
                                value={currentAssembly.textStyle.lineHeight}
                                onChange={(e) => updateStorybookAssembly(safeCurrentPage, { textStyle: { lineHeight: parseFloat(e.target.value) } }, { persist: 'debounced' })}
                            />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Letter Spacing: {currentAssembly.textStyle.letterSpacingPx}px</label>
                            <input
                                type="range"
                                min="-2"
                                max="6"
                                step="0.5"
                                value={currentAssembly.textStyle.letterSpacingPx}
                                onChange={(e) => updateStorybookAssembly(safeCurrentPage, { textStyle: { letterSpacingPx: parseFloat(e.target.value) } }, { persist: 'debounced' })}
                            />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Padding: {currentAssembly.overlay.paddingPx}px</label>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={currentAssembly.overlay.paddingPx}
                                onChange={(e) => updateStorybookAssembly(safeCurrentPage, { overlay: { paddingPx: parseInt(e.target.value) } }, { persist: 'debounced' })}
                            />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Overlay Opacity: {Math.round(currentAssembly.overlay.textOpacity * 100)}%</label>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={currentAssembly.overlay.textOpacity * 100}
                                onChange={(e) => updateStorybookAssembly(safeCurrentPage, { overlay: { textOpacity: parseInt(e.target.value) / 100 } }, { persist: 'debounced' })}
                            />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Image Fit</label>
                            <div className="preset-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                <button
                                    className={`preset-btn ${currentAssembly.image.fit === 'contain' ? 'active' : ''}`}
                                    onClick={() => updateStorybookAssembly(safeCurrentPage, { image: { fit: 'contain' } }, { persist: 'immediate' })}
                                    type="button"
                                >
                                    Contain
                                </button>
                                <button
                                    className={`preset-btn ${currentAssembly.image.fit === 'cover' ? 'active' : ''}`}
                                    onClick={() => updateStorybookAssembly(safeCurrentPage, { image: { fit: 'cover' } }, { persist: 'immediate' })}
                                    type="button"
                                >
                                    Cover
                                </button>
                            </div>
                        </div>

                        <div className="field-group">
                            <label className="field-label">Image Vertical Position: {Math.round(currentAssembly.image.posY)}%</label>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={currentAssembly.image.posY}
                                onChange={(e) => updateStorybookAssembly(safeCurrentPage, { image: { posY: parseInt(e.target.value) } }, { persist: 'debounced' })}
                            />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Image Horizontal Position: {Math.round(currentAssembly.image.posX)}%</label>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={currentAssembly.image.posX}
                                onChange={(e) => updateStorybookAssembly(safeCurrentPage, { image: { posX: parseInt(e.target.value) } }, { persist: 'debounced' })}
                            />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Image Zoom: {currentAssembly.image.zoom.toFixed(2)}x</label>
                            <input
                                type="range"
                                min="1"
                                max="2"
                                step="0.05"
                                value={currentAssembly.image.zoom}
                                onChange={(e) => updateStorybookAssembly(safeCurrentPage, { image: { zoom: parseFloat(e.target.value) } }, { persist: 'debounced' })}
                            />
                            <button
                                className="btn-secondary"
                                type="button"
                                onClick={() => updateStorybookAssembly(safeCurrentPage, { image: { posX: 50, posY: 50, zoom: 1 } }, { persist: 'immediate' })}
                            >
                                Reset Image Position
                            </button>
                        </div>

                        <div className="color-row">
                            <div className="field-group">
                                <label className="field-label">Text Color</label>
                                <input
                                    type="color"
                                    value={currentAssembly.overlay.textColor}
                                    onChange={e => updateStorybookAssembly(safeCurrentPage, { overlay: { textColor: e.target.value } }, { persist: 'debounced' })}
                                />
                            </div>
                            <div className="field-group">
                                <label className="field-label">Theme Color</label>
                                <input
                                    type="color"
                                    value={currentAssembly.overlay.bgColor}
                                    onChange={e => updateStorybookAssembly(safeCurrentPage, { overlay: { bgColor: e.target.value } }, { persist: 'debounced' })}
                                />
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

            {/* Offscreen capture target (no UI, no page switching) */}
            <div
                aria-hidden="true"
                style={{
                    position: 'fixed',
                    left: '-20000px',
                    top: '0',
                    width: '1200px',
                    height: '800px',
                    pointerEvents: 'none',
                }}
            >
                <div
                    className={`page-composer layout-${captureAssembly.layout}`}
                    style={captureStyle}
                    ref={capturePreviewRef}
                >
                    <div className="composer-image-area" style={{ backgroundColor: '#222' }}>
                        {!captureImgSrc && <div className="placeholder-msg">No Image Generated</div>}
                        {captureImgSrc && (
                            <img
                                className="composer-image"
                                src={captureImgSrc}
                                alt={`Capture page ${capturePageIndex + 1}`}
                                style={{
                                    objectFit: captureAssembly.image.fit,
                                    objectPosition: `${captureAssembly.image.posX}% ${captureAssembly.image.posY}%`,
                                    transform: `scale(${captureAssembly.image.zoom})`,
                                    transformOrigin: `${captureAssembly.image.posX}% ${captureAssembly.image.posY}%`,
                                }}
                            />
                        )}
                    </div>
                    <div className="composer-text-area">
                        <div className="storybook-rt-content">
                            <div
                                className="tiptap"
                                dangerouslySetInnerHTML={{ __html: captureAssembly.text.html || '<p></p>' }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StorybookAssembler;
