import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Group, Rect, Image as KonvaImage, Text } from 'react-konva';
import ClipperLib from 'clipper-lib';

const CANVAS_W = 800;
const CANVAS_H = 1200;

function percentPointsToPixels(pointsPct) {
  // pointsPct: [[xPct, yPct], ...]
  return pointsPct.map(([x, y]) => [x * CANVAS_W / 100, y * CANVAS_H / 100]);
}

function insetPolygon(points, insetPx) {
  // points: [[x, y], ...] in CANVAS coordinates
  // insetPx: positive number shrinks polygon inward
  if (!insetPx || insetPx <= 0) return points;
  if (!points || points.length < 3) return points;

  const SCALE = 100; // keep integer precision for Clipper
  const subj = [{
    X: Math.round(points[0][0] * SCALE),
    Y: Math.round(points[0][1] * SCALE)
  }];
  for (let i = 1; i < points.length; i++) {
    subj.push({
      X: Math.round(points[i][0] * SCALE),
      Y: Math.round(points[i][1] * SCALE)
    });
  }

  const co = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
  co.AddPath(subj, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const solution = new ClipperLib.Paths();
  // Negative delta to inset
  co.Execute(solution, -Math.round(insetPx * SCALE));

  if (!solution || solution.length === 0 || solution[0].length < 3) return points;

  // Pick the largest resulting polygon by area
  let best = solution[0];
  let bestArea = Math.abs(ClipperLib.Clipper.Area(best));
  for (let i = 1; i < solution.length; i++) {
    const area = Math.abs(ClipperLib.Clipper.Area(solution[i]));
    if (area > bestArea) {
      best = solution[i];
      bestArea = area;
    }
  }

  return best.map(p => [p.X / SCALE, p.Y / SCALE]);
}

function polygonCentroid(points) {
  // simple average centroid (good enough for quads)
  const n = points.length;
  const sum = points.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / n, sum[1] / n];
}

function useResizeObserverSize(ref, maxWidth = 400) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const w = Math.min(cr.width, maxWidth);
      setSize({ width: w, height: w * (CANVAS_H / CANVAS_W) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, maxWidth]);
  return size;
}

