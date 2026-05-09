import React, { useState } from 'react';
import ImageEditorModal from './ImageEditorModal';
import StatusMessage from './ui/StatusMessage';
import { saveAsset } from '../lib/api.mjs';
import { getDisplayImageSrc, inlineImageToSavePayload } from '../lib/assets.mjs';

const LibraryView = ({ library, onNotify, onRefresh, projectId }) => {
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [statusMessage, setStatusMessage] = useState('');
    const [uploadBucket, setUploadBucket] = useState('characters');
    const [uploadFile, setUploadFile] = useState(null);
    const [assetMetadata, setAssetMetadata] = useState({ displayName: '', notes: '', role: '', usage: '' });

    const openEditor = (item) => {
        setEditingItem(item);
        setStatusMessage('');
        setIsEditorOpen(true);
    };

    const handleSaveEdit = async (newImage) => {
        if (!editingItem) return;

        try {
            const { dataUrl } = await inlineImageToSavePayload(newImage);
            await saveAsset({
                bucket: editingItem.bucket,
                filename: editingItem.name,
                imageData: dataUrl,
                projectId,
            });
            setStatusMessage(`Saved ${editingItem.name} back to ${editingItem.bucket}.`);
            onNotify?.({ message: `${editingItem.name} updated.`, title: 'Asset Saved', type: 'success' });
            setIsEditorOpen(false);
            setEditingItem(null);
            await onRefresh();
        } catch (error) {
            setStatusMessage(error.message);
            onNotify?.({ message: error.message, title: 'Asset Save Failed', type: 'error' });
        }
    };

    const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Failed to read upload'));
        reader.readAsDataURL(file);
    });

    const handleUploadAsset = async (event) => {
        event.preventDefault();
        if (!uploadFile) {
            setStatusMessage('Choose an image to import.');
            return;
        }

        try {
            const imageData = await readFileAsDataUrl(uploadFile);
            await saveAsset({
                bucket: uploadBucket,
                filename: uploadFile.name,
                imageData,
                metadata: assetMetadata,
                projectId,
            });
            setStatusMessage(`Imported ${uploadFile.name}.`);
            setUploadFile(null);
            setAssetMetadata({ displayName: '', notes: '', role: '', usage: '' });
            onNotify?.({ message: `${uploadFile.name} imported.`, title: 'Asset Imported', type: 'success' });
            await onRefresh();
        } catch (error) {
            setStatusMessage(error.message);
            onNotify?.({ message: error.message, title: 'Asset Import Failed', type: 'error' });
        }
    };

    return (
        <div className="animate-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
                <h2 className="heading-font" style={{ fontSize: '2rem', fontWeight: 700 }}>
                    Project Archives {projectId && <span style={{ fontSize: '1rem', opacity: 0.5 }}>({projectId})</span>}
                </h2>
                <button onClick={onRefresh} className="tab-btn" style={{ background: 'var(--panel-bg)', border: '1px solid var(--border)' }}>
                    Sync Folders
                </button>
            </div>

            <StatusMessage message={statusMessage} tone={/saved|imported/i.test(statusMessage) ? 'success' : 'error'} />

            <form className="asset-import-panel" onSubmit={handleUploadAsset}>
                <div>
                    <label className="field-label">Bucket</label>
                    <select className="input-glass" value={uploadBucket} onChange={(event) => setUploadBucket(event.target.value)}>
                        <option value="characters">Characters</option>
                        <option value="locations">Locations</option>
                        <option value="style">Style</option>
                    </select>
                </div>
                <div>
                    <label className="field-label">Image</label>
                    <input
                        className="input-glass"
                        type="file"
                        accept="image/*"
                        onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
                    />
                </div>
                <div>
                    <label className="field-label">Display Name</label>
                    <input
                        className="input-glass"
                        value={assetMetadata.displayName}
                        onChange={(event) => setAssetMetadata((previous) => ({ ...previous, displayName: event.target.value }))}
                    />
                </div>
                <div>
                    <label className="field-label">Role / Type</label>
                    <input
                        className="input-glass"
                        value={assetMetadata.role}
                        onChange={(event) => setAssetMetadata((previous) => ({ ...previous, role: event.target.value }))}
                    />
                </div>
                <div>
                    <label className="field-label">Preferred Usage</label>
                    <input
                        className="input-glass"
                        value={assetMetadata.usage}
                        onChange={(event) => setAssetMetadata((previous) => ({ ...previous, usage: event.target.value }))}
                    />
                </div>
                <div className="asset-import-notes">
                    <label className="field-label">Notes</label>
                    <textarea
                        className="input-glass"
                        value={assetMetadata.notes}
                        onChange={(event) => setAssetMetadata((previous) => ({ ...previous, notes: event.target.value }))}
                    />
                </div>
                <button type="submit" className="btn-primary">Import Asset</button>
            </form>

            <Section title="Character Archives" items={library.characters} onEdit={openEditor} />
            <Section title="Location References" items={library.locations} onEdit={openEditor} />
            <Section title="Style References" items={library.style} onEdit={openEditor} />
            <Section title="Final Masterpieces" items={library.pages} onEdit={openEditor} />

            <ImageEditorModal
                isOpen={isEditorOpen}
                onClose={() => setIsEditorOpen(false)}
                imageData={getDisplayImageSrc(editingItem)}
                projectId={projectId}
                onNotify={onNotify}
                onSaveEdit={handleSaveEdit}
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
                color: 'var(--text-muted)',
            }}>
                No assets detected in this bucket
            </div>
        ) : (
            <div className="library-grid">
                {items.filter((item) => item.type === 'image').map((item) => (
                    <div key={`${item.bucket}-${item.name}`} className="asset-card image-hover-container">
                        <img src={item.url} alt={item.name} />
                        <div className="image-overlay-actions mini">
                            <button className="action-pill edit" onClick={() => onEdit(item)}>Edit</button>
                        </div>
                        <div className="asset-info">
                            <p style={{ fontSize: '0.75rem', fontWeight: 600 }}>{item.displayName || item.name}</p>
                            {(item.role || item.usage) && (
                                <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{[item.role, item.usage].filter(Boolean).join(' - ')}</p>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        )}
    </div>
);

export default LibraryView;
