import React, { useState, useRef, useEffect } from 'react';

const ImageEditorModal = ({ isOpen, onClose, imageData, onSaveEdit, engine: defaultEngine, projectId }) => {
    const [prompt, setPrompt] = useState('');
    const [brushSize, setBrushSize] = useState(40);
    const [isProcessing, setIsProcessing] = useState(false);
    const [selectedEngine, setSelectedEngine] = useState(defaultEngine || 'pro');
    const canvasRef = useRef(null);
    const maskCanvasRef = useRef(null);
    const containerRef = useRef(null);
    const uploadInputRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    // Store original image dimensions for proper mask scaling
    const [originalDimensions, setOriginalDimensions] = useState({ width: 0, height: 0 });
    const [displayScale, setDisplayScale] = useState(1);
    // Debug: mask preview
    const [maskPreview, setMaskPreview] = useState(null);
    // Composite preview (image with highlight overlay)
    const [compositePreview, setCompositePreview] = useState(null);
    // Overlay settings for testing
    const [highlightColor, setHighlightColor] = useState('#ff00ff'); // Magenta default
    const [highlightOpacity, setHighlightOpacity] = useState(0.5);
    // Optional location description for fallback
    const [locationHint, setLocationHint] = useState('');
    
    // Asset insertion feature
    const [availableAssets, setAvailableAssets] = useState([]);
    const [selectedAssets, setSelectedAssets] = useState([]); // Now supports multiple
    const [editMode, setEditMode] = useState('edit'); // 'edit' or 'insert'
    const [showAssetPicker, setShowAssetPicker] = useState(false);
    
    // Review step - shows before/after before accepting
    const [pendingResult, setPendingResult] = useState(null); // {data, mimeType}
    const [showReview, setShowReview] = useState(false);

    // Update selected engine when prop changes
    useEffect(() => {
        if (defaultEngine) {
            setSelectedEngine(defaultEngine);
        }
    }, [defaultEngine]);

    // Fetch available assets when modal opens
    useEffect(() => {
        if (isOpen && projectId) {
            fetch(`/api/library?projectId=${projectId}`)
                .then(res => res.json())
                .then(data => {
                    // Combine characters from the library
                    const characters = data.characters || [];
                    setAvailableAssets(characters);
                })
                .catch(err => console.error('Failed to load assets:', err));
        }
    }, [isOpen, projectId]);

    // Toggle asset selection (for multi-select)
    const toggleAssetSelection = (asset) => {
        setSelectedAssets(prev => {
            const isSelected = prev.some(a => a.name === asset.name);
            if (isSelected) {
                return prev.filter(a => a.name !== asset.name);
            } else {
                return [...prev, asset];
            }
        });
    };

    // Get character names for display
    const getCharacterNames = () => {
        return selectedAssets.map(a => a.name.replace(/\.[^.]+$/, '')).join(', ');
    };

    useEffect(() => {
        if (isOpen && imageData) {
            const img = new Image();
            img.src = imageData;
            img.onload = () => {
                const canvas = canvasRef.current;
                const maskCanvas = maskCanvasRef.current;
                if (!canvas || !maskCanvas) return;

                // Store original dimensions
                const origWidth = img.width;
                const origHeight = img.height;
                setOriginalDimensions({ width: origWidth, height: origHeight });

                // Calculate display size to fit in modal
                const maxWidth = window.innerWidth * 0.5;
                const maxHeight = window.innerHeight * 0.6;
                
                const scale = Math.min(maxWidth / origWidth, maxHeight / origHeight, 1);
                setDisplayScale(scale);
                
                const displayWidth = origWidth * scale;
                const displayHeight = origHeight * scale;

                canvas.width = displayWidth;
                canvas.height = displayHeight;
                maskCanvas.width = displayWidth;
                maskCanvas.height = displayHeight;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

                // Initialize mask canvas (transparent)
                const maskCtx = maskCanvas.getContext('2d');
                maskCtx.clearRect(0, 0, displayWidth, displayHeight);
            };
        }
    }, [isOpen, imageData]);

    const getCoords = (e) => {
        const canvas = maskCanvasRef.current;
        const rect = canvas.getBoundingClientRect();
        
        // Get mouse position relative to canvas element (CSS display coordinates)
        const cssX = (e.clientX || e.touches[0].clientX) - rect.left;
        const cssY = (e.clientY || e.touches[0].clientY) - rect.top;
        
        // Scale from CSS display size to canvas internal size
        // This is critical when CSS scales the canvas differently from its internal dimensions
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        return { 
            x: cssX * scaleX, 
            y: cssY * scaleY 
        };
    };

    const startDrawing = (e) => {
        setIsDrawing(true);
        draw(e);
    };

    const stopDrawing = () => {
        setIsDrawing(false);
        const ctx = maskCanvasRef.current.getContext('2d');
        ctx.beginPath(); // Reset path
    };

    const draw = (e) => {
        if (!isDrawing) return;
        const ctx = maskCanvasRef.current.getContext('2d');
        const { x, y } = getCoords(e);

        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; // Semi-transparent white for visibility

        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
    };

    const handleClearMask = () => {
        const ctx = maskCanvasRef.current.getContext('2d');
        ctx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
        setMaskPreview(null);
        setCompositePreview(null);
    };

    // Generate the final mask (for preview only - kept for debugging)
    const generateFinalMask = () => {
        // Step 1: Create a temp canvas at DISPLAY size to process the mask strokes
        const displayCanvas = document.createElement('canvas');
        displayCanvas.width = maskCanvasRef.current.width;
        displayCanvas.height = maskCanvasRef.current.height;
        const dCtx = displayCanvas.getContext('2d');

        // Draw the mask strokes (transparent background + semi-transparent white strokes)
        dCtx.drawImage(maskCanvasRef.current, 0, 0);
        
        // Convert semi-transparent strokes to solid white
        dCtx.globalCompositeOperation = 'source-in';
        dCtx.fillStyle = 'white';
        dCtx.fillRect(0, 0, displayCanvas.width, displayCanvas.height);
        
        // Add black background behind the white strokes
        dCtx.globalCompositeOperation = 'destination-over';
        dCtx.fillStyle = 'black';
        dCtx.fillRect(0, 0, displayCanvas.width, displayCanvas.height);

        // Step 2: Scale the mask UP to match original image dimensions
        const finalMaskCanvas = document.createElement('canvas');
        finalMaskCanvas.width = originalDimensions.width;
        finalMaskCanvas.height = originalDimensions.height;
        const fCtx = finalMaskCanvas.getContext('2d');
        
        // Use nearest-neighbor scaling to keep mask edges sharp
        fCtx.imageSmoothingEnabled = false;
        fCtx.drawImage(displayCanvas, 0, 0, originalDimensions.width, originalDimensions.height);

        return finalMaskCanvas.toDataURL('image/png');
    };

    // Convert hex color to rgba string
    const hexToRgba = (hex, alpha) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    // Get the bounding box of the mask area
    const getMaskBounds = () => {
        const maskScaleCanvas = document.createElement('canvas');
        maskScaleCanvas.width = originalDimensions.width;
        maskScaleCanvas.height = originalDimensions.height;
        const mCtx = maskScaleCanvas.getContext('2d');
        
        mCtx.drawImage(
            maskCanvasRef.current, 
            0, 0, 
            originalDimensions.width, 
            originalDimensions.height
        );
        
        const imageData = mCtx.getImageData(0, 0, maskScaleCanvas.width, maskScaleCanvas.height);
        const data = imageData.data;
        
        let minX = maskScaleCanvas.width, minY = maskScaleCanvas.height;
        let maxX = 0, maxY = 0;
        let hasContent = false;
        
        for (let y = 0; y < maskScaleCanvas.height; y++) {
            for (let x = 0; x < maskScaleCanvas.width; x++) {
                const i = (y * maskScaleCanvas.width + x) * 4;
                // Check alpha channel for any painted pixels
                if (data[i + 3] > 10) {
                    hasContent = true;
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
        }
        
        if (!hasContent) return null;
        
        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
        };
    };

    // Generate composite image with colored highlight overlay on the original
    // This is the new approach: instead of sending a separate mask, we overlay the mask
    // visually on the image so the AI can SEE what area to edit
    const generateCompositeWithHighlight = (includeAsset = false) => {
        return new Promise((resolve, reject) => {
            if (!imageData) {
                reject(new Error('No image data available'));
                return;
            }
            if (!originalDimensions.width || !originalDimensions.height) {
                reject(new Error('Original dimensions not set'));
                return;
            }

            const img = new Image();
            img.onload = () => {
                try {
                    // Create canvas at original image dimensions
                    const canvas = document.createElement('canvas');
                    canvas.width = originalDimensions.width;
                    canvas.height = originalDimensions.height;
                    const ctx = canvas.getContext('2d');

                    // Step 1: Draw the original image
                    ctx.drawImage(img, 0, 0, originalDimensions.width, originalDimensions.height);

                    // Step 2: Create a scaled-up version of the mask strokes
                    const maskScaleCanvas = document.createElement('canvas');
                    maskScaleCanvas.width = originalDimensions.width;
                    maskScaleCanvas.height = originalDimensions.height;
                    const mCtx = maskScaleCanvas.getContext('2d');
                    
                    // Scale the display-size mask to original dimensions
                    mCtx.drawImage(
                        maskCanvasRef.current, 
                        0, 0, 
                        originalDimensions.width, 
                        originalDimensions.height
                    );

                    // Step 3: Convert mask to solid colored overlay
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = originalDimensions.width;
                    tempCanvas.height = originalDimensions.height;
                    const tCtx = tempCanvas.getContext('2d');
                    
                    // Draw scaled mask
                    tCtx.drawImage(maskScaleCanvas, 0, 0);
                    
                    // Convert any painted area to solid color using source-in
                    tCtx.globalCompositeOperation = 'source-in';
                    tCtx.fillStyle = hexToRgba(highlightColor, highlightOpacity);
                    tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

                    // Step 4: Overlay the colored mask on the original image
                    ctx.drawImage(tempCanvas, 0, 0);

                    // Step 5: If inserting assets, draw them in the mask area
                    if (includeAsset && selectedAssets.length > 0) {
                        const bounds = getMaskBounds();
                        if (bounds) {
                            // Load all selected assets
                            const loadPromises = selectedAssets.map(asset => {
                                return new Promise((resolveImg) => {
                                    const assetImg = new Image();
                                    assetImg.crossOrigin = 'anonymous';
                                    assetImg.onload = () => resolveImg({ img: assetImg, name: asset.name });
                                    assetImg.onerror = () => resolveImg(null);
                                    assetImg.src = asset.url;
                                });
                            });

                            Promise.all(loadPromises).then(loadedAssets => {
                                const validAssets = loadedAssets.filter(a => a !== null);
                                
                                if (validAssets.length > 0) {
                                    // Calculate layout for multiple characters
                                    const numAssets = validAssets.length;
                                    const slotWidth = bounds.width / numAssets;
                                    
                                    validAssets.forEach((assetData, idx) => {
                                        const { img: assetImg, name } = assetData;
                                        
                                        // Calculate position for this character
                                        const slotX = bounds.x + (idx * slotWidth);
                                        const slotCenterX = slotX + slotWidth / 2;
                                        
                                        // Scale asset to fit within the slot
                                        const assetAspect = assetImg.width / assetImg.height;
                                        const slotAspect = slotWidth / bounds.height;
                                        
                                        let drawWidth, drawHeight;
                                        if (assetAspect > slotAspect) {
                                            drawWidth = slotWidth * 0.9; // 90% of slot width
                                            drawHeight = drawWidth / assetAspect;
                                        } else {
                                            drawHeight = bounds.height * 0.9;
                                            drawWidth = drawHeight * assetAspect;
                                        }
                                        
                                        const drawX = slotCenterX - drawWidth / 2;
                                        const drawY = bounds.centerY - drawHeight / 2;
                                        
                                        // Draw a border around where the asset will be placed
                                        const colors = ['rgba(0, 255, 255, 0.8)', 'rgba(255, 255, 0, 0.8)', 'rgba(0, 255, 0, 0.8)', 'rgba(255, 128, 0, 0.8)'];
                                        ctx.strokeStyle = colors[idx % colors.length];
                                        ctx.lineWidth = 3;
                                        ctx.setLineDash([10, 5]);
                                        ctx.strokeRect(drawX, drawY, drawWidth, drawHeight);
                                        ctx.setLineDash([]);
                                        
                                        // Draw the asset with some transparency
                                        ctx.globalAlpha = 0.6;
                                        ctx.drawImage(assetImg, drawX, drawY, drawWidth, drawHeight);
                                        ctx.globalAlpha = 1.0;
                                        
                                        // Draw character name label
                                        const charName = name.replace(/\.[^.]+$/, '');
                                        ctx.font = 'bold 16px Arial';
                                        ctx.fillStyle = colors[idx % colors.length];
                                        ctx.strokeStyle = 'black';
                                        ctx.lineWidth = 3;
                                        ctx.strokeText(charName, drawX + 5, drawY + 20);
                                        ctx.fillText(charName, drawX + 5, drawY + 20);
                                    });
                                }
                                
                                const result = canvas.toDataURL('image/png');
                                console.log('Composite with', validAssets.length, 'assets generated');
                                resolve(result);
                            });
                            return; // Wait for assets to load
                        }
                    }

                    const result = canvas.toDataURL('image/png');
                    console.log('Composite image generated, length:', result.length);
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = () => {
                reject(new Error('Failed to load source image'));
            };
            img.src = imageData;
        });
    };

    // Load asset as data URL for sending to API
    const loadAssetAsDataUrl = (url) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => reject(new Error('Failed to load asset'));
            img.src = url;
        });
    };

    // Preview the composite image that will be sent (with highlight and optional asset)
    const handlePreviewComposite = async () => {
        const includeAsset = editMode === 'insert' && selectedAsset;
        const compositeData = await generateCompositeWithHighlight(includeAsset);
        setCompositePreview(compositeData);
        console.log('=== COMPOSITE DEBUG INFO ===');
        console.log('Composite image generated', includeAsset ? 'with asset' : 'without asset');
    };

    // Preview the mask that will be sent
    const handlePreviewMask = () => {
        const maskData = generateFinalMask();
        setMaskPreview(maskData);
        
        // Also log debug info
        console.log('=== MASK DEBUG INFO ===');
        console.log('Original image dimensions:', originalDimensions);
        console.log('Display canvas size:', maskCanvasRef.current.width, 'x', maskCanvasRef.current.height);
        console.log('Display scale:', displayScale);
        console.log('Mask data URL length:', maskData.length);
    };

    // Download mask for inspection
    const handleDownloadMask = () => {
        const maskData = generateFinalMask();
        const link = document.createElement('a');
        link.download = 'mask_debug.png';
        link.href = maskData;
        link.click();
    };

    // Handle uploading a replacement image instead of editing
    const handleUploadReplacement = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target.result;
            const base64Data = dataUrl.split(',')[1];
            const mimeType = file.type || 'image/png';

            onSaveEdit({
                type: 'image',
                data: base64Data,
                mimeType: mimeType
            });
            onClose();
        };
        reader.readAsDataURL(file);
        e.target.value = ''; // Reset input
    };

    const handleGenerate = async () => {
        if (editMode === 'edit' && !prompt.trim()) {
            return alert('Please enter an edit instruction.');
        }
        if (editMode === 'insert' && selectedAssets.length === 0) {
            return alert('Please select at least one character to insert.');
        }

        setIsProcessing(true);
        try {
            let requestBody;
            
            if (editMode === 'insert') {
                // INSERT MODE: Regenerate scene with characters (no composite needed)
                console.log('Preparing insert request...');
                
                // Load all selected asset images to send as references
                const assetDataUrls = await Promise.all(
                    selectedAssets.map(async (asset) => ({
                        name: asset.name.replace(/\.[^.]+$/, ''), // Remove extension
                        dataUrl: await loadAssetAsDataUrl(asset.url)
                    }))
                );
                
                const characterNames = assetDataUrls.map(a => a.name).join(', ');
                
                // Build prompt for scene regeneration
                let fullPrompt = prompt.trim() || '';
                if (locationHint.trim()) {
                    fullPrompt += (fullPrompt ? ' ' : '') + `Place characters: ${locationHint}`;
                }

                requestBody = {
                    originalImageData: imageData, // Only send original, no composite
                    assets: assetDataUrls,
                    prompt: fullPrompt,
                    engine: selectedEngine,
                    projectId,
                    mode: 'insert',
                    imageDimensions: originalDimensions // Send dimensions to match output size
                };
                
                console.log('Sending insert request with assets:', characterNames);
            } else {
                // EDIT MODE: Generate composite image with highlight
                console.log('Generating composite image for edit...');
                const compositeImageData = await generateCompositeWithHighlight(false);
                
                if (!compositeImageData) {
                    throw new Error('Failed to generate composite image');
                }
                
                // Regular edit mode
                let fullPrompt = prompt;
                if (locationHint.trim()) {
                    fullPrompt = `${prompt} (Location hint: ${locationHint})`;
                }

                requestBody = {
                    compositeImageData,
                    originalImageData: imageData,
                    prompt: fullPrompt,
                    engine: selectedEngine,
                    projectId,
                    mode: 'edit',
                    imageDimensions: originalDimensions // Send dimensions to match output size
                };
                
                console.log('Sending edit request');
            }

            const res = await fetch('/api/edit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const data = await res.json();
            if (data.error) throw new Error(data.error);

            if (data.result && data.result.type === 'image') {
                // Show review instead of immediately accepting
                setPendingResult(data.result);
                setShowReview(true);
            } else {
                alert('Generation failed to return an image. Response: ' + JSON.stringify(data.result).substring(0, 200));
            }
        } catch (err) {
            console.error('Edit error:', err);
            alert('Generation failed: ' + err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    // Accept the pending result and save it
    const handleAcceptEdit = () => {
        if (pendingResult) {
            onSaveEdit(pendingResult);
            setPendingResult(null);
            setShowReview(false);
            onClose();
        }
    };

    // Discard the pending result and try again
    const handleRetry = () => {
        setPendingResult(null);
        setShowReview(false);
    };

    // Cancel review and go back to editing
    const handleCancelReview = () => {
        setPendingResult(null);
        setShowReview(false);
    };

    if (!isOpen) return null;

    // Review View - shows before/after comparison
    if (showReview && pendingResult) {
        const editedImageSrc = `data:${pendingResult.mimeType};base64,${pendingResult.data}`;
        
        return (
            <div className="modal-overlay" onClick={handleCancelReview}>
                <div className="modal-content image-editor-card animate-in" onClick={e => e.stopPropagation()} style={{ maxWidth: '900px' }}>
                    <div className="modal-header">
                        <h3 className="heading-font">Review Changes</h3>
                        <button className="close-btn" onClick={handleCancelReview}>&times;</button>
                    </div>

                    <div style={{ padding: '20px' }}>
                        <p style={{ textAlign: 'center', marginBottom: '15px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                            Compare the original and edited versions below
                        </p>
                        
                        <div style={{ 
                            display: 'grid', 
                            gridTemplateColumns: '1fr 1fr', 
                            gap: '20px',
                            marginBottom: '20px'
                        }}>
                            {/* Original Image */}
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ 
                                    fontSize: '0.85rem', 
                                    fontWeight: 'bold', 
                                    marginBottom: '10px',
                                    color: 'var(--text-muted)'
                                }}>
                                    Original
                                </div>
                                <div style={{ 
                                    border: '2px solid var(--border)', 
                                    borderRadius: '8px', 
                                    overflow: 'hidden',
                                    background: 'rgba(0,0,0,0.2)'
                                }}>
                                    <img 
                                        src={imageData} 
                                        alt="Original" 
                                        style={{ 
                                            width: '100%', 
                                            height: 'auto',
                                            display: 'block'
                                        }} 
                                    />
                                </div>
                            </div>
                            
                            {/* Edited Image */}
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ 
                                    fontSize: '0.85rem', 
                                    fontWeight: 'bold', 
                                    marginBottom: '10px',
                                    color: 'var(--accent)'
                                }}>
                                    Edited
                                </div>
                                <div style={{ 
                                    border: '2px solid var(--accent)', 
                                    borderRadius: '8px', 
                                    overflow: 'hidden',
                                    background: 'rgba(0,0,0,0.2)'
                                }}>
                                    <img 
                                        src={editedImageSrc} 
                                        alt="Edited" 
                                        style={{ 
                                            width: '100%', 
                                            height: 'auto',
                                            display: 'block'
                                        }} 
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div style={{ 
                            display: 'flex', 
                            gap: '15px', 
                            justifyContent: 'center',
                            marginTop: '20px'
                        }}>
                            <button 
                                className="tab-btn"
                                onClick={handleRetry}
                                style={{ padding: '12px 30px', fontSize: '1rem' }}
                            >
                                🔄 Try Again
                            </button>
                            <button 
                                className="btn-primary"
                                onClick={handleAcceptEdit}
                                style={{ padding: '12px 40px', fontSize: '1rem', margin: 0 }}
                            >
                                ✓ Accept Changes
                            </button>
                        </div>
                        
                        <p style={{ 
                            textAlign: 'center', 
                            marginTop: '15px', 
                            color: 'var(--text-muted)', 
                            fontSize: '0.75rem' 
                        }}>
                            Click "Accept Changes" to apply the edit, or "Try Again" to generate a new version
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content image-editor-card animate-in" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="heading-font">Edit Image Aspect</h3>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>

                <div className="editor-main">
                    <div className="canvas-container" ref={containerRef}>
                        <canvas ref={canvasRef} className="base-canvas" />
                        <canvas
                            ref={maskCanvasRef}
                            className="mask-canvas"
                            onMouseDown={startDrawing}
                            onMouseMove={draw}
                            onMouseUp={stopDrawing}
                            onMouseLeave={stopDrawing}
                            onTouchStart={startDrawing}
                            onTouchMove={draw}
                            onTouchEnd={stopDrawing}
                        />
                    </div>

                    <div className="editor-controls">
                        {/* Mode Toggle */}
                        <div className="field-group">
                            <label className="field-label">Mode</label>
                            <div style={{ display: 'flex', gap: '5px' }}>
                                <button
                                    className={editMode === 'edit' ? 'btn-primary' : 'tab-btn'}
                                    onClick={() => { setEditMode('edit'); setSelectedAssets([]); }}
                                    style={{ flex: 1, margin: 0, padding: '8px' }}
                                >
                                    ✏️ Edit Area
                                </button>
                                <button
                                    className={editMode === 'insert' ? 'btn-primary' : 'tab-btn'}
                                    onClick={() => setEditMode('insert')}
                                    style={{ flex: 1, margin: 0, padding: '8px' }}
                                >
                                    👤 Insert Character
                                </button>
                            </div>
                        </div>

                        {/* Edit Mode: Prompt input */}
                        {editMode === 'edit' && (
                            <div className="field-group">
                                <label className="field-label">Edit Instruction</label>
                                <textarea
                                    className="input-glass"
                                    placeholder="E.g., 'Change hair to blue', 'Add a hat', 'Make the background a forest'..."
                                    value={prompt}
                                    onChange={e => setPrompt(e.target.value)}
                                    style={{ height: '80px' }}
                                />
                            </div>
                        )}

                        {/* Insert Mode: Character selector */}
                        {editMode === 'insert' && (
                            <>
                                <div style={{ 
                                    padding: '8px 12px', 
                                    background: 'rgba(var(--accent-rgb), 0.1)', 
                                    borderRadius: '6px', 
                                    marginBottom: '10px',
                                    border: '1px solid rgba(var(--accent-rgb), 0.3)'
                                }}>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                                        This will regenerate the scene with your selected characters added, staying as close to the original as possible.
                                    </p>
                                </div>
                                
                                <div className="field-group">
                                    <label className="field-label">
                                        Select Characters ({selectedAssets.length} selected)
                                    </label>
                                    
                                    {/* Selected Characters Display */}
                                    {selectedAssets.length > 0 && (
                                        <div style={{ 
                                            display: 'flex', 
                                            flexWrap: 'wrap',
                                            gap: '8px',
                                            padding: '8px',
                                            background: 'rgba(255,255,255,0.05)',
                                            borderRadius: '8px',
                                            marginBottom: '8px'
                                        }}>
                                            {selectedAssets.map((asset, idx) => (
                                                <div 
                                                    key={idx}
                                                    style={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        gap: '6px',
                                                        padding: '4px 8px',
                                                        background: 'rgba(var(--accent-rgb), 0.2)',
                                                        borderRadius: '20px',
                                                        border: '1px solid var(--accent)'
                                                    }}
                                                >
                                                    <img 
                                                        src={asset.url} 
                                                        alt={asset.name}
                                                        style={{ width: '24px', height: '24px', objectFit: 'cover', borderRadius: '50%' }}
                                                    />
                                                    <span style={{ fontSize: '0.8rem' }}>{asset.name.replace(/\.[^.]+$/, '')}</span>
                                                    <button 
                                                        onClick={() => toggleAssetSelection(asset)}
                                                        style={{ 
                                                            background: 'none', 
                                                            border: 'none', 
                                                            color: 'var(--text-muted)', 
                                                            cursor: 'pointer',
                                                            padding: '0 2px',
                                                            fontSize: '1rem'
                                                        }}
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    
                                    <button 
                                        className="btn-secondary"
                                        onClick={() => setShowAssetPicker(!showAssetPicker)}
                                        style={{ width: '100%' }}
                                    >
                                        {showAssetPicker ? '▲ Hide Characters' : '👤 Choose Characters...'}
                                    </button>
                                </div>

                                {/* Character Picker Grid (Multi-select) */}
                                {showAssetPicker && (
                                    <div style={{ 
                                        maxHeight: '180px', 
                                        overflowY: 'auto', 
                                        display: 'grid', 
                                        gridTemplateColumns: 'repeat(4, 1fr)', 
                                        gap: '8px',
                                        padding: '10px',
                                        background: 'rgba(0,0,0,0.3)',
                                        borderRadius: '8px',
                                        marginBottom: '10px'
                                    }}>
                                        {availableAssets.length === 0 ? (
                                            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                                                No characters found in project
                                            </div>
                                        ) : (
                                            availableAssets.map((asset, idx) => {
                                                const isSelected = selectedAssets.some(a => a.name === asset.name);
                                                return (
                                                    <div 
                                                        key={idx}
                                                        onClick={() => toggleAssetSelection(asset)}
                                                        style={{
                                                            cursor: 'pointer',
                                                            borderRadius: '6px',
                                                            overflow: 'hidden',
                                                            border: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                                                            transition: 'all 0.2s',
                                                            position: 'relative'
                                                        }}
                                                        title={asset.name}
                                                    >
                                                        {isSelected && (
                                                            <div style={{
                                                                position: 'absolute',
                                                                top: '4px',
                                                                right: '4px',
                                                                background: 'var(--accent)',
                                                                borderRadius: '50%',
                                                                width: '20px',
                                                                height: '20px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                fontSize: '0.7rem',
                                                                fontWeight: 'bold',
                                                                zIndex: 1
                                                            }}>
                                                                ✓
                                                            </div>
                                                        )}
                                                        <img 
                                                            src={asset.url} 
                                                            alt={asset.name}
                                                            style={{ 
                                                                width: '100%', 
                                                                aspectRatio: '1', 
                                                                objectFit: 'cover',
                                                                opacity: isSelected ? 1 : 0.7
                                                            }}
                                                        />
                                                        <div style={{ 
                                                            fontSize: '0.6rem', 
                                                            padding: '2px 4px', 
                                                            textAlign: 'center',
                                                            whiteSpace: 'nowrap',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            background: isSelected ? 'var(--accent)' : 'rgba(0,0,0,0.5)'
                                                        }}>
                                                            {asset.name.replace(/\.[^.]+$/, '')}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                )}

                                <div className="field-group">
                                    <label className="field-label">Additional Instructions (optional)</label>
                                    <textarea
                                        className="input-glass"
                                        placeholder="E.g., 'Ava on the left, Dawson on the right', 'In a fighting pose', 'Looking at each other'..."
                                        value={prompt}
                                        onChange={e => setPrompt(e.target.value)}
                                        style={{ height: '60px' }}
                                    />
                                </div>
                            </>
                        )}

                        <div className="field-group">
                            <label className="field-label">Engine</label>
                            <select
                                className="input-glass"
                                value={selectedEngine}
                                onChange={e => setSelectedEngine(e.target.value)}
                            >
                                <option value="flash">Nano Banana (Fast)</option>
                                <option value="pro">Nano Banana Pro (Quality)</option>
                            </select>
                        </div>

                        <div className="field-group">
                            <label className="field-label">Location Hint (optional)</label>
                            <input
                                type="text"
                                className="input-glass"
                                placeholder="e.g., 'the man in the center', 'left side'"
                                value={locationHint}
                                onChange={e => setLocationHint(e.target.value)}
                                style={{ fontSize: '0.85rem' }}
                            />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Brush Size: {brushSize}px</label>
                            <input
                                type="range"
                                min="5"
                                max="100"
                                value={brushSize}
                                onChange={e => setBrushSize(parseInt(e.target.value))}
                                className="brush-slider"
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '10px' }}>
                            <div className="field-group" style={{ flex: 1 }}>
                                <label className="field-label">Highlight Color</label>
                                <input
                                    type="color"
                                    value={highlightColor}
                                    onChange={e => setHighlightColor(e.target.value)}
                                    style={{ width: '100%', height: '32px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                />
                            </div>
                            <div className="field-group" style={{ flex: 2 }}>
                                <label className="field-label">Opacity: {Math.round(highlightOpacity * 100)}%</label>
                                <input
                                    type="range"
                                    min="20"
                                    max="80"
                                    value={highlightOpacity * 100}
                                    onChange={e => setHighlightOpacity(parseInt(e.target.value) / 100)}
                                    className="brush-slider"
                                />
                            </div>
                        </div>

                        <div className="button-row">
                            <button className="tab-btn" onClick={handleClearMask} style={{ flex: 1 }}>Clear</button>
                            <button className="tab-btn" onClick={handlePreviewComposite} style={{ flex: 1 }}>Preview</button>
                            <button
                                className="btn-primary"
                                onClick={handleGenerate}
                                disabled={isProcessing}
                                style={{ flex: 2, margin: 0 }}
                            >
                                {isProcessing ? <span className="btn-loader small"></span> : '✦ Generate Edit'}
                            </button>
                        </div>

                        {/* Composite Preview - shows what AI will see */}
                        {compositePreview && (
                            <div style={{ marginTop: '10px', padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>What AI will see (magenta = edit area)</span>
                                    <button 
                                        onClick={() => setCompositePreview(null)} 
                                        style={{ fontSize: '0.7rem', padding: '4px 8px', background: 'var(--border)', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer' }}
                                    >
                                        Close
                                    </button>
                                </div>
                                <img 
                                    src={compositePreview} 
                                    alt="Composite preview" 
                                    style={{ width: '100%', borderRadius: '4px', border: '1px solid var(--border)' }} 
                                />
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '5px' }}>
                                    The magenta highlight shows the AI exactly which area to edit
                                </div>
                            </div>
                        )}

                        <div className="upload-divider" style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            margin: '15px 0 10px', 
                            gap: '10px',
                            color: 'var(--text-muted)',
                            fontSize: '0.75rem'
                        }}>
                            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
                            <span>or</span>
                            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
                        </div>

                        <button
                            className="btn-secondary"
                            onClick={() => uploadInputRef.current?.click()}
                            style={{ width: '100%' }}
                        >
                            📤 Upload Replacement Image
                        </button>
                        <input
                            ref={uploadInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleUploadReplacement}
                            style={{ display: 'none' }}
                        />

                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '10px' }}>
                            {editMode === 'edit' 
                                ? 'Paint over the area you want to change, then describe the modification.'
                                : 'This will generate a new version of the scene with the selected characters added. The AI will try to stay as close to the original as possible.'}
                            {' '}Or upload a completely new image to replace the current one.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ImageEditorModal;
