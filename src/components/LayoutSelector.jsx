import React from 'react';
import { getLayoutsByPanelCount, toSvgPath } from '../data/layoutTemplates';

const LayoutSelector = ({ isOpen, onClose, panelCount, selectedLayoutId, onSelectLayout }) => {
    if (!isOpen) return null;

    const availableLayouts = getLayoutsByPanelCount(panelCount);

    // Render a mini preview of the layout with polygon panels
    const renderLayoutPreview = (layout) => {
        const svgWidth = 80;
        const svgHeight = 120; // 2:3 aspect ratio

        return (
            <svg 
                width={svgWidth} 
                height={svgHeight} 
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="layout-preview-svg"
            >
                {/* Background */}
                <rect 
                    x={0} 
                    y={0} 
                    width={100} 
                    height={100} 
                    fill="var(--bg-tertiary)" 
                />
                {/* Panel polygons */}
                {layout.panels.map((panel, idx) => {
                    // Calculate centroid for label positioning
                    const centroidX = panel.points.reduce((sum, p) => sum + p[0], 0) / panel.points.length;
                    const centroidY = panel.points.reduce((sum, p) => sum + p[1], 0) / panel.points.length;
                    
                    // Calculate approximate panel size for font scaling
                    const minX = Math.min(...panel.points.map(p => p[0]));
                    const maxX = Math.max(...panel.points.map(p => p[0]));
                    const minY = Math.min(...panel.points.map(p => p[1]));
                    const maxY = Math.max(...panel.points.map(p => p[1]));
                    const panelSize = Math.min(maxX - minX, maxY - minY);
                    
                    return (
                        <g key={idx}>
                            <path
                                d={toSvgPath(panel.points)}
                                fill="var(--accent)"
                                fillOpacity={0.3}
                                stroke="var(--accent)"
                                strokeWidth={1.5}
                            />
                            <text
                                x={centroidX}
                                y={centroidY}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fill="var(--text)"
                                fontSize={Math.max(panelSize * 0.35, 8)}
                                fontWeight="bold"
                            >
                                {idx + 1}
                            </text>
                        </g>
                    );
                })}
            </svg>
        );
    };

    return (
        <div className="layout-selector-overlay" onClick={onClose}>
            <div className="layout-selector-modal" onClick={e => e.stopPropagation()}>
                <div className="layout-selector-header">
                    <h3>Select Page Layout</h3>
                    <p className="layout-selector-subtitle">
                        {availableLayouts.length} layouts available for {panelCount} panels
                    </p>
                    <button className="layout-selector-close" onClick={onClose}>×</button>
                </div>

                <div className="layout-selector-grid">
                    {availableLayouts.map(layout => (
                        <div
                            key={layout.id}
                            className={`layout-option ${selectedLayoutId === layout.id ? 'selected' : ''}`}
                            onClick={() => onSelectLayout(layout)}
                        >
                            <div className="layout-preview">
                                {renderLayoutPreview(layout)}
                            </div>
                            <div className="layout-name">{layout.name}</div>
                            {selectedLayoutId === layout.id && (
                                <div className="layout-selected-badge">Selected</div>
                            )}
                        </div>
                    ))}
                </div>

                {availableLayouts.length === 0 && (
                    <div className="layout-selector-empty">
                        <p>No layouts available for {panelCount} panels.</p>
                        <p className="hint">Try generating a storyboard with 2-9 panels.</p>
                    </div>
                )}

                <div className="layout-selector-footer">
                    <button className="btn-secondary" onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>
    );
};

export default LayoutSelector;
