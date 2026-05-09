import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import FontFamily from '@tiptap/extension-font-family';
import { StorybookRichTextContent, StorybookRichTextToolbar } from './StorybookRichTextEditor';
import { getDisplayImageSrc } from '../lib/assets.mjs';
import {
    STORYBOOK_TEXT_SOURCE,
    getStorybookTextHtmlForSource,
    getStorybookTextSourceLabel,
    normalizeStorybookText,
} from '../lib/storybookAssembly.mjs';
import {
    analyzeBookletExport,
    buildBookletImposition,
    normalizeStorybookBooklet,
} from '../lib/storybookBooklet.mjs';
import { extractVerbatimSegments } from '../lib/storySegments.mjs';

const DEFAULT_LAYOUT = 'overlay-bottom';
const PAGE_CANVAS = { width: 1200, height: 800 };
const COVER_CANVAS = { width: 600, height: 800 };

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const loadHtml2Canvas = async () => (await import('html2canvas')).default;
const loadJsPdf = async () => (await import('jspdf')).jsPDF;

const defaultImageFitForLayout = (layout) => {
    if (layout === 'side-left' || layout === 'side-right') return 'contain';
    return 'cover';
};

const normalizeStorybookAssembly = (existing, { fallbackText, layoutFallback, promptText, summaryText } = {}) => {
    const layout = existing?.layout || layoutFallback || DEFAULT_LAYOUT;
    const imageFit = existing?.image?.fit || defaultImageFitForLayout(layout);
    const text = normalizeStorybookText(existing?.text, { fallbackText, promptText, summaryText });

    return {
        layout,
        image: {
            fit: imageFit,
            posX: typeof existing?.image?.posX === 'number' ? existing.image.posX : 50,
            posY: typeof existing?.image?.posY === 'number' ? existing.image.posY : 50,
            zoom: typeof existing?.image?.zoom === 'number' ? existing.image.zoom : 1.0,
        },
        text,
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

const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '0,0,0';
};

const buildCanvasStyle = (model, width, height) => ({
    '--bg-color': model.overlay.bgColor,
    '--text-color': model.overlay.textColor,
    '--padding': `${model.overlay.paddingPx}px`,
    '--overlay-bg': `rgba(${hexToRgb(model.overlay.bgColor)}, ${model.overlay.textOpacity})`,
    '--rt-font-family': model.textStyle.fontFamily,
    '--rt-font-size': `${model.textStyle.fontSizePx}px`,
    '--rt-line-height': String(model.textStyle.lineHeight),
    '--rt-letter-spacing': `${model.textStyle.letterSpacingPx}px`,
    width: `${width}px`,
    height: `${height}px`,
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
});

const StaticRichText = ({ html }) => (
    <div className="storybook-rt-content">
        <div className="tiptap" dangerouslySetInnerHTML={{ __html: html || '<p></p>' }} />
    </div>
);

const StoryPageCanvas = React.forwardRef(function StoryPageCanvas({
    assembly,
    editor,
    html,
    imgSrc,
    label,
    onUploadClick,
    style,
    uploadLabel,
}, ref) {
    return (
        <div className={`page-composer layout-${assembly.layout}`} style={style} ref={ref}>
            <div className="composer-image-area" style={{ backgroundColor: '#222' }}>
                {!imgSrc && <div className="placeholder-msg">No Image Generated</div>}
                {imgSrc && (
                    <img
                        className="composer-image"
                        src={imgSrc}
                        alt={label}
                        style={{
                            objectFit: assembly.image.fit,
                            objectPosition: `${assembly.image.posX}% ${assembly.image.posY}%`,
                            transform: `scale(${assembly.image.zoom})`,
                            transformOrigin: `${assembly.image.posX}% ${assembly.image.posY}%`,
                        }}
                    />
                )}
                {onUploadClick && (
                    <button
                        className="assembler-upload-btn"
                        data-html2canvas-ignore="true"
                        onClick={onUploadClick}
                        title="Upload or replace image for this surface"
                        type="button"
                    >
                        {uploadLabel}
                    </button>
                )}
            </div>
            <div className="composer-text-area">
                {editor ? <StorybookRichTextContent editor={editor} /> : <StaticRichText html={html} />}
            </div>
        </div>
    );
});

const BookletCoverCanvas = React.forwardRef(function BookletCoverCanvas({
    cover,
    editor,
    html,
    imgSrc,
    label,
    onUploadClick,
    style,
    uploadLabel,
}, ref) {
    return (
        <div className="booklet-cover-composer" style={style} ref={ref}>
            <div className="booklet-cover-image-area">
                {!imgSrc && <div className="placeholder-msg">No Cover Image</div>}
                {imgSrc && (
                    <img
                        className="booklet-cover-image"
                        src={imgSrc}
                        alt={label}
                        style={{
                            objectFit: cover.image.fit,
                            objectPosition: `${cover.image.posX}% ${cover.image.posY}%`,
                            transform: `scale(${cover.image.zoom})`,
                            transformOrigin: `${cover.image.posX}% ${cover.image.posY}%`,
                        }}
                    />
                )}
                {onUploadClick && (
                    <button
                        className="assembler-upload-btn"
                        data-html2canvas-ignore="true"
                        onClick={onUploadClick}
                        title="Upload or replace image for this cover"
                        type="button"
                    >
                        {uploadLabel}
                    </button>
                )}
            </div>
            <div className="booklet-cover-text-area">
                {editor ? <StorybookRichTextContent editor={editor} /> : <StaticRichText html={html} />}
            </div>
        </div>
    );
});

const StorybookAssembler = ({
    isOpen,
    onClose,
    onNotify,
    onPersistProjectPatch,
    onSaveProjectAsset,
    project,
}) => {
    const [currentPage, setCurrentPage] = useState(0);
    const [draftPages, setDraftPages] = useState([]);
    const [draftBooklet, setDraftBooklet] = useState(() => normalizeStorybookBooklet());
    const [isInitialized, setIsInitialized] = useState(false);
    const initializedProjectIdRef = useRef(null);

    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);
    const [scale, setScale] = useState(0.65);
    const [activeSurface, setActiveSurface] = useState({ type: 'page' });
    const [captureSurface, setCaptureSurface] = useState({ type: 'page', pageIndex: 0 });

    const containerRef = useRef(null);
    const capturePreviewRef = useRef(null);
    const imageUploadRef = useRef(null);
    const persistTimerRef = useRef(null);
    const hiddenTextColorInputRef = useRef(null);
    const hiddenHighlightColorInputRef = useRef(null);
    const draftPagesRef = useRef([]);
    const draftBookletRef = useRef(normalizeStorybookBooklet());

    const pages = draftPages;
    const booklet = normalizeStorybookBooklet(draftBooklet);
    const safeCurrentPage = Math.min(Math.max(0, currentPage), Math.max(0, pages.length - 1));
    const activeCanvas = activeSurface.type === 'page' ? PAGE_CANVAS : COVER_CANVAS;

    const schedulePersistProject = (patch, { immediate = false } = {}) => {
        if (!onPersistProjectPatch) return;
        if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
        if (immediate) {
            onPersistProjectPatch(patch);
            return;
        }
        persistTimerRef.current = window.setTimeout(() => {
            onPersistProjectPatch(patch);
        }, 650);
    };

    useEffect(() => () => {
        if (persistTimerRef.current) {
            window.clearTimeout(persistTimerRef.current);
        }
    }, []);

    const verbatimSegments = useMemo(
        () => extractVerbatimSegments(project?.story, project?.plannedPages),
        [project?.story, project?.plannedPages]
    );

    const getTextOptionsForPage = (page, pageIdx) => ({
        fallbackText: verbatimSegments[pageIdx] || page?.storySegment || '',
        promptText: page?.pageContent,
        summaryText: page?.storySegment,
    });

    const buildPersistPatch = (nextPages = draftPagesRef.current, nextBooklet = draftBookletRef.current) => ({
        plannedPages: nextPages,
        storybookBooklet: nextBooklet,
    });

    const applyTextSourceToPage = (pageIdx, source) => {
        const page = pages[pageIdx];
        if (!page) return;

        const nextHtml = getStorybookTextHtmlForSource(source, getTextOptionsForPage(page, pageIdx));
        if (!nextHtml) return;

        updateStorybookAssembly(pageIdx, { text: { html: nextHtml, source } }, { persist: 'immediate' });
    };

    useEffect(() => {
        if (!isOpen || !project) {
            setIsInitialized(false);
            initializedProjectIdRef.current = null;
            draftPagesRef.current = [];
            draftBookletRef.current = normalizeStorybookBooklet();
            return;
        }

        const shouldInit = !isInitialized || initializedProjectIdRef.current !== project.id;
        if (!shouldInit) return;

        initializedProjectIdRef.current = project.id;

        const basePages = project.plannedPages || [];
        let changed = false;
        const nextPages = basePages.map((page, idx) => {
            const normalized = normalizeStorybookAssembly(page?.storybookAssembly, getTextOptionsForPage(page, idx));
            const hadAssembly = !!page?.storybookAssembly;

            if (!hadAssembly) changed = true;
            else {
                if (page.storybookAssembly?.text?.html == null) changed = true;
                if (page.storybookAssembly?.text?.html !== normalized.text.html) changed = true;
                if (page.storybookAssembly?.text?.source !== normalized.text.source) changed = true;
                if (page.storybookAssembly?.image?.fit == null) changed = true;
            }

            return {
                ...page,
                storybookAssembly: normalized,
            };
        });

        const nextBooklet = normalizeStorybookBooklet(project.storybookBooklet);
        if (JSON.stringify(project.storybookBooklet || null) !== JSON.stringify(nextBooklet)) {
            changed = true;
        }

        setDraftPages(nextPages);
        draftPagesRef.current = nextPages;
        setDraftBooklet(nextBooklet);
        draftBookletRef.current = nextBooklet;
        setCurrentPage(0);
        setActiveSurface({ type: 'page' });
        setIsInitialized(true);

        if (changed) {
            schedulePersistProject(buildPersistPatch(nextPages, nextBooklet), { immediate: true });
        }
    }, [isOpen, isInitialized, project, verbatimSegments]);

    useEffect(() => {
        const handleResize = () => {
            if (!containerRef.current) return;

            const { clientHeight, clientWidth } = containerRef.current;
            const availableW = clientWidth - 60;
            const availableH = clientHeight - 170;
            const scaleX = availableW / activeCanvas.width;
            const scaleY = availableH / activeCanvas.height;
            const newScale = Math.max(0.3, Math.min(scaleX, scaleY, 1.0));
            setScale(newScale * 0.92);
        };

        const timeoutId = window.setTimeout(handleResize, 50);
        window.addEventListener('resize', handleResize);

        const observer = new ResizeObserver(handleResize);
        if (containerRef.current) observer.observe(containerRef.current);

        return () => {
            window.clearTimeout(timeoutId);
            window.removeEventListener('resize', handleResize);
            observer.disconnect();
        };
    }, [activeCanvas.height, activeCanvas.width, isOpen]);

    useEffect(() => {
        if (!pages.length) return;
        setCurrentPage((pageIndex) => Math.min(Math.max(0, pageIndex), pages.length - 1));
    }, [pages.length]);

    const updateStorybookAssembly = (pageIdx, patch, { persist = 'debounced' } = {}) => {
        setDraftPages((previousPages) => {
            const nextPages = [...previousPages];
            const page = nextPages[pageIdx];
            if (!page) return previousPages;

            const currentAssembly = normalizeStorybookAssembly(page.storybookAssembly, getTextOptionsForPage(page, pageIdx));
            const updatedAssembly = {
                ...currentAssembly,
                ...patch,
                image: { ...currentAssembly.image, ...(patch.image || {}) },
                text: { ...currentAssembly.text, ...(patch.text || {}) },
                textStyle: { ...currentAssembly.textStyle, ...(patch.textStyle || {}) },
                overlay: { ...currentAssembly.overlay, ...(patch.overlay || {}) },
            };

            nextPages[pageIdx] = { ...page, storybookAssembly: updatedAssembly };
            draftPagesRef.current = nextPages;
            schedulePersistProject(buildPersistPatch(nextPages, draftBookletRef.current), {
                immediate: persist === 'immediate',
            });
            return nextPages;
        });
    };

    const updateBookletCover = (coverKey, patch, { persist = 'debounced' } = {}) => {
        setDraftBooklet((previousBooklet) => {
            const currentBooklet = normalizeStorybookBooklet(previousBooklet);
            const currentCover = currentBooklet.covers[coverKey];
            if (!currentCover) return previousBooklet;

            const updatedCover = {
                ...currentCover,
                ...patch,
                image: { ...currentCover.image, ...(patch.image || {}) },
                text: {
                    ...currentCover.text,
                    ...(patch.text || {}),
                    source: STORYBOOK_TEXT_SOURCE.manual,
                },
                textStyle: { ...currentCover.textStyle, ...(patch.textStyle || {}) },
                overlay: { ...currentCover.overlay, ...(patch.overlay || {}) },
            };

            const nextBooklet = {
                ...currentBooklet,
                covers: {
                    ...currentBooklet.covers,
                    [coverKey]: updatedCover,
                },
            };

            draftBookletRef.current = nextBooklet;
            schedulePersistProject(buildPersistPatch(draftPagesRef.current, nextBooklet), {
                immediate: persist === 'immediate',
            });
            return nextBooklet;
        });
    };

    const updateActiveSurfacePatch = (patch, options) => {
        if (activeSurface.type === 'page') {
            updateStorybookAssembly(safeCurrentPage, patch, options);
            return;
        }

        updateBookletCover(activeSurface.coverKey, patch, options);
    };

    const applyLayoutToAllPages = (layoutValue) => {
        setDraftPages((previousPages) => {
            const nextPages = previousPages.map((page, idx) => {
                const currentAssembly = normalizeStorybookAssembly(page.storybookAssembly, getTextOptionsForPage(page, idx));

                return {
                    ...page,
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

            draftPagesRef.current = nextPages;
            schedulePersistProject(buildPersistPatch(nextPages, draftBookletRef.current), { immediate: true });
            return nextPages;
        });
    };

    const updatePageGeneratedAssetLocal = (pageIdx, generatedAsset) => {
        setDraftPages((previousPages) => {
            const nextPages = [...previousPages];
            if (!nextPages[pageIdx]) return previousPages;

            nextPages[pageIdx] = {
                ...nextPages[pageIdx],
                generatedAsset,
            };

            draftPagesRef.current = nextPages;
            schedulePersistProject(buildPersistPatch(nextPages, draftBookletRef.current), { immediate: true });
            return nextPages;
        });
    };

    const handleImageUpload = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (loadEvent) => {
            const dataUrl = loadEvent.target.result;
            if (!dataUrl || !onSaveProjectAsset) return;

            try {
                if (activeSurface.type === 'page') {
                    const savedAsset = await onSaveProjectAsset({
                        bucket: 'pages',
                        imageData: dataUrl,
                        pageIndex: safeCurrentPage,
                    });
                    if (savedAsset) {
                        updatePageGeneratedAssetLocal(safeCurrentPage, savedAsset);
                    }
                } else {
                    const savedAsset = await onSaveProjectAsset({
                        bucket: 'pages',
                        filename: `cover-${activeSurface.coverKey}`,
                        imageData: dataUrl,
                    });
                    if (savedAsset) {
                        updateBookletCover(activeSurface.coverKey, { generatedAsset: savedAsset }, { persist: 'immediate' });
                    }
                }
            } catch (error) {
                onNotify?.({ message: error.message, title: 'Image Update Failed', type: 'error' });
            }
        };

        reader.readAsDataURL(file);
        event.target.value = '';
    };

    const waitForImages = async (element) => {
        const images = Array.from(element.querySelectorAll('img'));
        await Promise.all(
            images.map(async (img) => {
                if (!img) return;
                if (img.complete && img.naturalWidth > 0) {
                    if (typeof img.decode === 'function') {
                        try {
                            await img.decode();
                        } catch {
                            // Ignore decode failures and fall back to the rendered image.
                        }
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

    const captureRenderableSurface = async (surface, outputScale = 2) => {
        setCaptureSurface(surface);
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));

        const element = capturePreviewRef.current;
        if (!element) return null;

        await waitForImages(element);

        try {
            const html2canvas = await loadHtml2Canvas();
            return await html2canvas(element, {
                backgroundColor: null,
                logging: false,
                scale: outputScale,
                useCORS: true,
                windowHeight: surface.type === 'page' ? PAGE_CANVAS.height : COVER_CANVAS.height,
                windowWidth: surface.type === 'page' ? PAGE_CANVAS.width : COVER_CANVAS.width,
            });
        } catch (error) {
            console.error('Capture failed:', error);
            return null;
        }
    };

    const cropStoryLeaf = (canvas, position) => {
        const leafCanvas = document.createElement('canvas');
        leafCanvas.width = COVER_CANVAS.width;
        leafCanvas.height = COVER_CANVAS.height;

        const context = leafCanvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, leafCanvas.width, leafCanvas.height);

        const halfWidth = canvas.width / 2;
        const sourceX = position === 'left' ? 0 : halfWidth;
        context.drawImage(
            canvas,
            sourceX,
            0,
            halfWidth,
            canvas.height,
            0,
            0,
            leafCanvas.width,
            leafCanvas.height
        );

        return leafCanvas;
    };

    const getLeafKey = (leaf) => {
        if (leaf.kind === 'story') {
            return `page-${leaf.pageIndex}-${leaf.position}`;
        }
        if (leaf.kind === 'cover') {
            return `cover-${leaf.coverKey}`;
        }
        return `blank-${leaf.blankIndex}`;
    };

    const addLeafToPdf = (doc, leaf, x, y, leafImages) => {
        if (leaf.kind === 'blank') return;

        const imageData = leafImages.get(getLeafKey(leaf));
        if (!imageData) return;

        doc.addImage(imageData, 'JPEG', x, y, COVER_CANVAS.width, COVER_CANVAS.height);
    };

    const handleDownloadCurrent = async () => {
        const surface = activeSurface.type === 'page'
            ? { type: 'page', pageIndex: safeCurrentPage }
            : { type: 'cover', coverKey: activeSurface.coverKey };
        const canvas = await captureRenderableSurface(surface, 2);
        if (!canvas) return;

        const link = document.createElement('a');
        link.download = activeSurface.type === 'page'
            ? `storybook_page_${safeCurrentPage + 1}.png`
            : `storybook_${activeSurface.coverKey}_cover.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    const handleExportAllImages = async () => {
        setIsExporting(true);
        setExportProgress(0);

        try {
            for (let index = 0; index < pages.length; index += 1) {
                const canvas = await captureRenderableSurface({ type: 'page', pageIndex: index }, 2);
                if (canvas) {
                    const link = document.createElement('a');
                    link.download = `storybook_page_${index + 1}.png`;
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                }
                setExportProgress(Math.round(((index + 1) / Math.max(1, pages.length)) * 100));
                await sleep(200);
            }

            onNotify?.({ message: 'All pages downloaded.', title: 'Export Complete', type: 'success' });
        } catch (error) {
            onNotify?.({ message: error.message, title: 'Export Failed', type: 'error' });
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportPDF = async () => {
        setIsExporting(true);
        setExportProgress(0);

        try {
            const jsPDF = await loadJsPdf();
            const doc = new jsPDF({
                format: [PAGE_CANVAS.width, PAGE_CANVAS.height],
                orientation: 'landscape',
                unit: 'px',
            });

            for (let index = 0; index < pages.length; index += 1) {
                if (index > 0) doc.addPage([PAGE_CANVAS.width, PAGE_CANVAS.height], 'landscape');

                const canvas = await captureRenderableSurface({ type: 'page', pageIndex: index }, 1.5);
                if (!canvas) {
                    throw new Error(`Failed to capture page ${index + 1}.`);
                }

                const imageData = canvas.toDataURL('image/jpeg', 0.9);
                doc.addImage(imageData, 'JPEG', 0, 0, PAGE_CANVAS.width, PAGE_CANVAS.height);
                setExportProgress(Math.round(((index + 1) / Math.max(1, pages.length)) * 100));
                await sleep(100);
            }

            doc.save(`${project?.name || 'Storybook'}.pdf`);
            onNotify?.({ message: 'Sequential PDF exported.', title: 'Export Complete', type: 'success' });
        } catch (error) {
            console.error(error);
            onNotify?.({ message: error.message, title: 'PDF Export Failed', type: 'error' });
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportBookletPDF = async () => {
        setIsExporting(true);
        setExportProgress(0);

        try {
            const jsPDF = await loadJsPdf();
            const imposition = buildBookletImposition({ booklet, pages });
            const leafImages = new Map();
            const totalSteps = pages.length + 2 + (imposition.sheets.length * 2);
            let completedSteps = 0;

            for (let index = 0; index < pages.length; index += 1) {
                const spreadCanvas = await captureRenderableSurface({ type: 'page', pageIndex: index }, 1.5);
                if (!spreadCanvas) {
                    throw new Error(`Failed to capture page ${index + 1} for booklet export.`);
                }

                leafImages.set(`page-${index}-left`, cropStoryLeaf(spreadCanvas, 'left').toDataURL('image/jpeg', 0.92));
                leafImages.set(`page-${index}-right`, cropStoryLeaf(spreadCanvas, 'right').toDataURL('image/jpeg', 0.92));
                completedSteps += 1;
                setExportProgress(Math.round((completedSteps / totalSteps) * 100));
                await sleep(60);
            }

            for (const coverKey of ['front', 'back']) {
                const coverCanvas = await captureRenderableSurface({ type: 'cover', coverKey }, 2);
                if (!coverCanvas) {
                    throw new Error(`Failed to capture the ${coverKey} cover.`);
                }

                leafImages.set(`cover-${coverKey}`, coverCanvas.toDataURL('image/jpeg', 0.92));
                completedSteps += 1;
                setExportProgress(Math.round((completedSteps / totalSteps) * 100));
                await sleep(60);
            }

            const doc = new jsPDF({
                format: [PAGE_CANVAS.width, PAGE_CANVAS.height],
                orientation: 'landscape',
                unit: 'px',
            });

            let pdfPageIndex = 0;
            for (const sheet of imposition.sheets) {
                for (const sideName of ['front', 'back']) {
                    if (pdfPageIndex > 0) {
                        doc.addPage([PAGE_CANVAS.width, PAGE_CANVAS.height], 'landscape');
                    }

                    const [leftLeaf, rightLeaf] = sheet[sideName];
                    addLeafToPdf(doc, leftLeaf, 0, 0, leafImages);
                    addLeafToPdf(doc, rightLeaf, COVER_CANVAS.width, 0, leafImages);
                    pdfPageIndex += 1;
                    completedSteps += 1;
                    setExportProgress(Math.round((completedSteps / totalSteps) * 100));
                    await sleep(40);
                }
            }

            doc.save(`${project?.name || 'Storybook'}_booklet.pdf`);
            onNotify?.({
                message: 'Booklet PDF exported. Print double-sided and flip on the short edge.',
                title: 'Booklet Export Complete',
                type: 'success',
            });
        } catch (error) {
            console.error(error);
            onNotify?.({ message: error.message, title: 'Booklet Export Failed', type: 'error' });
        } finally {
            setIsExporting(false);
        }
    };

    const safeCurrentData = pages[safeCurrentPage];
    const currentTextOptions = getTextOptionsForPage(safeCurrentData, safeCurrentPage);
    const currentAssembly = normalizeStorybookAssembly(safeCurrentData?.storybookAssembly, currentTextOptions);
    const currentTextSourceLabel = getStorybookTextSourceLabel(currentAssembly.text.source);
    const storyTextHtml = getStorybookTextHtmlForSource(STORYBOOK_TEXT_SOURCE.story, currentTextOptions);
    const summaryTextHtml = getStorybookTextHtmlForSource(STORYBOOK_TEXT_SOURCE.summary, currentTextOptions);
    const promptTextHtml = getStorybookTextHtmlForSource(STORYBOOK_TEXT_SOURCE.prompt, currentTextOptions);
    const showSummarySourceButton = !!summaryTextHtml && summaryTextHtml !== storyTextHtml;
    const showPromptSourceButton = !!promptTextHtml && promptTextHtml !== storyTextHtml;
    const hasStoryText = !!storyTextHtml;
    const currentPageImageSrc = getDisplayImageSrc(safeCurrentData?.generatedAsset);

    const currentCover = activeSurface.type === 'cover' ? booklet.covers[activeSurface.coverKey] : null;
    const currentCoverImageSrc = getDisplayImageSrc(currentCover?.generatedAsset);
    const activeModel = activeSurface.type === 'page' ? currentAssembly : currentCover;
    const activeImageSrc = activeSurface.type === 'page' ? currentPageImageSrc : currentCoverImageSrc;
    const activeSurfaceId = activeSurface.type === 'page' ? `page-${safeCurrentPage}` : `cover-${activeSurface.coverKey}`;
    const activeSurfaceLabel = activeSurface.type === 'page'
        ? `Page ${safeCurrentPage + 1} of ${pages.length}`
        : activeSurface.coverKey === 'front'
            ? 'Front Cover'
            : 'Back Cover';
    const activeCanvasStyle = buildCanvasStyle(activeModel, activeCanvas.width, activeCanvas.height);
    const uploadLabel = activeSurface.type === 'page'
        ? (activeImageSrc ? 'Replace Image' : 'Upload Image')
        : (activeImageSrc ? 'Replace Cover' : 'Upload Cover');
    const bookletAnalysis = useMemo(() => analyzeBookletExport({ pages }), [pages]);
    const unsupportedLayoutLabel = bookletAnalysis.unsupportedPages
        .map((page) => `Page ${page.pageNumber} (${page.layout || 'none'})`)
        .join(', ');

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
            content: activeModel.text.html || '<p></p>',
            editable: !!isOpen,
            onUpdate: ({ editor: nextEditor }) => {
                if (!isOpen) return;
                const html = nextEditor.getHTML();

                if (activeSurface.type === 'page') {
                    updateStorybookAssembly(safeCurrentPage, { text: { html, source: STORYBOOK_TEXT_SOURCE.manual } }, { persist: 'debounced' });
                    return;
                }

                updateBookletCover(activeSurface.coverKey, { text: { html, source: STORYBOOK_TEXT_SOURCE.manual } }, { persist: 'debounced' });
            },
        },
        [activeSurfaceId, isInitialized, isOpen]
    );

    useEffect(() => {
        if (!editor || !isOpen) return;
        const nextHtml = activeModel.text.html || '<p></p>';
        if (editor.getHTML() !== nextHtml) {
            editor.commands.setContent(nextHtml, false);
        }
    }, [activeModel.text.html, editor, isOpen]);

    if (!isOpen || !project || !isInitialized) return null;

    const capturePageData = captureSurface.type === 'page' ? pages[captureSurface.pageIndex] : null;
    const capturePageAssembly = normalizeStorybookAssembly(
        capturePageData?.storybookAssembly,
        getTextOptionsForPage(capturePageData, captureSurface.pageIndex || 0)
    );
    const captureCover = captureSurface.type === 'cover' ? booklet.covers[captureSurface.coverKey] : null;
    const captureModel = captureSurface.type === 'page' ? capturePageAssembly : captureCover;
    const captureStyle = buildCanvasStyle(
        captureModel,
        captureSurface.type === 'page' ? PAGE_CANVAS.width : COVER_CANVAS.width,
        captureSurface.type === 'page' ? PAGE_CANVAS.height : COVER_CANVAS.height
    );
    const captureImageSrc = captureSurface.type === 'page'
        ? getDisplayImageSrc(capturePageData?.generatedAsset)
        : getDisplayImageSrc(captureCover?.generatedAsset);

    return (
        <div className="modal-overlay assembler-overlay" onClick={onClose}>
            <div className="assembler-card animate-in" onClick={(event) => event.stopPropagation()}>
                <div className="assembler-header">
                    <div className="project-info">
                        <h3 className="heading-font">Storybook Assembler (WYSIWYG)</h3>
                        <span className="page-indicator">{activeSurfaceLabel}</span>
                    </div>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>

                <div className="assembler-body">
                    <div className="assembler-preview-side" ref={containerRef}>
                        <StorybookRichTextToolbar
                            editor={editor}
                            onPickTextColor={() => hiddenTextColorInputRef.current?.click()}
                            onPickHighlightColor={() => hiddenHighlightColorInputRef.current?.click()}
                        />
                        <input
                            ref={hiddenTextColorInputRef}
                            onChange={(event) => editor?.chain().focus().setColor(event.target.value).run()}
                            style={{ display: 'none' }}
                            type="color"
                        />
                        <input
                            ref={hiddenHighlightColorInputRef}
                            onChange={(event) => editor?.chain().focus().setHighlight({ color: event.target.value }).run()}
                            style={{ display: 'none' }}
                            type="color"
                        />

                        <div
                            className="canvas-wrapper-dom"
                            style={{
                                transform: `scale(${scale})`,
                                transformOrigin: 'center top',
                                width: `${activeCanvas.width}px`,
                                height: `${activeCanvas.height}px`,
                                flexShrink: 0,
                            }}
                        >
                            {activeSurface.type === 'page' ? (
                                <StoryPageCanvas
                                    assembly={currentAssembly}
                                    editor={editor}
                                    imgSrc={currentPageImageSrc}
                                    label={`Page ${safeCurrentPage + 1}`}
                                    onUploadClick={() => imageUploadRef.current?.click()}
                                    style={activeCanvasStyle}
                                    uploadLabel={uploadLabel}
                                />
                            ) : (
                                <BookletCoverCanvas
                                    cover={currentCover}
                                    editor={editor}
                                    imgSrc={currentCoverImageSrc}
                                    label={activeSurfaceLabel}
                                    onUploadClick={() => imageUploadRef.current?.click()}
                                    style={activeCanvasStyle}
                                    uploadLabel={uploadLabel}
                                />
                            )}
                            <input
                                ref={imageUploadRef}
                                accept="image/*"
                                data-html2canvas-ignore="true"
                                onChange={handleImageUpload}
                                style={{ display: 'none' }}
                                type="file"
                            />
                        </div>

                        {activeSurface.type === 'page' && pages.length > 0 && (
                            <div className="preview-nav" style={{ marginTop: `${Math.max(20, activeCanvas.height - (activeCanvas.height * scale))}px` }}>
                                <button className="nav-arrow" disabled={safeCurrentPage === 0} onClick={() => setCurrentPage((pageIndex) => Math.max(0, pageIndex - 1))}>&lt;</button>
                                <div className="progress-dots">
                                    {pages.map((_, index) => (
                                        <div key={index} className={`dot ${index === safeCurrentPage ? 'active' : ''}`} onClick={() => setCurrentPage(index)} />
                                    ))}
                                </div>
                                <button className="nav-arrow" disabled={safeCurrentPage === pages.length - 1} onClick={() => setCurrentPage((pageIndex) => Math.min(pages.length - 1, pageIndex + 1))}>&gt;</button>
                            </div>
                        )}
                    </div>

                    <aside className="assembler-controls">
                        <div className="field-group">
                            <label className="field-label">Booklet Covers</label>
                            <div className="preset-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                <button
                                    className={`preset-btn ${activeSurface.type === 'cover' && activeSurface.coverKey === 'front' ? 'active' : ''}`}
                                    onClick={() => setActiveSurface({ type: 'cover', coverKey: 'front' })}
                                    type="button"
                                >
                                    Front Cover
                                </button>
                                <button
                                    className={`preset-btn ${activeSurface.type === 'cover' && activeSurface.coverKey === 'back' ? 'active' : ''}`}
                                    onClick={() => setActiveSurface({ type: 'cover', coverKey: 'back' })}
                                    type="button"
                                >
                                    Back Cover
                                </button>
                            </div>
                            {activeSurface.type === 'cover' && (
                                <button
                                    className="btn-secondary"
                                    onClick={() => setActiveSurface({ type: 'page' })}
                                    style={{ marginTop: '10px' }}
                                    type="button"
                                >
                                    Return to Story Pages
                                </button>
                            )}
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '10px' }}>
                                Covers export as portrait booklet pages before and after the story interior.
                            </div>
                        </div>

                        {activeSurface.type === 'page' && (
                            <div className="field-group">
                                <label className="field-label">Text Source</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'space-between' }}>
                                        <span style={{
                                            alignItems: 'center',
                                            background: currentAssembly.text.source === STORYBOOK_TEXT_SOURCE.manual
                                                ? 'rgba(59, 130, 246, 0.16)'
                                                : 'rgba(16, 185, 129, 0.16)',
                                            border: currentAssembly.text.source === STORYBOOK_TEXT_SOURCE.manual
                                                ? '1px solid rgba(59, 130, 246, 0.35)'
                                                : '1px solid rgba(16, 185, 129, 0.35)',
                                            borderRadius: '999px',
                                            color: currentAssembly.text.source === STORYBOOK_TEXT_SOURCE.manual ? '#bfdbfe' : '#bbf7d0',
                                            display: 'inline-flex',
                                            fontSize: '0.76rem',
                                            fontWeight: 700,
                                            gap: '6px',
                                            padding: '6px 10px',
                                        }}>
                                            {currentTextSourceLabel}
                                        </span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>
                                            {currentAssembly.text.source === STORYBOOK_TEXT_SOURCE.manual
                                                ? 'Edited text stays fixed until you reset it.'
                                                : 'Auto-filled text tracks its source until you edit it.'}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <button
                                            className="btn-secondary"
                                            disabled={!hasStoryText || currentAssembly.text.html === storyTextHtml}
                                            onClick={() => applyTextSourceToPage(safeCurrentPage, STORYBOOK_TEXT_SOURCE.story)}
                                            type="button"
                                        >
                                            Reset from Story
                                        </button>
                                        {showSummarySourceButton && (
                                            <button
                                                className="btn-secondary"
                                                disabled={currentAssembly.text.html === summaryTextHtml}
                                                onClick={() => applyTextSourceToPage(safeCurrentPage, STORYBOOK_TEXT_SOURCE.summary)}
                                                type="button"
                                            >
                                                Use Summary Text
                                            </button>
                                        )}
                                        {showPromptSourceButton && (
                                            <button
                                                className="btn-secondary"
                                                disabled={currentAssembly.text.html === promptTextHtml}
                                                onClick={() => applyTextSourceToPage(safeCurrentPage, STORYBOOK_TEXT_SOURCE.prompt)}
                                                type="button"
                                            >
                                                Use Prompt Text
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeSurface.type === 'page' && (
                            <div className="field-group">
                                <label className="field-label">Layout Preset</label>
                                <div className="preset-grid">
                                    <button className={`preset-btn ${currentAssembly.layout === 'overlay-bottom' ? 'active' : ''}`} onClick={() => updateStorybookAssembly(safeCurrentPage, { layout: 'overlay-bottom', image: { fit: defaultImageFitForLayout('overlay-bottom') } }, { persist: 'immediate' })} type="button">Bottom Overlay</button>
                                    <button className={`preset-btn ${currentAssembly.layout === 'overlay-top' ? 'active' : ''}`} onClick={() => updateStorybookAssembly(safeCurrentPage, { layout: 'overlay-top', image: { fit: defaultImageFitForLayout('overlay-top') } }, { persist: 'immediate' })} type="button">Top Overlay</button>
                                    <button className={`preset-btn ${currentAssembly.layout === 'side-left' ? 'active' : ''}`} onClick={() => updateStorybookAssembly(safeCurrentPage, { layout: 'side-left', image: { fit: defaultImageFitForLayout('side-left') } }, { persist: 'immediate' })} type="button">Side-by-Side</button>
                                    <button className={`preset-btn ${currentAssembly.layout === 'side-right' ? 'active' : ''}`} onClick={() => updateStorybookAssembly(safeCurrentPage, { layout: 'side-right', image: { fit: defaultImageFitForLayout('side-right') } }, { persist: 'immediate' })} type="button">Side-by-Side (Rev)</button>
                                    <button className={`preset-btn ${currentAssembly.layout === 'below' ? 'active' : ''}`} onClick={() => updateStorybookAssembly(safeCurrentPage, { layout: 'below', image: { fit: defaultImageFitForLayout('below') } }, { persist: 'immediate' })} type="button">Text Below</button>
                                </div>
                                <button className="btn-secondary" onClick={() => applyLayoutToAllPages(currentAssembly.layout)} style={{ marginTop: '10px' }} type="button">Apply this layout to all pages</button>
                            </div>
                        )}

                        <div className="field-group">
                            <label className="field-label">Font Family</label>
                            <select className="input-glass" onChange={(event) => updateActiveSurfacePatch({ textStyle: { fontFamily: event.target.value } }, { persist: 'debounced' })} value={activeModel.textStyle.fontFamily}>
                                <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
                                <option value="Outfit">Outfit</option>
                                <option value="Arial">Arial</option>
                                <option value="Georgia">Georgia</option>
                                <option value="Times New Roman">Times New Roman</option>
                            </select>
                        </div>

                        <div className="field-group">
                            <label className="field-label">Font Size: {activeModel.textStyle.fontSizePx}px</label>
                            <input max="80" min="12" onChange={(event) => updateActiveSurfacePatch({ textStyle: { fontSizePx: parseInt(event.target.value, 10) } }, { persist: 'debounced' })} type="range" value={activeModel.textStyle.fontSizePx} />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Line Height: {activeModel.textStyle.lineHeight.toFixed(2)}</label>
                            <input max="2.2" min="1" onChange={(event) => updateActiveSurfacePatch({ textStyle: { lineHeight: parseFloat(event.target.value) } }, { persist: 'debounced' })} step="0.05" type="range" value={activeModel.textStyle.lineHeight} />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Letter Spacing: {activeModel.textStyle.letterSpacingPx}px</label>
                            <input max="6" min="-2" onChange={(event) => updateActiveSurfacePatch({ textStyle: { letterSpacingPx: parseFloat(event.target.value) } }, { persist: 'debounced' })} step="0.5" type="range" value={activeModel.textStyle.letterSpacingPx} />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Padding: {activeModel.overlay.paddingPx}px</label>
                            <input max="100" min="0" onChange={(event) => updateActiveSurfacePatch({ overlay: { paddingPx: parseInt(event.target.value, 10) } }, { persist: 'debounced' })} type="range" value={activeModel.overlay.paddingPx} />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Overlay Opacity: {Math.round(activeModel.overlay.textOpacity * 100)}%</label>
                            <input max="100" min="0" onChange={(event) => updateActiveSurfacePatch({ overlay: { textOpacity: parseInt(event.target.value, 10) / 100 } }, { persist: 'debounced' })} type="range" value={activeModel.overlay.textOpacity * 100} />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Image Fit</label>
                            <div className="preset-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                <button className={`preset-btn ${activeModel.image.fit === 'contain' ? 'active' : ''}`} onClick={() => updateActiveSurfacePatch({ image: { fit: 'contain' } }, { persist: 'immediate' })} type="button">Contain</button>
                                <button className={`preset-btn ${activeModel.image.fit === 'cover' ? 'active' : ''}`} onClick={() => updateActiveSurfacePatch({ image: { fit: 'cover' } }, { persist: 'immediate' })} type="button">Cover</button>
                            </div>
                        </div>

                        <div className="field-group">
                            <label className="field-label">Image Vertical Position: {Math.round(activeModel.image.posY)}%</label>
                            <input max="100" min="0" onChange={(event) => updateActiveSurfacePatch({ image: { posY: parseInt(event.target.value, 10) } }, { persist: 'debounced' })} type="range" value={activeModel.image.posY} />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Image Horizontal Position: {Math.round(activeModel.image.posX)}%</label>
                            <input max="100" min="0" onChange={(event) => updateActiveSurfacePatch({ image: { posX: parseInt(event.target.value, 10) } }, { persist: 'debounced' })} type="range" value={activeModel.image.posX} />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Image Zoom: {activeModel.image.zoom.toFixed(2)}x</label>
                            <input max="2" min="1" onChange={(event) => updateActiveSurfacePatch({ image: { zoom: parseFloat(event.target.value) } }, { persist: 'debounced' })} step="0.05" type="range" value={activeModel.image.zoom} />
                            <button className="btn-secondary" onClick={() => updateActiveSurfacePatch({ image: { posX: 50, posY: 50, zoom: 1 } }, { persist: 'immediate' })} type="button">Reset Image Position</button>
                        </div>

                        <div className="color-row">
                            <div className="field-group">
                                <label className="field-label">Text Color</label>
                                <input onChange={(event) => updateActiveSurfacePatch({ overlay: { textColor: event.target.value } }, { persist: 'debounced' })} type="color" value={activeModel.overlay.textColor} />
                            </div>
                            <div className="field-group">
                                <label className="field-label">Theme Color</label>
                                <input onChange={(event) => updateActiveSurfacePatch({ overlay: { bgColor: event.target.value } }, { persist: 'debounced' })} type="color" value={activeModel.overlay.bgColor} />
                            </div>
                        </div>

                        <div className="field-group">
                            <label className="field-label">Booklet Export</label>
                            <div className="booklet-status-card">
                                {!bookletAnalysis.isSupported ? (
                                    <div className="booklet-status-error">Booklet export only supports side-by-side pages. Update these pages first: {unsupportedLayoutLabel}</div>
                                ) : (
                                    <div className="booklet-status-ok">Ready: {bookletAnalysis.totalLeafCount} booklet pages across {bookletAnalysis.sheetCount} sheets.</div>
                                )}
                                <div className="booklet-status-detail">Interior booklet pages: {bookletAnalysis.interiorLeafCount}</div>
                                <div className="booklet-status-detail">Auto-added blanks: {bookletAnalysis.paddingCount}</div>
                                <div className="booklet-status-detail">Print double-sided, flip on short edge.</div>
                            </div>
                        </div>

                        <div className="action-row" style={{ marginTop: 'auto', paddingTop: '20px', display: 'flex', gap: '10px', flexDirection: 'column' }}>
                            <button className="btn-secondary" onClick={handleDownloadCurrent} style={{ width: '100%', textAlign: 'center' }} type="button">{activeSurface.type === 'page' ? 'Download Page Image' : 'Download Cover Image'}</button>
                            <button className="btn-secondary" disabled={isExporting} onClick={handleExportAllImages} style={{ width: '100%', textAlign: 'center' }} type="button">{isExporting ? 'Processing...' : 'Download All Pages (Images)'}</button>
                            <button className="btn-primary" disabled={isExporting} onClick={handleExportPDF} style={{ width: '100%', textAlign: 'center' }} type="button">{isExporting ? `Exporting (${exportProgress}%)` : 'Export Book PDF'}</button>
                            <button className="btn-primary" disabled={isExporting || !bookletAnalysis.isSupported} onClick={handleExportBookletPDF} style={{ width: '100%', textAlign: 'center' }} type="button">{isExporting ? `Exporting (${exportProgress}%)` : 'Export Booklet PDF'}</button>
                        </div>
                    </aside>
                </div>
            </div>

            <div
                aria-hidden="true"
                style={{
                    position: 'fixed',
                    left: '-20000px',
                    top: 0,
                    width: `${captureSurface.type === 'page' ? PAGE_CANVAS.width : COVER_CANVAS.width}px`,
                    height: `${captureSurface.type === 'page' ? PAGE_CANVAS.height : COVER_CANVAS.height}px`,
                    pointerEvents: 'none',
                }}
            >
                {captureSurface.type === 'page' ? (
                    <StoryPageCanvas assembly={capturePageAssembly} html={capturePageAssembly.text.html} imgSrc={captureImageSrc} label={`Capture page ${(captureSurface.pageIndex || 0) + 1}`} ref={capturePreviewRef} style={captureStyle} />
                ) : (
                    <BookletCoverCanvas cover={captureCover} html={captureCover.text.html} imgSrc={captureImageSrc} label={`${captureSurface.coverKey} cover capture`} ref={capturePreviewRef} style={captureStyle} />
                )}
            </div>
        </div>
    );
};

export default StorybookAssembler;
