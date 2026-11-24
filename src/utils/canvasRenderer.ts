import type {
  AspectRatioPreset,
  BackgroundRemovalConfig,
  FilterPreset,
  OverlayLayerItem,
  TextOverlayItem,
  VideoFilters,
  VideoFitMode,
} from '../types/editor';
import {
  applyChromaKeyToCanvas,
  applyMaskToCanvas,
  getCachedMaskOrSchedule,
} from './backgroundRemover';

export const ASPECT_RATIO_DIMENSIONS: Record<
  AspectRatioPreset,
  {width: number; height: number; label: string; subtitle: string}
> = {
  '16:9': {width: 1280, height: 720, label: '16:9', subtitle: 'YouTube'},
  '9:16': {width: 720, height: 1280, label: '9:16', subtitle: 'Reels / Shorts'},
  '1:1': {width: 1080, height: 1080, label: '1:1', subtitle: 'Square'},
};

export const FILTER_PRESET_VALUES: Record<FilterPreset, Omit<VideoFilters, 'preset'>> = {
  none: {brightness: 100, contrast: 100, saturation: 100, blur: 0},
  bw: {brightness: 104, contrast: 120, saturation: 0, blur: 0},
  vintage: {brightness: 105, contrast: 92, saturation: 72, blur: 0},
  warm: {brightness: 106, contrast: 104, saturation: 125, blur: 0},
  cinematic: {brightness: 95, contrast: 124, saturation: 88, blur: 0},
};

export function buildCanvasFilterString(filters: VideoFilters): string {
  const parts: string[] = [
    `brightness(${filters.brightness}%)`,
    `contrast(${filters.contrast}%)`,
    `saturate(${filters.saturation}%)`,
  ];

  if (filters.blur > 0) {
    parts.push(`blur(${filters.blur}px)`);
  }

  if (filters.preset === 'vintage') {
    parts.push('sepia(38%)');
  } else if (filters.preset === 'warm') {
    parts.push('sepia(20%) hue-rotate(-6deg)');
  } else if (filters.preset === 'cinematic') {
    parts.push('sepia(10%)');
  }

  return parts.join(' ');
}

