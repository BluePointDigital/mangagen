import React, { useState, useRef, useEffect } from 'react';

const ImageEditorModal = ({ isOpen, onClose, imageData, onSaveEdit, engine, projectId }) => {
    const [prompt, setPrompt] = useState('');
    const [brushSize, setBrushSize] = useState(40);
    const [isProcessing, setIsProcessing] = useState(false);
    const canvasRef = useRef(null);
    const maskCanvasRef = useRef(null);
    const containerRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);

    useEffect(() => {
        if (isOpen && imageData) {
            const img = new Image();
            img.src = imageData;
            img.onload = () => {
                const canvas = canvasRef.current;
                const maskCanvas = maskCanvasRef.current;
                if (!canvas || !maskCanvas) return;

                // Set canvas sizes to match image logic or container
                // For simplicity, we'll try to fit it in the modal
                const maxWidth = window.innerWidth * 0.8;
                const maxHeight = window.innerHeight * 0.6;
                let width = img.width;
                let height = img.height;

                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width *= ratio;
                height *= ratio;

                canvas.width = width;
                canvas.height = height;
                maskCanvas.width = width;
                maskCanvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Initialize mask canvas (transparent black or just empty)
                const maskCtx = maskCanvas.getContext('2d');
                maskCtx.clearRect(0, 0, width, height);
                maskCtx.fillStyle = 'rgba(0,0,0,0)'; // Transparent
                maskCtx.fillRect(0, 0, width, height);
            };
        }
    }, [isOpen, imageData]);

    const getCoords = (e) => {
        const rect = maskCanvasRef.current.getBoundingClientRect();
        const x = (e.clientX || e.touches[0].clientX) - rect.left;
        const y = (e.clientY || e.touches[0].clientY) - rect.top;
        return { x, y };
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
    };

    const handleGenerate = async () => {
        if (!prompt.trim()) return alert('Please enter an edit instruction.');

        setIsProcessing(true);
        try {
            // Prepare mask: we need a black and white mask for the backend
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = maskCanvasRef.current.width;
            tempCanvas.height = maskCanvasRef.current.height;
            const tCtx = tempCanvas.getContext('2d');

            // Background black
            tCtx.fillStyle = 'black';
            tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

            // Draw the mask path in white
            // We can just draw the maskCanvas content, but it's semi-transparent white right now
            // Better: copy the maskCanvas as is, but we want pure white on black.
            // Let's use globalCompositeOperation to make it pure white
            tCtx.drawImage(maskCanvasRef.current, 0, 0);
            tCtx.globalCompositeOperation = 'source-in';
            tCtx.fillStyle = 'white';
            tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

            const maskData = tempCanvas.toDataURL('image/png');

            const res = await fetch('/api/edit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageData,
                    maskData,
                    prompt,
                    engine,
                    projectId
                })
            });

            const data = await res.json();
            if (data.error) throw new Error(data.error);

            if (data.result && data.result.type === 'image') {
                onSaveEdit(data.result);
                onClose();
            } else {
                alert('Edit failed to return an image.');
            }
        } catch (err) {
            alert('Edit failed: ' + err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    if (!isOpen) return null;

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
                        <div className="field-group">
                            <label className="field-label">Mask Instruction</label>
                            <textarea
                                className="input-glass"
                                placeholder="E.g., 'Change hair to blue', 'Add a hat', 'Make the background a forest'..."
                                value={prompt}
                                onChange={e => setPrompt(e.target.value)}
                                style={{ height: '80px' }}
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

                        <div className="button-row">
                            <button className="tab-btn" onClick={handleClearMask} style={{ flex: 1 }}>Clear Mask</button>
                            <button
                                className="btn-primary"
                                onClick={handleGenerate}
                                disabled={isProcessing}
                                style={{ flex: 2, margin: 0 }}
                            >
                                {isProcessing ? <span className="btn-loader small"></span> : '✦ Generate Edit'}
                            </button>
                        </div>

                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '10px' }}>
                            Paint over the area you want to change, then describe the modification.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ImageEditorModal;
