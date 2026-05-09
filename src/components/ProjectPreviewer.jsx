import React, { useMemo, useState } from 'react';
import { getDisplayImageSrc } from '../lib/assets.mjs';
import { extractVerbatimSegments } from '../lib/storySegments.mjs';

const ProjectPreviewer = ({ isOpen, onClose, project, appMode }) => {
    const [currentPage, setCurrentPage] = useState(0);
    const [textMode, setTextMode] = useState('full');
    const pages = project?.plannedPages || [];

    const verbatimSegments = useMemo(
        () => extractVerbatimSegments(project?.story, pages),
        [project?.story, pages]
    );

    if (!isOpen || !project) return null;

    const currentData = pages[currentPage];
    const hasNext = currentPage < pages.length - 1;
    const hasPrev = currentPage > 0;
    const imageSrc = getDisplayImageSrc(currentData?.generatedAsset);

    return (
        <div className="modal-overlay previewer-overlay" onClick={onClose}>
            <div className="previewer-card animate-in" onClick={(event) => event.stopPropagation()}>
                <div className="previewer-header">
                    <div className="project-info">
                        <h3 className="heading-font">{project.name}</h3>
                        <span className="page-indicator">Page {currentPage + 1} of {pages.length}</span>
                    </div>
                    {appMode === 'storybook' && (
                        <div className="text-toggle-group">
                            <button className={`toggle-pill ${textMode === 'short' ? 'active' : ''}`} onClick={() => setTextMode('short')}>
                                Short
                            </button>
                            <button className={`toggle-pill ${textMode === 'full' ? 'active' : ''}`} onClick={() => setTextMode('full')}>
                                Full Story
                            </button>
                            <button className={`toggle-pill ${textMode === 'prompt' ? 'active' : ''}`} onClick={() => setTextMode('prompt')}>
                                Prompt
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
                                    {textMode === 'prompt'
                                        ? currentData?.pageContent || 'No prompt description found.'
                                        : textMode === 'short'
                                            ? currentData?.storySegment || 'No summary found.'
                                            : verbatimSegments[currentPage] || currentData?.storySegment || 'No story segment found.'}
                                </div>
                            </div>
                            <div className="storybook-image-side">
                                {imageSrc ? (
                                    <img src={imageSrc} alt={`Page ${currentPage + 1}`} className="preview-img" />
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
                            {imageSrc ? (
                                <img src={imageSrc} alt={`Page ${currentPage + 1}`} className="preview-img manga-page" />
                            ) : (
                                <div className="preview-placeholder">
                                    <div className="loader small"></div>
                                    <p>Manga page not generated or assembled</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="previewer-footer">
                    <button className="nav-arrow prev" onClick={() => hasPrev && setCurrentPage(currentPage - 1)} disabled={!hasPrev}>
                        {'< Previous'}
                    </button>
                    <div className="progress-dots">
                        {pages.map((_, index) => (
                            <div key={index} className={`dot ${index === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(index)} />
                        ))}
                    </div>
                    <button className="nav-arrow next" onClick={() => hasNext && setCurrentPage(currentPage + 1)} disabled={!hasNext}>
                        {'Next >'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ProjectPreviewer;