export interface TextOverlayBounds {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OverlayLayerBounds {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  handleX: number;
  handleY: number;
  handleSize: number;
}

export interface RenderFrameResult {
  textBounds: TextOverlayBounds[];
  overlayBounds: OverlayLayerBounds[];
}

export type MediaSourceElement = HTMLVideoElement | HTMLImageElement;

const scratchCanvasPool = new Map<string, HTMLCanvasElement>();

function getScratchCanvas(key: string): HTMLCanvasElement {
  let c = scratchCanvasPool.get(key);
  if (!c) {
    c = document.createElement('canvas');
    scratchCanvasPool.set(key, c);
  }
  return c;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function isMediaReady(el: MediaSourceElement | null | undefined): boolean {
  if (!el) return false;
  if (el instanceof HTMLVideoElement) {
    return el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0;
  }
  return el.complete && el.naturalWidth > 0 && el.naturalHeight > 0;
}

function getMediaDims(el: MediaSourceElement): {w: number; h: number} {
  if (el instanceof HTMLVideoElement) {
    return {w: el.videoWidth, h: el.videoHeight};
  }
  return {w: el.naturalWidth, h: el.naturalHeight};
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number
) {
  const scale = Math.max(canvasW / srcW, canvasH / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  const drawX = (canvasW - drawW) / 2;
  const drawY = (canvasH - drawH) / 2;
  ctx.drawImage(source, drawX, drawY, drawW, drawH);
}

function drawSubtleCheckerboard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
) {
  const tile = 32;
  ctx.fillStyle = '#0D1015';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#151922';
  for (let y = 0; y < h; y += tile) {
    for (let x = 0; x < w; x += tile) {
      if (((x / tile + y / tile) | 0) % 2 === 0) {
        ctx.fillRect(x, y, tile, tile);
      }
    }
  }
}

function resolveCutoutSource(params: {
  key: string;
  source: MediaSourceElement;
  bgRemoval: BackgroundRemovalConfig;
  precomputedMask?: HTMLCanvasElement | null;
  onMaskUpdated?: () => void;
  maxProcessWidth?: number;
}): CanvasImageSource {
  const {
    key,
    source,
    bgRemoval,
    precomputedMask,
    onMaskUpdated,
    maxProcessWidth = 720,
  } = params;

  if (bgRemoval.mode === 'chroma-key') {
    const out = getScratchCanvas(`chroma-${key}`);
    applyChromaKeyToCanvas(
      source,
      out,
      bgRemoval.keyColor,
      bgRemoval.similarity,
      bgRemoval.smoothness,
      maxProcessWidth
    );
    return out;
  }

  if (bgRemoval.mode === 'ai-person') {
    const mask =
      precomputedMask !== undefined
        ? precomputedMask
        : getCachedMaskOrSchedule(key, source, onMaskUpdated);

    if (mask) {
      const out = getScratchCanvas(`ai-${key}`);
      applyMaskToCanvas(
        source,
        mask,
        out,
        bgRemoval.maskBlur,
        maxProcessWidth
      );
      return out;
    }
  }

  return source;
}

export function renderEditorFrame(params: {
  ctx: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  video: HTMLVideoElement | null;
  hasActiveVideo: boolean;
  fitMode: VideoFitMode;
  filters: VideoFilters;
  mainBgRemoval: BackgroundRemovalConfig;
  mainBgReplacementEl?: MediaSourceElement | null;
  precomputedMainMask?: HTMLCanvasElement | null;
  overlayLayers: OverlayLayerItem[];
  overlayElementsMap: Map<string, MediaSourceElement>;
  precomputedOverlayMasks?: Map<string, HTMLCanvasElement | null>;
  textOverlays: TextOverlayItem[];
  currentTime: number;
  selectedOverlayId?: string | null;
  selectedTextId?: string | null;
  showSelectionBox?: boolean;
  isExport?: boolean;
  onMaskUpdated?: () => void;
}): RenderFrameResult {
  const {
    ctx,
    canvasWidth,
    canvasHeight,
    video,
    hasActiveVideo,
    fitMode,
    filters,
    mainBgRemoval,
    mainBgReplacementEl = null,
    precomputedMainMask,
    overlayLayers,
    overlayElementsMap,
    precomputedOverlayMasks,
    textOverlays,
    currentTime,
    selectedOverlayId = null,
    selectedTextId = null,
    showSelectionBox = false,
    isExport = false,
    onMaskUpdated,
  } = params;

  ctx.save();
  ctx.filter = 'none';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const mainReady = hasActiveVideo && isMediaReady(video);

  // 1. Background Replacement Layer (when Main Video BG removal is enabled)
  if (mainReady && video && mainBgRemoval.mode !== 'none') {
    if (mainBgRemoval.replacementType === 'transparent') {
      if (!isExport) {
        drawSubtleCheckerboard(ctx, canvasWidth, canvasHeight);
      }
    } else if (mainBgRemoval.replacementType === 'solid') {
      ctx.fillStyle = mainBgRemoval.replacementColor || '#111827';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    } else if (mainBgRemoval.replacementType === 'blur') {
      ctx.save();
      ctx.filter = `blur(${Math.max(2, mainBgRemoval.replacementBlur)}px)`;
      const {w: vw, h: vh} = getMediaDims(video);
      drawCover(ctx, video, vw, vh, canvasWidth, canvasHeight);
      ctx.restore();
    } else if (
      (mainBgRemoval.replacementType === 'image' ||
        mainBgRemoval.replacementType === 'video') &&
      isMediaReady(mainBgReplacementEl)
    ) {
      const bgEl = mainBgReplacementEl as MediaSourceElement;
      const {w: bw, h: bh} = getMediaDims(bgEl);
      drawCover(ctx, bgEl, bw, bh, canvasWidth, canvasHeight);
    }
  }

  // 2. Main Video Layer (with filters & optional BG removal)
  if (mainReady && video) {
    const {w: vw, h: vh} = getMediaDims(video);
    const scale =
      fitMode === 'cover'
        ? Math.max(canvasWidth / vw, canvasHeight / vh)
        : Math.min(canvasWidth / vw, canvasHeight / vh);

    const drawW = vw * scale;
    const drawH = vh * scale;
    const drawX = (canvasWidth - drawW) / 2;
    const drawY = (canvasHeight - drawH) / 2;

    const drawnSource = resolveCutoutSource({
      key: 'main',
      source: video,
      bgRemoval: mainBgRemoval,
      precomputedMask: precomputedMainMask,
      onMaskUpdated,
      maxProcessWidth: isExport ? 1080 : 680,
    });

    ctx.save();
    ctx.filter = buildCanvasFilterString(filters);
    ctx.drawImage(drawnSource, drawX, drawY, drawW, drawH);
    ctx.restore();
  }

  // 3. Overlay / PIP Layers (Images & Secondary Videos)
  const overlayBounds: OverlayLayerBounds[] = [];
  const scaleFactor = Math.min(canvasWidth, canvasHeight) / 720;

  for (const overlay of overlayLayers) {
    if (currentTime < overlay.startTime || currentTime > overlay.endTime) {
      continue;
    }
    const mediaEl = overlayElementsMap.get(overlay.id);
    if (!isMediaReady(mediaEl) || !mediaEl) {
      continue;
    }

    const drawW = Math.max(24, overlay.width * canvasWidth);
    const safeRatio = overlay.aspectRatio > 0 ? overlay.aspectRatio : 1;
    const drawH = Math.max(24, drawW / safeRatio);
    const centerX = overlay.x * canvasWidth;
    const centerY = overlay.y * canvasHeight;
    const left = centerX - drawW / 2;
    const top = centerY - drawH / 2;

    const preMask = precomputedOverlayMasks?.get(overlay.id);
    const cutout = resolveCutoutSource({
      key: `overlay-${overlay.id}`,
      source: mediaEl,
      bgRemoval: overlay.bgRemoval,
      precomputedMask: preMask,
      onMaskUpdated,
      maxProcessWidth: isExport ? 960 : 540,
    });

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, overlay.opacity));
    ctx.drawImage(cutout, left, top, drawW, drawH);
    ctx.restore();

    const handleSize = Math.max(12, Math.round(14 * scaleFactor));
    if (showSelectionBox && overlay.id === selectedOverlayId) {
      ctx.save();
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = Math.max(2, 2 * scaleFactor);
      ctx.setLineDash([6 * scaleFactor, 4 * scaleFactor]);
      ctx.strokeRect(left, top, drawW, drawH);
      ctx.setLineDash([]);

      // Bottom-right resize handle
      const hx = left + drawW - handleSize / 2;
      const hy = top + drawH - handleSize / 2;
      ctx.fillStyle = '#38BDF8';
      ctx.strokeStyle = '#090B0E';
      ctx.lineWidth = Math.max(1.5, 1.5 * scaleFactor);
      ctx.fillRect(hx, hy, handleSize, handleSize);
      ctx.strokeRect(hx, hy, handleSize, handleSize);
      ctx.restore();
    }

    overlayBounds.push({
      id: overlay.id,
      left,
      top,
      width: drawW,
      height: drawH,
      handleX: left + drawW,
      handleY: top + drawH,
      handleSize: handleSize * 1.6,
    });
  }

