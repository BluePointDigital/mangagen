import React, { useState } from 'react';

const ProjectPreviewer = ({ isOpen, onClose, project, appMode }) => {
    const [currentPage, setCurrentPage] = useState(0);
    const [textMode, setTextMode] = useState('full'); // 'short', 'full', or 'prompt'
    const pages = project?.plannedPages || [];




    // Helper to get image source from page data
    const getImageSrc = (page) => {
        if (page?.generatedResult?.type === 'image') {
            return `data:${page.generatedResult.mimeType};base64,${page.generatedResult.data}`;
        }
        return null;
    };

    // Helper to extract verbatim text using anchors (fuzzy matching for robustness)
    const verbatimSegments = React.useMemo(() => {
        if (!project?.story || !pages.length) return [];

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

                if (!startPattern || !endPattern) {
                    results.push(null);
                    return;
                }

                const startRegex = new RegExp(startPattern, 'i');
                const endRegex = new RegExp(endPattern, 'i');

                // Search for start anchor from current position onwards
                const startSlice = fullStory.slice(currentSearchPos);
                const startMatch = startSlice.match(startRegex);

                if (!startMatch) {
                    // Fallback: try searching the whole story if sequential search fails
                    const globalStartMatch = fullStory.match(startRegex);
                    if (!globalStartMatch) {
                        results.push(null);
                        return;
                    }
                    // If global found, we'll use that but warns it might be out of order
                    const globalStartIdx = globalStartMatch.index;
                    const searchSlice = fullStory.slice(globalStartIdx);
                    const endMatch = searchSlice.match(endRegex);

                    if (!endMatch) {
                        results.push(null);
                        return;
                    }
                    const text = fullStory.substring(globalStartIdx, globalStartIdx + endMatch.index + endMatch[0].length).trim();
                    results.push(text);
                    currentSearchPos = globalStartIdx + endMatch.index + endMatch[0].length;
                    return;
                }

                const startIdx = currentSearchPos + startMatch.index;
                const searchSlice = fullStory.slice(startIdx);
                const endMatch = searchSlice.match(endRegex);

                if (!endMatch) {
                    results.push(null);
                    return;
                }

                const endIdxInSlice = endMatch.index + endMatch[0].length;
                const text = fullStory.substring(startIdx, startIdx + endIdxInSlice).trim();
                results.push(text);

                // Update search position for next page to be the end of this one
                currentSearchPos = startIdx + endIdxInSlice;
            } catch (err) {
                console.error(`Extraction error at page ${idx}:`, err);
                results.push(null);
            }
        });

        return results;
    }, [project?.story, pages]);

    if (!isOpen || !project) return null;

    const currentData = pages[currentPage];
    const hasNext = currentPage < pages.length - 1;
    const hasPrev = currentPage > 0;

    const handleNext = () => hasNext && setCurrentPage(currentPage + 1);
    const handlePrev = () => hasPrev && setCurrentPage(currentPage - 1);

    return (
        <div className="modal-overlay previewer-overlay" onClick={onClose}>
            <div className="previewer-card animate-in" onClick={e => e.stopPropagation()}>
                <div className="previewer-header">
                    <div className="project-info">
                        <h3 className="heading-font">{project.name}</h3>
                        <span className="page-indicator">Page {currentPage + 1} of {pages.length}</span>
                    </div>
                    {appMode === 'storybook' && (
                        <div className="text-toggle-group">
                            <button
                                className={`toggle-pill ${textMode === 'short' ? 'active' : ''}`}
                                onClick={() => setTextMode('short')}
                                title="Summarized version"
                            >
                                📝 Short
                            </button>
                            <button
                                className={`toggle-pill ${textMode === 'full' ? 'active' : ''}`}
                                onClick={() => setTextMode('full')}
                                title="Original verbatim text"
                            >
                                📖 Full Story
                            </button>
                            <button
                                className={`toggle-pill ${textMode === 'prompt' ? 'active' : ''}`}
                                onClick={() => setTextMode('prompt')}
                                title="AI Generation Instructions"
                            >
                                🎨 Prompt
                            </button>
                        </div>
                    )}
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>

                <div className={`previewer-body ${appMode}`}>
                    {appMode === 'storybook' ? (
                        <div className="storybook-layout">
                            <div className="storybook-text-side">
                                <div className="text-content">
                                    {(() => {
                                        if (textMode === 'prompt') return currentData?.pageContent || "No prompt description found.";
                                        if (textMode === 'short') return currentData?.storySegment || "No summary found.";

                                        // Full Text mode: Use pre-calculated verbatim segment
                                        return verbatimSegments[currentPage] || currentData?.storySegment || "No story segment found.";
                                    })()}
                                </div>
                            </div>
                            <div className="storybook-image-side">
                                {getImageSrc(currentData) ? (
                                    <img src={getImageSrc(currentData)} alt={`Page ${currentPage + 1}`} className="preview-img" />
                                ) : (
                                    <div className="preview-placeholder">
                                        <div className="loader small"></div>
                                        <p>Image not generated for this page</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="manga-layout">
                            {getImageSrc(currentData) ? (
                                <img src={getImageSrc(currentData)} alt={`Page ${currentPage + 1}`} className="preview-img manga-page" />
                            ) : (
                                <div className="preview-placeholder">
                                    <div className="loader small"></div>
                                    <p>Manga page not generated/assembled</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="previewer-footer">
                    <button
                        className="nav-arrow prev"
                        onClick={handlePrev}
                        disabled={!hasPrev}
                    >
                        ← Previous
                    </button>
                    <div className="progress-dots">
                        {pages.map((_, i) => (
                            <div
                                key={i}
                                className={`dot ${i === currentPage ? 'active' : ''}`}
                                onClick={() => setCurrentPage(i)}
                            />
                        ))}
                    </div>
                    <button
                        className="nav-arrow next"
                        onClick={handleNext}
                        disabled={!hasNext}
                    >
                        Next →
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ProjectPreviewer;
