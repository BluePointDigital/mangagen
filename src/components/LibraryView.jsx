import React, { useState } from 'react';
import ImageEditorModal from './ImageEditorModal';

const LibraryView = ({ library, onRefresh, projectId }) => {
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editingImage, setEditingImage] = useState(null);

    return (
        <div className="animate-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
                <h2 className="heading-font" style={{ fontSize: '2rem', fontWeight: 700 }}>Project Archives {projectId && <span style={{ fontSize: '1rem', opacity: 0.5 }}>({projectId})</span>}</h2>
                <button
                    onClick={onRefresh}
                    className="tab-btn"
                    style={{ background: 'var(--panel-bg)', border: '1px solid var(--border)' }}
                >
                    Sync Folders
                </button>
            </div>

            <Section title="Character Archives" items={library.characters} onEdit={(url) => { setEditingImage(url); setIsEditorOpen(true); }} />
            <Section title="Location References" items={library.locations} onEdit={(url) => { setEditingImage(url); setIsEditorOpen(true); }} />
            <Section title="Style References" items={library.style} onEdit={(url) => { setEditingImage(url); setIsEditorOpen(true); }} />
            <Section title="Final Masterpieces" items={library.pages} onEdit={(url) => { setEditingImage(url); setIsEditorOpen(true); }} />

            <ImageEditorModal
                isOpen={isEditorOpen}
                onClose={() => setIsEditorOpen(false)}
                imageData={editingImage}
                projectId={projectId}
                engine="flash" // Default to flash for library edits
                onSaveEdit={async (newImage) => {
                    // For library edits, we likely want to save a NEW version or overwrite
                    // For now, let's just save as a new edited version
                    const filename = `edited_${Date.now()}.png`;
                    const imageData = `data:${newImage.mimeType};base64,${newImage.data}`;

                    try {
                        const res = await fetch('/api/save', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filename, imageData, projectId })
                        });
                        if (res.ok) {
                            alert('Edited version saved to project library!');
                            onRefresh();
                        }
                    } catch (e) {
                        alert('Failed to save edited version');
                    }
                }}
            />
        </div>
    );
};

const Section = ({ title, items, onEdit }) => (
    <div style={{ marginBottom: '50px' }}>
        <div className="section-header">
            <h3 className="section-title">{title}</h3>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{items.length} items</span>
        </div>

        {items.length === 0 ? (
            <div style={{
                padding: '60px',
                textAlign: 'center',
                background: 'var(--panel-bg)',
                borderRadius: 'var(--radius-lg)',
                border: '1px dashed var(--border)',
                color: 'var(--text-muted)'
            }}>
                No assets detected in regional directory
            </div>
        ) : (
            <div className="library-grid">
                {items.filter(item => item.type === 'image').map((item, i) => (
                    <div key={i} className="asset-card image-hover-container">
                        <img src={item.url} alt={item.name} />
                        <div className="image-overlay-actions mini">
                            <button className="action-pill edit" onClick={() => onEdit(item.url)}>Edit</button>
                        </div>
                        <div className="asset-info">
                            <p style={{ fontSize: '0.75rem', fontWeight: 600 }}>{item.name}</p>
                        </div>
                    </div>
                ))}
            </div>
        )}
    </div>
);

export default LibraryView;