  // 4. Text Overlays
  const textBounds: TextOverlayBounds[] = [];

  for (const overlay of textOverlays) {
    if (currentTime < overlay.startTime || currentTime > overlay.endTime) {
      continue;
    }
    const content = overlay.text.trim();
    if (!content) continue;

    const scaledFontSize = Math.max(12, Math.round(overlay.fontSize * scaleFactor));
    const lines = overlay.text.split('\n');
    const lineHeight = scaledFontSize * 1.25;

    ctx.font = `600 ${scaledFontSize}px "${overlay.fontFamily}", "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let maxLineWidth = 0;
    for (const line of lines) {
      const metrics = ctx.measureText(line || ' ');
      if (metrics.width > maxLineWidth) {
        maxLineWidth = metrics.width;
      }
    }

    const padX = Math.round(scaledFontSize * 0.55);
    const padY = Math.round(scaledFontSize * 0.35);
    const totalTextHeight = lines.length * lineHeight;
    const boxWidth = maxLineWidth + padX * 2;
    const boxHeight = totalTextHeight + padY * 2;

    const centerX = overlay.x * canvasWidth;
    const centerY = overlay.y * canvasHeight;
    const boxLeft = centerX - boxWidth / 2;
    const boxTop = centerY - boxHeight / 2;

    if (overlay.hasBackground) {
      ctx.fillStyle = overlay.backgroundColor;
      drawRoundedRect(
        ctx,
        boxLeft,
        boxTop,
        boxWidth,
        boxHeight,
        Math.max(6, Math.round(scaledFontSize * 0.25))
      );
      ctx.fill();
    }

    ctx.fillStyle = overlay.color;
    if (!overlay.hasBackground) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
      ctx.shadowBlur = Math.max(4, scaledFontSize * 0.16);
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }

    const startY = centerY - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => {
      ctx.fillText(line, centerX, startY + index * lineHeight);
    });

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    if (showSelectionBox && overlay.id === selectedTextId) {
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = Math.max(2, 2 * scaleFactor);
      ctx.setLineDash([6 * scaleFactor, 4 * scaleFactor]);
      ctx.strokeRect(boxLeft - 4, boxTop - 4, boxWidth + 8, boxHeight + 8);
      ctx.setLineDash([]);
    }

    textBounds.push({
      id: overlay.id,
      left: boxLeft,
      top: boxTop,
      width: boxWidth,
      height: boxHeight,
    });
  }

  ctx.restore();
  return {textBounds, overlayBounds};
}