export default function LayoutPreviewKonva({
  selectedLayout,
  panelsCount,
  panelImages,
  panelPositions,
  setPanelPositions,
  gutterColor,
  gutterWidth,
  stageRef,
  onStageSizeChange
}) {
  const containerRef = useRef(null);
  const { width: stageW, height: stageH } = useResizeObserverSize(containerRef, 400);
  const scale = stageW ? (stageW / CANVAS_W) : 1;

  useEffect(() => {
    if (onStageSizeChange && stageW) onStageSizeChange({ width: stageW, height: stageH });
  }, [onStageSizeChange, stageW, stageH]);

  const [loadedImages, setLoadedImages] = useState({});
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const next = {};
      const indices = Array.from({ length: panelsCount }, (_, i) => i);
      await Promise.all(indices.map(i => new Promise(resolve => {
        const imgData = panelImages?.[i];
        if (!imgData?.data || !imgData?.mimeType) return resolve();
        const img = new window.Image();
        img.onload = () => {
          next[i] = img;
          resolve();
        };
        img.onerror = () => resolve();
        img.src = `data:${imgData.mimeType};base64,${imgData.data}`;
      })));
      if (!cancelled) setLoadedImages(next);
    }
    load();
    return () => { cancelled = true; };
  }, [panelImages, panelsCount]);

  const insetPx = useMemo(() => Math.max(0, (gutterWidth || 0) / 2), [gutterWidth]);

  const panelGeometries = useMemo(() => {
    if (!selectedLayout?.panels) return [];
    return selectedLayout.panels.slice(0, panelsCount).map((panel) => {
      const outer = percentPointsToPixels(panel.points);
      const inner = insetPolygon(outer, insetPx);
      const centroid = polygonCentroid(inner);
      return { outer, inner, centroid };
    });
  }, [selectedLayout, panelsCount, insetPx]);

  const handleDragMove = (panelIndex, e) => {
    const node = e.target;
    const imgData = panelImages?.[panelIndex];
    const img = loadedImages?.[panelIndex];
    if (!imgData || !img) return;

    const pos = panelPositions?.[panelIndex] || { offsetX: 0, offsetY: 0, scale: 1 };
    const userScale = pos.scale || 1;

    const scaledW = CANVAS_W * userScale;
    const scaledH = (img.height / img.width) * scaledW;

    const baseX = (CANVAS_W - scaledW) / 2;
    const baseY = (CANVAS_H - scaledH) / 2;

    const newOffsetX = node.x() - baseX;
    const newOffsetY = node.y() - baseY;

    setPanelPositions(prev => ({
      ...prev,
      [panelIndex]: {
        ...prev[panelIndex],
        offsetX: newOffsetX,
        offsetY: newOffsetY,
        scale: userScale
      }
    }));
  };

  if (!selectedLayout) {
    return (
      <div ref={containerRef} className="layout-preview-canvas" style={{ maxWidth: 400 }} />
    );
  }

  return (
    <div
      ref={containerRef}
      className="layout-preview-canvas"
      style={{
        maxWidth: 400,
        margin: '0 auto',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        backgroundColor: gutterColor
      }}
    >
      {stageW > 0 && (
        <Stage
          width={stageW}
          height={stageH}
          ref={stageRef}
          style={{ display: 'block' }}
        >
          <Layer>
            <Group scaleX={scale} scaleY={scale}>
              <Rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill={gutterColor} />

              {panelGeometries.map((geom, i) => {
                const img = loadedImages?.[i];
                const pos = panelPositions?.[i] || { offsetX: 0, offsetY: 0, scale: 1 };
                const userScale = pos.scale || 1;

                const scaledW = CANVAS_W * userScale;
                const scaledH = img ? ((img.height / img.width) * scaledW) : 0;
                const baseX = (CANVAS_W - scaledW) / 2;
                const baseY = (CANVAS_H - scaledH) / 2;
                const drawX = baseX + (pos.offsetX || 0);
                const drawY = baseY + (pos.offsetY || 0);

                return (
                  <Group
                    key={i}
                    clipFunc={(ctx) => {
                      const pts = geom.inner;
                      if (!pts || pts.length < 3) return;
                      ctx.beginPath();
                      ctx.moveTo(pts[0][0], pts[0][1]);
                      for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
                      ctx.closePath();
                    }}
                  >
                    {img ? (
                      <KonvaImage
                        image={img}
                        x={drawX}
                        y={drawY}
                        width={scaledW}
                        height={scaledH}
                        draggable
                        onDragMove={(e) => handleDragMove(i, e)}
                        onDragEnd={(e) => handleDragMove(i, e)}
                      />
                    ) : (
                      // If no image, fill panel area with a subtle placeholder
                      <Group>
                        <Group
                          clipFunc={(ctx) => {
                            const pts = geom.inner;
                            if (!pts || pts.length < 3) return;
                            ctx.beginPath();
                            ctx.moveTo(pts[0][0], pts[0][1]);
                            for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
                            ctx.closePath();
                          }}
                        >
                          <Rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="#1a1a2e" />
                        </Group>
                      </Group>
                    )}

                    {/* Panel number - tagged for hiding during export */}
                    <Group name="panelNumber">
                      <Rect
                        x={geom.centroid[0] - 10}
                        y={geom.centroid[1] - 10}
                        width={20}
                        height={20}
                        fill="rgba(0,0,0,0.6)"
                        cornerRadius={4}
                      />
                      <Text
                        x={geom.centroid[0] - 10}
                        y={geom.centroid[1] - 9}
                        width={20}
                        height={20}
                        align="center"
                        verticalAlign="middle"
                        text={`${i + 1}`}
                        fontSize={12}
                        fill="#ffffff"
                      />
                    </Group>
                  </Group>
                );
              })}
            </Group>
          </Layer>
        </Stage>
      )}
    </div>
  );
}

