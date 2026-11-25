import type {
  AspectRatioPreset,
  BackgroundRemovalConfig,
  ClipTransition,
  FilterPreset,
  MotionTransform,
  OverlayAnimationPreset,
  OverlayLayerItem,
  TextOverlayItem,
  TimelineEffectItem,
  TimelineEffectType,
  VideoFilters,
  VideoFitMode,
} from '../types/editor';
import {
  applyChromaKeyToCanvas,
  applyMaskToCanvas,
  getCachedMaskOrSchedule,
} from './backgroundRemover';
import {getStickerImageElement} from './stickerRenderer';

export const ASPECT_RATIO_DIMENSIONS: Record<
  AspectRatioPreset,
  {width: number; height: number; label: string; subtitle: string}
> = {
  '16:9': {width: 1280, height: 720, label: '16:9', subtitle: 'YouTube'},
  '9:16': {width: 720, height: 1280, label: '9:16', subtitle: 'Reels / Shorts'},
  '1:1': {width: 1080, height: 1080, label: '1:1', subtitle: 'Square'},
};

export const FILTER_PRESET_VALUES: Record<
  FilterPreset,
  Omit<VideoFilters, 'preset'>
> = {
  none: {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    blur: 0,
    hueRotate: 0,
    vignette: 0,
    sharpen: 0,
    faceGlow: 0,
  },
  bw: {
    brightness: 104,
    contrast: 120,
    saturation: 0,
    blur: 0,
    hueRotate: 0,
    vignette: 10,
    sharpen: 10,
    faceGlow: 0,
  },
  vintage: {
    brightness: 105,
    contrast: 92,
    saturation: 72,
    blur: 0,
    hueRotate: -8,
    vignette: 35,
    sharpen: 0,
    faceGlow: 0,
  },
  warm: {
    brightness: 106,
    contrast: 104,
    saturation: 125,
    blur: 0,
    hueRotate: -6,
    vignette: 12,
    sharpen: 0,
    faceGlow: 0,
  },
  cinematic: {
    brightness: 95,
    contrast: 124,
    saturation: 88,
    blur: 0,
    hueRotate: 0,
    vignette: 32,
    sharpen: 15,
    faceGlow: 0,
  },
  'teal-orange': {
    brightness: 98,
    contrast: 118,
    saturation: 122,
    blur: 0,
    hueRotate: -4,
    vignette: 26,
    sharpen: 15,
    faceGlow: 0,
  },
  cyberpunk: {
    brightness: 102,
    contrast: 132,
    saturation: 155,
    blur: 0,
    hueRotate: 14,
    vignette: 30,
    sharpen: 20,
    faceGlow: 0,
  },
  noir: {
    brightness: 92,
    contrast: 150,
    saturation: 0,
    blur: 0,
    hueRotate: 0,
    vignette: 55,
    sharpen: 25,
    faceGlow: 0,
  },
  'warm-sunset': {
    brightness: 108,
    contrast: 108,
    saturation: 138,
    blur: 0,
    hueRotate: -12,
    vignette: 22,
    sharpen: 0,
    faceGlow: 0,
  },
  glitch: {
    brightness: 104,
    contrast: 122,
    saturation: 130,
    blur: 0,
    hueRotate: 0,
    vignette: 18,
    sharpen: 20,
    faceGlow: 0,
  },
};

export function buildCanvasFilterString(filters: VideoFilters): string {
  const parts: string[] = [
    `brightness(${filters.brightness}%)`,
    `contrast(${filters.contrast}%)`,
    `saturate(${filters.saturation}%)`,
  ];

  if (filters.hueRotate !== 0) {
    parts.push(`hue-rotate(${filters.hueRotate}deg)`);
  }

  if (filters.blur > 0) {
    parts.push(`blur(${filters.blur}px)`);
  }

  if (filters.preset === 'vintage') {
    parts.push('sepia(38%)');
  } else if (filters.preset === 'warm') {
    parts.push('sepia(20%)');
  } else if (filters.preset === 'warm-sunset') {
    parts.push('sepia(32%)');
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

export function isMediaReady(
  el: MediaSourceElement | null | undefined
): boolean {
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

function getCanvasSourceDims(
  source: CanvasImageSource,
  fallbackW: number,
  fallbackH: number
): {w: number; h: number} {
  if (source instanceof HTMLVideoElement) {
    return {w: source.videoWidth || fallbackW, h: source.videoHeight || fallbackH};
  }
  if (source instanceof HTMLImageElement) {
    return {
      w: source.naturalWidth || fallbackW,
      h: source.naturalHeight || fallbackH,
    };
  }
  if (source instanceof HTMLCanvasElement) {
    return {w: source.width || fallbackW, h: source.height || fallbackH};
  }
  return {w: fallbackW, h: fallbackH};
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

function applySharpenToCanvas(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  amount: number,
  maxWidth: number
): HTMLCanvasElement {
  const out = getScratchCanvas('sharpen-pass');
  const scale = Math.min(1, maxWidth / Math.max(srcW, srcH));
  const w = Math.max(8, Math.round(srcW * scale));
  const h = Math.max(8, Math.round(srcH * scale));

  if (out.width !== w || out.height !== h) {
    out.width = w;
    out.height = h;
  }

  const ctx = out.getContext('2d', {willReadFrequently: true});
  if (!ctx) return out;

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);

  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const src = imgData.data;
    const dst = new Uint8ClampedArray(src.length);
    const strength = Math.min(1.8, (amount / 100) * 1.4);

    for (let y = 0; y < h; y++) {
      const ym = y > 0 ? y - 1 : 0;
      const yp = y < h - 1 ? y + 1 : h - 1;
      for (let x = 0; x < w; x++) {
        const xm = x > 0 ? x - 1 : 0;
        const xp = x < w - 1 ? x + 1 : w - 1;
        const idx = (y * w + x) * 4;
        const top = (ym * w + x) * 4;
        const bot = (yp * w + x) * 4;
        const left = (y * w + xm) * 4;
        const right = (y * w + xp) * 4;

        for (let c = 0; c < 3; c++) {
          const avg =
            (src[top + c] + src[bot + c] + src[left + c] + src[right + c]) *
            0.25;
          dst[idx + c] = src[idx + c] + (src[idx + c] - avg) * strength;
        }
        dst[idx + 3] = src[idx + 3];
      }
    }

    ctx.putImageData(new ImageData(dst, w, h), 0, 0);
  } catch {
    // fallback to unsharpened draw if tainted
  }
  return out;
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

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

interface TimedMotionDelta {
  zoomMultiplier: number;
  offsetX: number;
  offsetY: number;
  angleDeg: number;
  shakeOffsetX: number;
  shakeOffsetY: number;
}

function computeTimedMotionDelta(
  effectItems: TimelineEffectItem[],
  currentTime: number,
  canvasWidth: number,
  canvasHeight: number,
  beatTimes: number[] = []
): TimedMotionDelta {
  let zoomMultiplier = 1;
  let offsetX = 0;
  let offsetY = 0;
  let angleDeg = 0;
  let shakeOffsetX = 0;
  let shakeOffsetY = 0;

  for (const ef of effectItems) {
    if (ef.category !== 'motion') continue;
    if (currentTime < ef.startTime || currentTime > ef.endTime) continue;

    const dur = Math.max(0.1, ef.endTime - ef.startTime);
    const rawProgress = Math.max(
      0,
      Math.min(1, (currentTime - ef.startTime) / dur)
    );
    const progress = easeInOutQuad(rawProgress);
    const strength =
      Math.max(0, Math.min(1, ef.intensity)) *
      Math.max(0, Math.min(1, ef.opacity));
    if (strength <= 0.005) continue;

    if (ef.type === 'zoom-in' || ef.type === 'zoom-out') {
      const targetScale =
        ef.targetZoom !== undefined
          ? Math.max(1.05, Math.min(3.0, ef.targetZoom / 100))
          : 1 + 1.2 * strength;
      const effScale =
        ef.type === 'zoom-in'
          ? 1 + (targetScale - 1) * progress
          : targetScale - (targetScale - 1) * progress;

      const fx = Math.max(0, Math.min(100, ef.zoomCenterX ?? 50)) / 100;
      const fy = Math.max(0, Math.min(100, ef.zoomCenterY ?? 50)) / 100;

      offsetX += (0.5 - fx) * canvasWidth * (effScale - 1);
      offsetY += (0.5 - fy) * canvasHeight * (effScale - 1);
      zoomMultiplier *= effScale;
    } else if (ef.type === 'camera-shake') {
      const t = currentTime;
      const sx =
        (Math.sin(t * 15.2) * 0.62 + Math.cos(t * 25.4) * 0.38) *
        (canvasWidth * 0.018 * strength);
      const sy =
        (Math.cos(t * 17.6) * 0.62 + Math.sin(t * 27.8) * 0.38) *
        (canvasHeight * 0.018 * strength);
      offsetX += sx;
      offsetY += sy;
      shakeOffsetX += sx;
      shakeOffsetY += sy;
      angleDeg += Math.sin(t * 11.5) * 1.9 * strength;
      zoomMultiplier *= 1 + 0.095 * strength;
    } else if (ef.type === 'heartbeat-zoom') {
      let pulse = 0;
      if (beatTimes.length > 0) {
        let minDist = 999;
        for (let b = 0; b < beatTimes.length; b++) {
          const dt = currentTime - beatTimes[b];
          if (dt >= 0 && dt < minDist) {
            minDist = dt;
          }
        }
        if (minDist < 0.4) {
          pulse = Math.exp(-minDist * 14);
        }
      } else {
        // Organic 78 BPM lub-dub double pulse
        const period = 60 / 78;
        const phase = (Math.max(0, currentTime - ef.startTime) % period);
        const lub = Math.exp(-phase * 16);
        const dub =
          phase >= 0.16 ? 0.58 * Math.exp(-(phase - 0.16) * 19) : 0;
        pulse = Math.min(1, lub + dub);
      }
      zoomMultiplier *= 1 + pulse * 0.16 * strength;
    }
  }

  return {
    zoomMultiplier,
    offsetX,
    offsetY,
    angleDeg,
    shakeOffsetX,
    shakeOffsetY,
  };
}

function drawTransformedSingleSource(params: {
  ctx: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  source: CanvasImageSource;
  naturalW: number;
  naturalH: number;
  fitMode: VideoFitMode;
  filters: VideoFilters;
  motionTransform: MotionTransform;
  timedMotion?: TimedMotionDelta;
  clipProgress: number;
  currentTime: number;
  isExport: boolean;
}) {
  const {
    ctx,
    canvasWidth,
    canvasHeight,
    source,
    naturalW,
    naturalH,
    fitMode,
    filters,
    motionTransform,
    timedMotion,
    clipProgress,
    currentTime,
    isExport,
  } = params;

  const baseScale =
    fitMode === 'cover'
      ? Math.max(canvasWidth / naturalW, canvasHeight / naturalH)
      : Math.min(canvasWidth / naturalW, canvasHeight / naturalH);

  const drawW = naturalW * baseScale;
  const drawH = naturalH * baseScale;

  let finalSource = source;
  if (filters.sharpen > 0) {
    const dims = getCanvasSourceDims(source, naturalW, naturalH);
    finalSource = applySharpenToCanvas(
      source,
      dims.w,
      dims.h,
      filters.sharpen,
      isExport ? 1080 : 640
    );
  }

  let animZoom = 1;
  let shakeOffsetX = 0;
  let shakeOffsetY = 0;
  let shakeAngleDeg = 0;

  if (motionTransform.preset === 'zoom-in') {
    animZoom = 1 + 0.28 * Math.min(1, Math.max(0, clipProgress));
  } else if (motionTransform.preset === 'zoom-out') {
    animZoom = 1.28 - 0.28 * Math.min(1, Math.max(0, clipProgress));
  } else if (motionTransform.preset === 'camera-shake') {
    const t = currentTime;
    shakeOffsetX =
      (Math.sin(t * 17.3) * 0.6 + Math.cos(t * 29.1) * 0.4) *
      (canvasWidth * 0.014);
    shakeOffsetY =
      (Math.cos(t * 19.7) * 0.6 + Math.sin(t * 31.4) * 0.4) *
      (canvasHeight * 0.014);
    shakeAngleDeg = Math.sin(t * 13.5) * 1.4;
    animZoom = 1.06;
  }

  const timedZoom = timedMotion ? timedMotion.zoomMultiplier : 1;
  const totalZoom = (motionTransform.zoom / 100) * animZoom * timedZoom;
  const panPxX =
    (motionTransform.panX / 100) * (canvasWidth * 0.5) +
    shakeOffsetX +
    (timedMotion ? timedMotion.offsetX : 0);
  const panPxY =
    (motionTransform.panY / 100) * (canvasHeight * 0.5) +
    shakeOffsetY +
    (timedMotion ? timedMotion.offsetY : 0);
  const rad =
    ((motionTransform.rotate +
      shakeAngleDeg +
      (timedMotion ? timedMotion.angleDeg : 0)) *
      Math.PI) /
    180;
  const scaleX = totalZoom * (motionTransform.flipH ? -1 : 1);
  const scaleY = totalZoom * (motionTransform.flipV ? -1 : 1);

  ctx.save();
  ctx.translate(canvasWidth / 2 + panPxX, canvasHeight / 2 + panPxY);
  if (rad !== 0) ctx.rotate(rad);
  ctx.scale(scaleX, scaleY);
  ctx.filter = buildCanvasFilterString(filters);
  ctx.drawImage(finalSource, -drawW / 2, -drawH / 2, drawW, drawH);

  if (filters.preset === 'glitch') {
    const pulse = Math.abs(Math.sin(currentTime * 14.7));
    const offset = (4 + pulse * 14) * (canvasWidth / 1280);
    ctx.globalAlpha = 0.32;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(finalSource, -drawW / 2 + offset, -drawH / 2, drawW, drawH);
    ctx.drawImage(finalSource, -drawW / 2 - offset, -drawH / 2, drawW, drawH);

    const barSeed = Math.sin(currentTime * 23.1);
    if (barSeed > 0.25) {
      const sliceY = -drawH / 2 + (barSeed * 0.7 + 0.15) * drawH;
      const sliceH = Math.max(8, drawH * 0.06);
      ctx.globalAlpha = 0.45;
      ctx.drawImage(
        finalSource,
        0,
        (barSeed * 0.7 + 0.15) *
          getCanvasSourceDims(finalSource, naturalW, naturalH).h,
        getCanvasSourceDims(finalSource, naturalW, naturalH).w,
        Math.max(
          8,
          getCanvasSourceDims(finalSource, naturalW, naturalH).h * 0.06
        ),
        -drawW / 2 + offset * 2.2,
        sliceY,
        drawW,
        sliceH
      );
    }
  }
  ctx.restore();
}

function drawColorGradingAndVignette(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  filters: VideoFilters
) {
  if (filters.preset === 'teal-orange') {
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
    grad.addColorStop(0, 'rgba(13, 148, 136, 0.28)');
    grad.addColorStop(1, 'rgba(249, 115, 22, 0.28)');
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  } else if (filters.preset === 'cyberpunk') {
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
    grad.addColorStop(0, 'rgba(236, 72, 153, 0.30)');
    grad.addColorStop(1, 'rgba(6, 182, 212, 0.30)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  } else if (filters.preset === 'warm-sunset') {
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    grad.addColorStop(0, 'rgba(251, 146, 60, 0.28)');
    grad.addColorStop(1, 'rgba(180, 83, 9, 0.22)');
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  } else if (filters.preset === 'cinematic') {
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    grad.addColorStop(0, 'rgba(30, 58, 138, 0.18)');
    grad.addColorStop(1, 'rgba(180, 120, 60, 0.18)');
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  } else if (filters.preset === 'vintage') {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = 'rgba(196, 148, 86, 0.26)';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  } else if (filters.preset === 'warm') {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  }

  if (filters.vignette > 0) {
    ctx.save();
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const outerR = Math.hypot(cx, cy);
    const innerR = outerR * (0.48 - (filters.vignette / 100) * 0.22);
    const strength = Math.min(0.92, (filters.vignette / 100) * 0.88);
    const radGrad = ctx.createRadialGradient(
      cx,
      cy,
      Math.max(0, innerR),
      cx,
      cy,
      outerR
    );
    radGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    radGrad.addColorStop(1, `rgba(0, 0, 0, ${strength})`);
    ctx.fillStyle = radGrad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  }
}

function drawFaceGlowBeautyPass(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  faceGlow: number
) {
  if (faceGlow <= 0) return;
  const amount = Math.min(1, Math.max(0, faceGlow / 100));
  const glowCanvas = getScratchCanvas('face-glow-pass');
  const scale = 0.35;
  const gw = Math.max(32, Math.round(canvasWidth * scale));
  const gh = Math.max(32, Math.round(canvasHeight * scale));
  if (glowCanvas.width !== gw || glowCanvas.height !== gh) {
    glowCanvas.width = gw;
    glowCanvas.height = gh;
  }

  const gctx = glowCanvas.getContext('2d');
  if (!gctx) return;
  gctx.clearRect(0, 0, gw, gh);
  gctx.save();
  gctx.filter = `blur(${(3 + amount * 6).toFixed(1)}px) brightness(${108 + Math.round(amount * 18)}%) saturate(${100 + Math.round(amount * 12)}%)`;
  gctx.drawImage(ctx.canvas, 0, 0, gw, gh);
  gctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 0.24 + amount * 0.42;
  ctx.drawImage(glowCanvas, 0, 0, canvasWidth, canvasHeight);

  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = amount * 0.22;
  ctx.drawImage(glowCanvas, 0, 0, canvasWidth, canvasHeight);

  const cx = canvasWidth / 2;
  const cy = canvasHeight * 0.46;
  const r = Math.hypot(canvasWidth, canvasHeight) * 0.48;
  const rad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  rad.addColorStop(0, `rgba(255, 242, 232, ${(amount * 0.14).toFixed(3)})`);
  rad.addColorStop(1, 'rgba(255, 242, 232, 0)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.restore();
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

function seededRand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function isPresetType(
  type: TimelineEffectType
): type is Exclude<FilterPreset, 'none'> {
  return type in FILTER_PRESET_VALUES;
}

function drawSnapshotOfCanvas(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  key = 'timed-effect-snapshot'
): HTMLCanvasElement | null {
  const snapshot = getScratchCanvas(key);
  if (snapshot.width !== canvasWidth || snapshot.height !== canvasHeight) {
    snapshot.width = canvasWidth;
    snapshot.height = canvasHeight;
  }
  const sctx = snapshot.getContext('2d');
  if (!sctx) return null;
  sctx.clearRect(0, 0, canvasWidth, canvasHeight);
  sctx.drawImage(ctx.canvas, 0, 0, canvasWidth, canvasHeight);
  return snapshot;
}

function drawGlitchOverlayPass(
  ctx: CanvasRenderingContext2D,
  snapshot: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  currentTime: number,
  intensity: number,
  opacity: number
) {
  const pulse = 0.25 + 0.75 * Math.abs(Math.sin(currentTime * 14.3 + 0.4));
  const shift = (4 + pulse * 18 * intensity) * (canvasWidth / 1280);

  ctx.save();
  // Crisp cyan/magenta micro-aberration shift that preserves center clarity
  ctx.globalAlpha = Math.min(0.62, 0.22 + intensity * 0.36) * opacity;
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(snapshot, shift, 0, canvasWidth, canvasHeight);
  ctx.drawImage(snapshot, -shift, 0, canvasWidth, canvasHeight);

  // Clean horizontal glitch displacement bands
  const sliceCount = Math.max(2, Math.round(2 + intensity * 4));
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < sliceCount; i++) {
    const seed = Math.sin((currentTime + 0.31) * (17.1 + i * 6.3) + i * 2.1);
    if (seed > 0.15) {
      const yNorm = Math.abs(
        Math.sin(i * 4.9 + Math.floor(currentTime * 10) + 0.5)
      );
      const sliceY = yNorm * (canvasHeight * 0.88);
      const sliceH = Math.max(6, canvasHeight * (0.018 + intensity * 0.028));
      const xOffset =
        (seed >= 0 ? 1 : -1) * Math.max(0.3, Math.abs(seed)) * shift * 1.8;
      ctx.globalAlpha = (0.35 + intensity * 0.45) * opacity;
      ctx.drawImage(
        snapshot,
        0,
        sliceY,
        canvasWidth,
        sliceH,
        xOffset,
        sliceY,
        canvasWidth,
        sliceH
      );
    }
  }
  ctx.restore();
}

function drawTimedFilterAndGlitchEffects(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  effectItems: TimelineEffectItem[],
  currentTime: number
) {
  for (const ef of effectItems) {
    if (ef.category !== 'filter') continue;
    if (currentTime < ef.startTime || currentTime > ef.endTime) continue;

    const intensity = Math.max(0, Math.min(1, ef.intensity));
    const opacity = Math.max(0, Math.min(1, ef.opacity));
    if (intensity <= 0.01 || opacity <= 0.01) continue;

    const snapshot = drawSnapshotOfCanvas(ctx, canvasWidth, canvasHeight);
    if (!snapshot) continue;

    if (ef.type === 'glitch') {
      drawGlitchOverlayPass(
        ctx,
        snapshot,
        canvasWidth,
        canvasHeight,
        currentTime,
        intensity,
        opacity
      );
      continue;
    }

    if (isPresetType(ef.type)) {
      const target = FILTER_PRESET_VALUES[ef.type];
      const gradedFilters: VideoFilters = {
        preset: ef.type,
        brightness: 100 + (target.brightness - 100) * intensity,
        contrast: 100 + (target.contrast - 100) * intensity,
        saturation: 100 + (target.saturation - 100) * intensity,
        blur: target.blur * intensity,
        hueRotate: target.hueRotate * intensity,
        vignette: target.vignette * intensity * opacity,
        sharpen: 0,
        faceGlow: 0,
      };

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.filter = buildCanvasFilterString(gradedFilters);
      ctx.drawImage(snapshot, 0, 0, canvasWidth, canvasHeight);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = opacity * intensity;
      drawColorGradingAndVignette(ctx, canvasWidth, canvasHeight, {
        ...gradedFilters,
        vignette: target.vignette * intensity,
      });
      ctx.restore();
    }
  }
}

/**
 * 60fps Cinematic Glow / Halation: isolates bright highlights on a downscaled
 * scratch canvas and composites a warm dreamy film bloom via Screen blend.
 */
function drawHalationPass(
  ctx: CanvasRenderingContext2D,
  snapshot: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  intensity: number,
  opacity: number,
  isExport: boolean
) {
  const maxDim = isExport ? 420 : 280;
  const scale = Math.min(1, maxDim / Math.max(canvasWidth, canvasHeight));
  const w = Math.max(32, Math.round(canvasWidth * scale));
  const h = Math.max(32, Math.round(canvasHeight * scale));

  const hiCanvas = getScratchCanvas('halation-hi');
  if (hiCanvas.width !== w || hiCanvas.height !== h) {
    hiCanvas.width = w;
    hiCanvas.height = h;
  }
  const hctx = hiCanvas.getContext('2d', {willReadFrequently: true});
  if (!hctx) return;

  hctx.clearRect(0, 0, w, h);
  hctx.drawImage(snapshot, 0, 0, w, h);

  try {
    const img = hctx.getImageData(0, 0, w, h);
    const data = img.data;
    const thresh = 175 - intensity * 45; // 175 -> 130
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum <= thresh) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
      } else {
        const k = Math.min(1, (lum - thresh) / (255 - thresh));
        // Subtle warm film halation tint on bright highlights
        data[i] = Math.min(255, Math.round(r * 1.12));
        data[i + 1] = Math.min(255, Math.round(g * 0.96));
        data[i + 2] = Math.min(255, Math.round(b * 0.84));
        data[i + 3] = Math.round(k * 255);
      }
    }
    hctx.putImageData(img, 0, 0);
  } catch {
    // fallback if cross-origin
  }

  const blurCanvas = getScratchCanvas('halation-blur');
  if (blurCanvas.width !== w || blurCanvas.height !== h) {
    blurCanvas.width = w;
    blurCanvas.height = h;
  }
  const bctx = blurCanvas.getContext('2d');
  if (!bctx) return;
  bctx.clearRect(0, 0, w, h);
  bctx.save();
  bctx.filter = `blur(${(6 + intensity * 10).toFixed(1)}px)`;
  bctx.drawImage(hiCanvas, 0, 0, w, h);
  bctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = Math.min(0.95, (0.35 + intensity * 0.6) * opacity);
  ctx.drawImage(blurCanvas, 0, 0, canvasWidth, canvasHeight);
  ctx.restore();
}

/**
 * 60fps Neon Edge / Cyber Glow: crisp glowing rim highlights around high-contrast
 * edges using a fast downscaled Sobel edge pass + Screen bloom.
 */
function drawNeonEdgePass(
  ctx: CanvasRenderingContext2D,
  snapshot: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  intensity: number,
  opacity: number,
  localTime: number,
  isExport: boolean
) {
  const maxDim = isExport ? 420 : 280;
  const scale = Math.min(1, maxDim / Math.max(canvasWidth, canvasHeight));
  const w = Math.max(32, Math.round(canvasWidth * scale));
  const h = Math.max(32, Math.round(canvasHeight * scale));

  const edgeCanvas = getScratchCanvas('neon-edge-raw');
  if (edgeCanvas.width !== w || edgeCanvas.height !== h) {
    edgeCanvas.width = w;
    edgeCanvas.height = h;
  }
  const ectx = edgeCanvas.getContext('2d', {willReadFrequently: true});
  if (!ectx) return;

  ectx.clearRect(0, 0, w, h);
  ectx.drawImage(snapshot, 0, 0, w, h);

  try {
    const img = ectx.getImageData(0, 0, w, h);
    const src = img.data;
    const out = new Uint8ClampedArray(src.length);
    const thresh = Math.max(24, 58 - intensity * 26);
    const phase = Math.sin(localTime * 1.4) * 0.5 + 0.5;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        const iL = i - 4;
        const iR = i + 4;
        const iU = i - w * 4;
        const iD = i + w * 4;

        const lumL =
          0.299 * src[iL] + 0.587 * src[iL + 1] + 0.114 * src[iL + 2];
        const lumR =
          0.299 * src[iR] + 0.587 * src[iR + 1] + 0.114 * src[iR + 2];
        const lumU =
          0.299 * src[iU] + 0.587 * src[iU + 1] + 0.114 * src[iU + 2];
        const lumD =
          0.299 * src[iD] + 0.587 * src[iD + 1] + 0.114 * src[iD + 2];

        const mag = Math.abs(lumR - lumL) + Math.abs(lumD - lumU);
        if (mag > thresh) {
          const norm = Math.min(1, (mag - thresh) / 95);
          const mix = (x / w) * 0.7 + phase * 0.3;
          // Electric Cyan -> Cyber Magenta gradient along edges
          out[i] = Math.round(34 + mix * 210);
          out[i + 1] = Math.round(211 - mix * 140);
          out[i + 2] = Math.round(248 - mix * 50);
          out[i + 3] = Math.round(norm * 255);
        }
      }
    }
    ectx.putImageData(new ImageData(out, w, h), 0, 0);

    const glowCanvas = getScratchCanvas('neon-edge-glow');
    if (glowCanvas.width !== w || glowCanvas.height !== h) {
      glowCanvas.width = w;
      glowCanvas.height = h;
    }
    const gctx = glowCanvas.getContext('2d');
    if (gctx) {
      gctx.clearRect(0, 0, w, h);
      gctx.save();
      gctx.filter = `blur(${(2.5 + intensity * 4.5).toFixed(1)}px)`;
      gctx.drawImage(edgeCanvas, 0, 0, w, h);
      gctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(0.95, (0.35 + intensity * 0.6) * opacity);
      ctx.drawImage(glowCanvas, 0, 0, canvasWidth, canvasHeight);
      ctx.globalAlpha = Math.min(0.85, (0.25 + intensity * 0.55) * opacity);
      ctx.drawImage(edgeCanvas, 0, 0, canvasWidth, canvasHeight);
      ctx.restore();
    }
  } catch {
    // ignore cross-origin fallback
  }
}

/**
 * 60fps Dreamy Blur Vignette (Focus Pull): keeps center subject razor-sharp
 * while softly blurring and gently darkening the outer edges.
 */
function drawFocusPullPass(
  ctx: CanvasRenderingContext2D,
  snapshot: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  intensity: number,
  opacity: number,
  isExport: boolean
) {
  const maxDim = isExport ? 540 : 380;
  const scale = Math.min(1, maxDim / Math.max(canvasWidth, canvasHeight));
  const w = Math.max(32, Math.round(canvasWidth * scale));
  const h = Math.max(32, Math.round(canvasHeight * scale));

  const blurWork = getScratchCanvas('focus-pull-blur');
  if (blurWork.width !== w || blurWork.height !== h) {
    blurWork.width = w;
    blurWork.height = h;
  }
  const bctx = blurWork.getContext('2d');
  if (!bctx) return;

  bctx.clearRect(0, 0, w, h);
  bctx.save();
  bctx.filter = `blur(${(4 + intensity * 12).toFixed(1)}px)`;
  bctx.drawImage(snapshot, 0, 0, w, h);

  // Punch out crisp center using destination-out radial mask
  bctx.globalCompositeOperation = 'destination-out';
  const cx = w * 0.5;
  const cy = h * 0.48;
  const outerR = Math.hypot(w, h) * 0.54;
  const clearR = outerR * (0.42 - intensity * 0.14);
  const maskGrad = bctx.createRadialGradient(
    cx,
    cy,
    Math.max(4, clearR * 0.55),
    cx,
    cy,
    outerR
  );
  maskGrad.addColorStop(0, 'rgba(0,0,0,1)');
  maskGrad.addColorStop(0.55, 'rgba(0,0,0,0.82)');
  maskGrad.addColorStop(1, 'rgba(0,0,0,0)');
  bctx.fillStyle = maskGrad;
  bctx.fillRect(0, 0, w, h);
  bctx.restore();

  ctx.save();
  ctx.globalAlpha = Math.min(0.95, (0.45 + intensity * 0.52) * opacity);
  ctx.drawImage(blurWork, 0, 0, canvasWidth, canvasHeight);

  // Subtle darkening outer vignette to frame the subject
  const vCx = canvasWidth * 0.5;
  const vCy = canvasHeight * 0.48;
  const vOuter = Math.hypot(canvasWidth, canvasHeight) * 0.56;
  const vGrad = ctx.createRadialGradient(
    vCx,
    vCy,
    vOuter * 0.36,
    vCx,
    vCy,
    vOuter
  );
  vGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vGrad.addColorStop(
    1,
    `rgba(5, 7, 12, ${(0.45 * intensity * opacity).toFixed(3)})`
  );
  ctx.globalAlpha = 1;
  ctx.fillStyle = vGrad;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.restore();
}

function drawStudioAndCinemaVfx(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  effectItems: TimelineEffectItem[],
  currentTime: number,
  beatTimes: number[],
  isExport: boolean
) {
  const scaleFactor = Math.min(canvasWidth, canvasHeight) / 720;

  for (const ef of effectItems) {
    if (ef.category !== 'studio' && ef.category !== 'cinema') continue;
    if (currentTime < ef.startTime || currentTime > ef.endTime) continue;

    const intensity = Math.max(0, Math.min(1, ef.intensity));
    const opacity = Math.max(0, Math.min(1, ef.opacity));
    if (intensity <= 0.01 || opacity <= 0.01) continue;
    const localTime = Math.max(0, currentTime - ef.startTime);

    if (ef.type === 'halation') {
      const snapshot = drawSnapshotOfCanvas(ctx, canvasWidth, canvasHeight);
      if (snapshot) {
        drawHalationPass(
          ctx,
          snapshot,
          canvasWidth,
          canvasHeight,
          intensity,
          opacity,
          isExport
        );
      }
      continue;
    }

    if (ef.type === 'neon-edge') {
      const snapshot = drawSnapshotOfCanvas(ctx, canvasWidth, canvasHeight);
      if (snapshot) {
        drawNeonEdgePass(
          ctx,
          snapshot,
          canvasWidth,
          canvasHeight,
          intensity,
          opacity,
          localTime,
          isExport
        );
      }
      continue;
    }

    if (ef.type === 'golden-hour') {
      const snapshot = drawSnapshotOfCanvas(ctx, canvasWidth, canvasHeight);
      if (snapshot) {
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.filter = `brightness(${100 + Math.round(intensity * 10)}%) saturate(${100 + Math.round(intensity * 32)}%) sepia(${Math.round(intensity * 24)}%) hue-rotate(${(-intensity * 5).toFixed(1)}deg)`;
        ctx.drawImage(snapshot, 0, 0, canvasWidth, canvasHeight);
        ctx.restore();
      }
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      const warmWash = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
      warmWash.addColorStop(
        0,
        `rgba(251, 191, 36, ${(0.34 * intensity * opacity).toFixed(3)})`
      );
      warmWash.addColorStop(
        1,
        `rgba(217, 119, 6, ${(0.24 * intensity * opacity).toFixed(3)})`
      );
      ctx.fillStyle = warmWash;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Soft sunlight upper-corner warmth
      ctx.globalCompositeOperation = 'screen';
      const sunR = Math.hypot(canvasWidth, canvasHeight) * 0.65;
      const sunGrad = ctx.createRadialGradient(
        canvasWidth * 0.12,
        canvasHeight * 0.1,
        0,
        canvasWidth * 0.12,
        canvasHeight * 0.1,
        sunR
      );
      sunGrad.addColorStop(
        0,
        `rgba(255, 232, 168, ${(0.26 * intensity * opacity).toFixed(3)})`
      );
      sunGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.restore();
      continue;
    }

    if (ef.type === 'bokeh-particles') {
      const count = Math.round(14 + intensity * 26);
      const baseSeed = hashSeed(ef.id);
      const colors = [
        '253, 224, 71', // warm gold
        '251, 191, 36', // amber
        '244, 114, 182', // soft rose
        '125, 211, 252', // dreamy sky
        '255, 247, 220', // champagne
      ];
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 7 + 1);
        const r2 = seededRand(baseSeed + i * 7 + 2);
        const r3 = seededRand(baseSeed + i * 7 + 3);
        const r4 = seededRand(baseSeed + i * 7 + 4);

        const depth = 0.4 + r3 * 0.6;
        const speedY = (14 + depth * 28) * scaleFactor;
        const spanH = canvasHeight + 120 * scaleFactor;
        const x =
          (r1 * canvasWidth +
            Math.sin(localTime * (0.45 + r2 * 0.7) + i) * 38 * scaleFactor +
            canvasWidth) %
          canvasWidth;
        const y =
          (((r2 * spanH - localTime * speedY) % spanH) + spanH) % spanH -
          60 * scaleFactor;
        const radius =
          (14 + depth * 36) * scaleFactor * (0.7 + intensity * 0.45);
        const twinkle = 0.6 + 0.4 * Math.sin(localTime * (1.2 + r4 * 1.8) + i);
        const alpha = Math.min(
          0.62,
          (0.16 + depth * 0.24) * twinkle * (0.4 + intensity * 0.6) * opacity
        );
        const rgb = colors[i % colors.length];

        const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
        grad.addColorStop(0, `rgba(${rgb}, ${(alpha * 0.55).toFixed(3)})`);
        grad.addColorStop(0.68, `rgba(${rgb}, ${(alpha * 0.88).toFixed(3)})`);
        grad.addColorStop(0.92, `rgba(${rgb}, ${(alpha * 0.35).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      continue;
    }

    if (ef.type === 'focus-pull') {
      const snapshot = drawSnapshotOfCanvas(ctx, canvasWidth, canvasHeight);
      if (snapshot) {
        drawFocusPullPass(
          ctx,
          snapshot,
          canvasWidth,
          canvasHeight,
          intensity,
          opacity,
          isExport
        );
      }
      continue;
    }

    if (ef.type === 'disco') {
      let beatPulse = Math.pow(
        0.5 + 0.5 * Math.sin(currentTime * ((126 / 60) * Math.PI * 2)),
        2
      );
      let beatIndex = Math.floor(currentTime / 0.476);
      if (beatTimes.length > 0) {
        let minDist = 999;
        let closestIdx = 0;
        for (let b = 0; b < beatTimes.length; b++) {
          const d = Math.abs(currentTime - beatTimes[b]);
          if (d < minDist) {
            minDist = d;
            closestIdx = b;
          }
        }
        if (minDist < 0.22) {
          beatPulse = Math.max(beatPulse, 1 - minDist / 0.22);
          beatIndex = closestIdx;
        }
      }

      const palette = [
        '236, 72, 153',
        '56, 189, 248',
        '168, 85, 247',
        '250, 204, 21',
        '52, 211, 153',
      ];
      const c1 = palette[beatIndex % palette.length];
      const c2 = palette[(beatIndex + 2) % palette.length];

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const sx1 = canvasWidth * (0.24 + 0.24 * Math.sin(localTime * 2.6));
      const sy1 = canvasHeight * (0.28 + 0.18 * Math.cos(localTime * 2.1));
      const g1 = ctx.createRadialGradient(
        sx1,
        sy1,
        0,
        sx1,
        sy1,
        Math.hypot(canvasWidth, canvasHeight) * 0.52
      );
      g1.addColorStop(
        0,
        `rgba(${c1}, ${((0.18 + beatPulse * 0.3) * intensity * opacity).toFixed(3)})`
      );
      g1.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      const sx2 = canvasWidth * (0.76 - 0.2 * Math.cos(localTime * 2.4));
      const sy2 = canvasHeight * (0.68 - 0.2 * Math.sin(localTime * 2.9));
      const g2 = ctx.createRadialGradient(
        sx2,
        sy2,
        0,
        sx2,
        sy2,
        Math.hypot(canvasWidth, canvasHeight) * 0.48
      );
      g2.addColorStop(
        0,
        `rgba(${c2}, ${((0.16 + beatPulse * 0.26) * intensity * opacity).toFixed(3)})`
      );
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.restore();
      continue;
    }

    if (ef.type === 'letterbox') {
      const barH = Math.round(canvasHeight * (0.04 + intensity * 0.13));
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${opacity.toFixed(3)})`;
      ctx.fillRect(0, 0, canvasWidth, barH);
      ctx.fillRect(0, canvasHeight - barH, canvasWidth, barH);
      ctx.restore();
      continue;
    }

    if (ef.type === 'film-grain') {
      const grainCanvas = getScratchCanvas('film-grain-tex');
      const gw = Math.max(96, Math.round(canvasWidth * 0.25));
      const gh = Math.max(96, Math.round(canvasHeight * 0.25));
      if (grainCanvas.width !== gw || grainCanvas.height !== gh) {
        grainCanvas.width = gw;
        grainCanvas.height = gh;
      }
      const gctx = grainCanvas.getContext('2d');
      if (gctx) {
        const img = gctx.createImageData(gw, gh);
        const buf = img.data;
        let seed = (Math.floor(currentTime * 24) * 2654435761) >>> 0 || 1337;
        for (let i = 0; i < buf.length; i += 4) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const v = (seed >>> 24) & 0xff;
          buf[i] = v;
          buf[i + 1] = v;
          buf[i + 2] = v;
          buf[i + 3] = 255;
        }
        gctx.putImageData(img, 0, 0);

        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = Math.min(0.48, (0.14 + intensity * 0.34) * opacity);
        ctx.drawImage(grainCanvas, 0, 0, canvasWidth, canvasHeight);
        ctx.restore();
      }
      continue;
    }

    if (ef.type === 'lens-flare') {
      const fx =
        canvasWidth * (0.22 + 0.56 * (0.5 + 0.5 * Math.sin(localTime * 0.55)));
      const fy = canvasHeight * (0.2 + 0.1 * Math.cos(localTime * 0.45));
      ctx.save();
      ctx.globalCompositeOperation = 'screen';

      const rMain =
        Math.hypot(canvasWidth, canvasHeight) * (0.2 + intensity * 0.18);
      const gOrb = ctx.createRadialGradient(fx, fy, 0, fx, fy, rMain);
      gOrb.addColorStop(
        0,
        `rgba(255, 250, 235, ${(0.65 * intensity * opacity).toFixed(3)})`
      );
      gOrb.addColorStop(
        0.25,
        `rgba(253, 186, 116, ${(0.36 * intensity * opacity).toFixed(3)})`
      );
      gOrb.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gOrb;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      const streakH = (8 + intensity * 14) * scaleFactor;
      const gStreak = ctx.createLinearGradient(0, fy, canvasWidth, fy);
      gStreak.addColorStop(0, 'rgba(56, 189, 248, 0)');
      gStreak.addColorStop(
        0.5,
        `rgba(125, 211, 252, ${(0.45 * intensity * opacity).toFixed(3)})`
      );
      gStreak.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = gStreak;
      ctx.fillRect(0, fy - streakH / 2, canvasWidth, streakH);

      const cx = canvasWidth / 2;
      const cy = canvasHeight / 2;
      for (let k = 1; k <= 3; k++) {
        const t = k * 0.48;
        const bx = cx + (cx - fx) * t;
        const by = cy + (cy - fy) * t;
        const br = (12 + k * 8) * scaleFactor * (0.6 + intensity * 0.5);
        ctx.fillStyle =
          k % 2 === 0
            ? `rgba(251, 146, 60, ${(0.18 * intensity * opacity).toFixed(3)})`
            : `rgba(56, 189, 248, ${(0.16 * intensity * opacity).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      continue;
    }

    if (ef.type === 'light-leak') {
      const lx = canvasWidth * (0.06 + 0.1 * Math.sin(localTime * 0.8));
      const ly = canvasHeight * (0.16 + 0.16 * Math.cos(localTime * 0.65));
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const r1 =
        Math.hypot(canvasWidth, canvasHeight) * (0.4 + intensity * 0.22);
      const grad1 = ctx.createRadialGradient(lx, ly, 0, lx, ly, r1);
      grad1.addColorStop(
        0,
        `rgba(251, 146, 60, ${(0.52 * intensity * opacity).toFixed(3)})`
      );
      grad1.addColorStop(
        0.48,
        `rgba(244, 63, 94, ${(0.24 * intensity * opacity).toFixed(3)})`
      );
      grad1.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad1;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.restore();
      continue;
    }

    if (ef.type === 'ai-portrait') {
      drawFaceGlowBeautyPass(
        ctx,
        canvasWidth,
        canvasHeight,
        intensity * 90 * opacity
      );
      const snapshot = drawSnapshotOfCanvas(ctx, canvasWidth, canvasHeight);
      if (snapshot) {
        ctx.save();
        ctx.globalAlpha = 0.22 * intensity * opacity;
        ctx.filter = `contrast(${110 + Math.round(intensity * 16)}%) saturate(${105 + Math.round(intensity * 10)}%)`;
        ctx.drawImage(snapshot, 0, 0, canvasWidth, canvasHeight);
        ctx.restore();
      }
    }
  }
}

function drawWeatherEffects(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  effectItems: TimelineEffectItem[],
  currentTime: number
) {
  const scaleFactor = Math.min(canvasWidth, canvasHeight) / 720;

  for (const ef of effectItems) {
    if (ef.category !== 'weather') continue;
    if (currentTime < ef.startTime || currentTime > ef.endTime) {
      continue;
    }

    const intensity = Math.max(0, Math.min(1, ef.intensity));
    const opacity = Math.max(0, Math.min(1, ef.opacity));
    if (intensity <= 0.01 || opacity <= 0.01) continue;
    const localTime = Math.max(0, currentTime - ef.startTime);
    const baseSeed = hashSeed(ef.id);

    ctx.save();

    if (ef.type === 'rain') {
      const count = Math.round(55 + intensity * 145);
      ctx.lineCap = 'round';
      ctx.fillStyle = `rgba(30, 58, 102, ${(0.06 * opacity * intensity).toFixed(3)})`;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 7 + 1);
        const r2 = seededRand(baseSeed + i * 7 + 2);
        const r3 = seededRand(baseSeed + i * 7 + 3);
        const r4 = seededRand(baseSeed + i * 7 + 4);

        const speedY = (840 + r3 * 640) * scaleFactor * (0.75 + intensity * 0.5);
        const slant = -0.19;
        const ySpan = canvasHeight + 140 * scaleFactor;
        const y = ((r2 * ySpan + localTime * speedY) % ySpan) - 70 * scaleFactor;
        const x = (r1 * canvasWidth + y * slant + canvasWidth * 2) % canvasWidth;

        const streakLen =
          (28 + r4 * 40) * scaleFactor * (0.75 + intensity * 0.45);
        const alpha = Math.min(0.82, (0.28 + r3 * 0.38) * opacity);

        ctx.strokeStyle = `rgba(220, 240, 255, ${alpha.toFixed(3)})`;
        ctx.lineWidth = Math.max(1.1, (1.2 + r4 * 1.4) * scaleFactor);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + streakLen * slant, y + streakLen);
        ctx.stroke();

        if (i % 5 === 0 && y > canvasHeight * 0.85) {
          const splashProgress =
            (y - canvasHeight * 0.85) / (canvasHeight * 0.15);
          const radius = (5 + splashProgress * 14) * scaleFactor;
          ctx.strokeStyle = `rgba(225, 244, 255, ${(alpha * (1 - splashProgress) * 0.65).toFixed(3)})`;
          ctx.lineWidth = Math.max(1, 1.2 * scaleFactor);
          ctx.beginPath();
          ctx.ellipse(
            x,
            canvasHeight * (0.9 + r1 * 0.07),
            radius,
            radius * 0.34,
            0,
            0,
            Math.PI * 2
          );
          ctx.stroke();
        }
      }
    } else if (ef.type === 'snow') {
      const count = Math.round(45 + intensity * 125);
      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 11 + 1);
        const r2 = seededRand(baseSeed + i * 11 + 2);
        const r3 = seededRand(baseSeed + i * 11 + 3);
        const r4 = seededRand(baseSeed + i * 11 + 4);

        const depth = 0.35 + r3 * 0.65;
        const speedY =
          (50 + depth * 115) * scaleFactor * (0.65 + intensity * 0.5);
        const swayAmp = (16 + r4 * 26) * scaleFactor;
        const swayFreq = 0.75 + r2 * 1.3;
        const ySpan = canvasHeight + 70 * scaleFactor;
        const y = ((r2 * ySpan + localTime * speedY) % ySpan) - 35 * scaleFactor;
        const x =
          (r1 * canvasWidth +
            Math.sin(localTime * swayFreq + r4 * Math.PI * 2) * swayAmp +
            localTime * 16 * scaleFactor +
            canvasWidth * 2) %
          canvasWidth;

        const radius = (3.2 + depth * 6.4) * scaleFactor;
        const alpha = Math.min(0.9, (0.4 + depth * 0.42) * opacity);

        const grad = ctx.createRadialGradient(x, y, 0, x, y, radius * 1.6);
        grad.addColorStop(0, `rgba(255, 255, 255, ${alpha.toFixed(3)})`);
        grad.addColorStop(
          0.42,
          `rgba(240, 248, 255, ${(alpha * 0.75).toFixed(3)})`
        );
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (ef.type === 'smoke') {
      const count = Math.round(12 + intensity * 18);
      const mistGrad = ctx.createLinearGradient(
        0,
        canvasHeight * 0.45,
        0,
        canvasHeight
      );
      mistGrad.addColorStop(0, 'rgba(203, 213, 225, 0)');
      mistGrad.addColorStop(
        1,
        `rgba(226, 232, 240, ${(0.22 * opacity * intensity).toFixed(3)})`
      );
      ctx.fillStyle = mistGrad;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 13 + 1);
        const r2 = seededRand(baseSeed + i * 13 + 2);
        const r3 = seededRand(baseSeed + i * 13 + 3);
        const r4 = seededRand(baseSeed + i * 13 + 4);

        const puffRadius =
          (140 + r3 * 210) * scaleFactor * (0.8 + intensity * 0.35);
        const driftX = (20 + r4 * 32) * scaleFactor;
        const driftY = (-10 - r2 * 16) * scaleFactor;
        const spanW = canvasWidth + puffRadius * 2;
        const spanH = canvasHeight * 0.6 + puffRadius * 2;

        const x =
          ((r1 * spanW +
            localTime * driftX +
            Math.sin(localTime * 0.4 + i) * 28) %
            spanW) -
          puffRadius;
        const y =
          canvasHeight * 0.4 +
          ((((r2 * spanH + localTime * driftY) % spanH) + spanH) % spanH -
            puffRadius);

        const breath = 0.75 + 0.25 * Math.sin(localTime * 0.9 + r4 * 6.28);
        const alpha = Math.min(
          0.38,
          (0.14 + r3 * 0.16) * opacity * (0.35 + intensity * 0.65) * breath
        );

        const grad = ctx.createRadialGradient(x, y, 0, x, y, puffRadius);
        grad.addColorStop(0, `rgba(235, 241, 248, ${alpha.toFixed(3)})`);
        grad.addColorStop(
          0.55,
          `rgba(203, 213, 225, ${(alpha * 0.55).toFixed(3)})`
        );
        grad.addColorStop(1, 'rgba(203, 213, 225, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, puffRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }
}

function drawClipTransition(params: {
  ctx: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  primaryCutout: CanvasImageSource;
  pw: number;
  ph: number;
  primaryClipProgress: number;
  outgoingCutout: CanvasImageSource;
  ow: number;
  oh: number;
  outgoingClipProgress: number;
  transition: ClipTransition;
  transitionProgress: number;
  fitMode: VideoFitMode;
  filters: VideoFilters;
  motionTransform: MotionTransform;
  timedMotion: TimedMotionDelta;
  currentTime: number;
  isExport: boolean;
}) {
  const {
    ctx,
    canvasWidth,
    canvasHeight,
    primaryCutout,
    pw,
    ph,
    primaryClipProgress,
    outgoingCutout,
    ow,
    oh,
    outgoingClipProgress,
    transition,
    transitionProgress,
    fitMode,
    filters,
    motionTransform,
    timedMotion,
    currentTime,
    isExport,
  } = params;

  const p = Math.min(1, Math.max(0, transitionProgress));
  const easedP = easeInOutQuad(p);

  const drawOut = (customFilters?: VideoFilters) =>
    drawTransformedSingleSource({
      ctx,
      canvasWidth,
      canvasHeight,
      source: outgoingCutout,
      naturalW: ow,
      naturalH: oh,
      fitMode,
      filters: customFilters ?? filters,
      motionTransform,
      timedMotion,
      clipProgress: outgoingClipProgress,
      currentTime,
      isExport,
    });

  const drawIn = (customFilters?: VideoFilters) =>
    drawTransformedSingleSource({
      ctx,
      canvasWidth,
      canvasHeight,
      source: primaryCutout,
      naturalW: pw,
      naturalH: ph,
      fitMode,
      filters: customFilters ?? filters,
      motionTransform,
      timedMotion,
      clipProgress: primaryClipProgress,
      currentTime,
      isExport,
    });

  switch (transition.type) {
    case 'crossfade': {
      ctx.save();
      ctx.globalAlpha = 1 - easedP;
      drawOut();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = easedP;
      drawIn();
      ctx.restore();
      break;
    }
    case 'slide-left': {
      ctx.save();
      ctx.translate(-easedP * canvasWidth, 0);
      drawOut();
      ctx.restore();
      ctx.save();
      ctx.translate((1 - easedP) * canvasWidth, 0);
      drawIn();
      ctx.restore();
      break;
    }
    case 'slide-right': {
      ctx.save();
      ctx.translate(easedP * canvasWidth, 0);
      drawOut();
      ctx.restore();
      ctx.save();
      ctx.translate(-(1 - easedP) * canvasWidth, 0);
      drawIn();
      ctx.restore();
      break;
    }
    case 'wipe': {
      drawOut();
      const wipeX = easedP * canvasWidth;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, wipeX, canvasHeight);
      ctx.clip();
      drawIn();
      ctx.restore();
      // Subtle glowing edge along wipe seam
      ctx.save();
      const seamGrad = ctx.createLinearGradient(
        wipeX - 18,
        0,
        wipeX + 4,
        0
      );
      seamGrad.addColorStop(0, 'rgba(255,255,255,0)');
      seamGrad.addColorStop(0.85, 'rgba(255,255,255,0.45)');
      seamGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = seamGrad;
      ctx.fillRect(wipeX - 18, 0, 22, canvasHeight);
      ctx.restore();
      break;
    }
    case 'zoom': {
      const outScale = 1 + 0.45 * easedP;
      ctx.save();
      ctx.globalAlpha = 1 - easedP;
      ctx.translate(canvasWidth / 2, canvasHeight / 2);
      ctx.scale(outScale, outScale);
      ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
      drawOut();
      ctx.restore();

      const inScale = 0.72 + 0.28 * easedP;
      ctx.save();
      ctx.globalAlpha = easedP;
      ctx.translate(canvasWidth / 2, canvasHeight / 2);
      ctx.scale(inScale, inScale);
      ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
      drawIn();
      ctx.restore();
      break;
    }
    case 'glitch': {
      if (p < 0.5) drawOut();
      else drawIn();
      const peak = 1 - Math.abs(p - 0.5) * 2;
      const snap = drawSnapshotOfCanvas(
        ctx,
        canvasWidth,
        canvasHeight,
        'transition-glitch-snap'
      );
      if (snap) {
        drawGlitchOverlayPass(
          ctx,
          snap,
          canvasWidth,
          canvasHeight,
          currentTime,
          0.35 + peak * 0.65,
          0.95
        );
      }
      break;
    }
    case 'flash-white':
    case 'flash-black': {
      if (p < 0.5) drawOut();
      else drawIn();
      const flashAlpha = Math.pow(1 - Math.abs(p - 0.5) * 2, 0.7);
      ctx.save();
      ctx.fillStyle =
        transition.type === 'flash-white'
          ? `rgba(255, 255, 255, ${flashAlpha.toFixed(3)})`
          : `rgba(0, 0, 0, ${flashAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.restore();
      break;
    }
    case 'spin': {
      if (p < 0.5) {
        const half = p * 2;
        const rot = half * 0.65;
        const sc = 1 + half * 0.45;
        ctx.save();
        ctx.globalAlpha = 1 - half * 0.85;
        ctx.translate(canvasWidth / 2, canvasHeight / 2);
        ctx.rotate(rot);
        ctx.scale(sc, sc);
        ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
        drawOut();
        ctx.restore();
      } else {
        const half = (p - 0.5) * 2;
        const rot = -(1 - half) * 0.65;
        const sc = 1.45 - half * 0.45;
        ctx.save();
        ctx.globalAlpha = 0.15 + half * 0.85;
        ctx.translate(canvasWidth / 2, canvasHeight / 2);
        ctx.rotate(rot);
        ctx.scale(sc, sc);
        ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
        drawIn();
        ctx.restore();
      }
      break;
    }
    case 'blur': {
      const peak = 1 - Math.abs(p - 0.5) * 2;
      const blurPx = Number((peak * 18).toFixed(1));
      ctx.save();
      ctx.globalAlpha = 1 - easedP;
      drawOut({...filters, blur: Math.max(filters.blur, blurPx)});
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = easedP;
      drawIn({...filters, blur: Math.max(filters.blur, blurPx)});
      ctx.restore();
      break;
    }
    case 'cube-3d': {
      const splitX = (1 - easedP) * canvasWidth;
      const outFace = getScratchCanvas('cube-out');
      const inFace = getScratchCanvas('cube-in');
      if (outFace.width !== canvasWidth || outFace.height !== canvasHeight) {
        outFace.width = canvasWidth;
        outFace.height = canvasHeight;
      }
      if (inFace.width !== canvasWidth || inFace.height !== canvasHeight) {
        inFace.width = canvasWidth;
        inFace.height = canvasHeight;
      }
      const octx = outFace.getContext('2d');
      const ictx = inFace.getContext('2d');
      if (octx && ictx) {
        octx.clearRect(0, 0, canvasWidth, canvasHeight);
        ictx.clearRect(0, 0, canvasWidth, canvasHeight);
        drawTransformedSingleSource({
          ctx: octx,
          canvasWidth,
          canvasHeight,
          source: outgoingCutout,
          naturalW: ow,
          naturalH: oh,
          fitMode,
          filters,
          motionTransform,
          timedMotion,
          clipProgress: outgoingClipProgress,
          currentTime,
          isExport,
        });
        drawTransformedSingleSource({
          ctx: ictx,
          canvasWidth,
          canvasHeight,
          source: primaryCutout,
          naturalW: pw,
          naturalH: ph,
          fitMode,
          filters,
          motionTransform,
          timedMotion,
          clipProgress: primaryClipProgress,
          currentTime,
          isExport,
        });

        // Draw outgoing squished face on left [0..splitX]
        if (splitX > 1) {
          ctx.save();
          ctx.drawImage(outFace, 0, 0, splitX, canvasHeight);
          ctx.fillStyle = `rgba(0, 0, 0, ${(easedP * 0.52).toFixed(3)})`;
          ctx.fillRect(0, 0, splitX, canvasHeight);
          ctx.restore();
        }
        // Draw incoming expanding face on right [splitX..canvasWidth]
        const inW = canvasWidth - splitX;
        if (inW > 1) {
          ctx.save();
          ctx.drawImage(inFace, splitX, 0, inW, canvasHeight);
          ctx.fillStyle = `rgba(0, 0, 0, ${((1 - easedP) * 0.52).toFixed(3)})`;
          ctx.fillRect(splitX, 0, inW, canvasHeight);
          ctx.restore();
        }
        // Crisp vertical 3D cube seam highlight
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.fillRect(splitX - 1, 0, 2, canvasHeight);
        ctx.restore();
      } else {
        drawIn();
      }
      break;
    }
    default:
      drawIn();
  }
}

interface AnimationEval {
  alphaMult: number;
  scaleMult: number;
  offsetX: number;
  offsetY: number;
  revealFrac: number; // used by typewriter
  extrude3D: boolean;
}

function evaluateOverlayAnimation(
  anim: OverlayAnimationPreset | undefined,
  currentTime: number,
  startTime: number,
  endTime: number,
  scaleFactor: number
): AnimationEval {
  const result: AnimationEval = {
    alphaMult: 1,
    scaleMult: 1,
    offsetX: 0,
    offsetY: 0,
    revealFrac: 1,
    extrude3D: anim === '3d-extrude',
  };
  if (!anim || anim === 'none') return result;

  const dur = Math.max(0.25, endTime - startTime);
  const elapsed = Math.max(0, currentTime - startTime);
  const remaining = Math.max(0, endTime - currentTime);
  const inDur = Math.min(0.6, dur * 0.38);
  const outDur = Math.min(0.45, dur * 0.25);

  const pIn = inDur > 0 ? Math.min(1, elapsed / inDur) : 1;
  const pOut = outDur > 0 ? Math.min(1, remaining / outDur) : 1;

  if (anim === 'fade') {
    result.alphaMult = Math.min(pIn, pOut);
  } else if (anim === 'pop') {
    // Elastic overshoot pop
    const popScale =
      pIn < 0.7
        ? 0.25 + (pIn / 0.7) * 0.9
        : 1.15 - ((pIn - 0.7) / 0.3) * 0.15;
    result.scaleMult = popScale * (0.75 + 0.25 * pOut);
    result.alphaMult = Math.min(1, pIn * 2.5) * pOut;
  } else if (anim === 'slide-up') {
    const eIn = 1 - Math.pow(1 - pIn, 3);
    result.offsetY = (1 - eIn) * 56 * scaleFactor - (1 - pOut) * 28 * scaleFactor;
    result.alphaMult = Math.min(pIn * 1.4, pOut);
  } else if (anim === 'bounce') {
    const bounceIn =
      pIn < 1
        ? 1 - Math.abs(Math.cos(pIn * Math.PI * 2.2)) * (1 - pIn)
        : 1;
    result.offsetY =
      (1 - bounceIn) * -46 * scaleFactor +
      Math.sin(elapsed * 4.5) * 5 * scaleFactor;
    result.scaleMult = 0.85 + bounceIn * 0.15;
    result.alphaMult = Math.min(1, pIn * 2) * pOut;
  } else if (anim === 'typewriter') {
    const typeWindow = Math.min(dur * 0.75, Math.max(0.8, dur * 0.55));
    result.revealFrac = Math.max(0.08, Math.min(1, elapsed / typeWindow));
    result.alphaMult = pOut;
  } else if (anim === '3d-extrude') {
    const eIn = easeInOutQuad(pIn);
    result.scaleMult = 0.85 + 0.15 * eIn;
    result.alphaMult = Math.min(pIn * 1.5, pOut);
  }

  return result;
}

export function renderEditorFrame(params: {
  ctx: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  primarySource: MediaSourceElement | null;
  primaryClipProgress?: number;
  outgoingSource?: MediaSourceElement | null;
  outgoingClipProgress?: number;
  transition?: ClipTransition | null;
  transitionProgress?: number;
  fitMode: VideoFitMode;
  filters: VideoFilters;
  motionTransform: MotionTransform;
  mainBgRemoval: BackgroundRemovalConfig;
  mainBgReplacementEl?: MediaSourceElement | null;
  precomputedMainMask?: HTMLCanvasElement | null;
  effectItems?: TimelineEffectItem[];
  beatTimes?: number[];
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
    primarySource,
    primaryClipProgress = 0,
    outgoingSource = null,
    outgoingClipProgress = 1,
    transition = null,
    transitionProgress = 0,
    fitMode,
    filters,
    motionTransform,
    mainBgRemoval,
    mainBgReplacementEl = null,
    precomputedMainMask,
    effectItems = [],
    beatTimes = [],
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

  const mainReady = isMediaReady(primarySource);
  const outgoingReady = isMediaReady(outgoingSource);

  // 1. Background Replacement Layer (when Main Video BG removal is enabled)
  if (mainReady && primarySource && mainBgRemoval.mode !== 'none') {
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
      const {w: vw, h: vh} = getMediaDims(primarySource);
      drawCover(ctx, primarySource, vw, vh, canvasWidth, canvasHeight);
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

  // 2. Main Video / Freeze Frame Layer (with Precision Zoom, Heartbeat Pulse, Motion, Filters, BG Removal & Pro Transitions)
  const timedMotion = computeTimedMotionDelta(
    effectItems,
    currentTime,
    canvasWidth,
    canvasHeight,
    beatTimes
  );

  if (mainReady && primarySource) {
    const primaryCutout = resolveCutoutSource({
      key: 'main',
      source: primarySource,
      bgRemoval: mainBgRemoval,
      precomputedMask: precomputedMainMask,
      onMaskUpdated,
      maxProcessWidth: isExport ? 1080 : 680,
    });
    const {w: pw, h: ph} = getMediaDims(primarySource);

    if (
      outgoingReady &&
      outgoingSource &&
      transition &&
      transition.type !== 'none'
    ) {
      const {w: ow, h: oh} = getMediaDims(outgoingSource);
      const outgoingCutout =
        mainBgRemoval.mode !== 'none'
          ? resolveCutoutSource({
              key: 'main-outgoing',
              source: outgoingSource,
              bgRemoval: mainBgRemoval,
              onMaskUpdated,
              maxProcessWidth: isExport ? 1080 : 680,
            })
          : outgoingSource;

      drawClipTransition({
        ctx,
        canvasWidth,
        canvasHeight,
        primaryCutout,
        pw,
        ph,
        primaryClipProgress,
        outgoingCutout,
        ow,
        oh,
        outgoingClipProgress,
        transition,
        transitionProgress,
        fitMode,
        filters,
        motionTransform,
        timedMotion,
        currentTime,
        isExport,
      });
    } else {
      drawTransformedSingleSource({
        ctx,
        canvasWidth,
        canvasHeight,
        source: primaryCutout,
        naturalW: pw,
        naturalH: ph,
        fitMode,
        filters,
        motionTransform,
        timedMotion,
        clipProgress: primaryClipProgress,
        currentTime,
        isExport,
      });
    }
  }

  // 2.2 Non-sticker, non-watermark PIP Overlays
  const overlayBounds: OverlayLayerBounds[] = [];
  const scaleFactor = Math.min(canvasWidth, canvasHeight) / 720;

  const drawSingleOverlay = (
    overlay: OverlayLayerItem,
    applyImageOnlyVisualFx: boolean
  ) => {
    const mediaEl =
      overlay.kind === 'sticker' && overlay.stickerKind
        ? getStickerImageElement(overlay.stickerKind, onMaskUpdated)
        : overlayElementsMap.get(overlay.id);
    if (!isMediaReady(mediaEl) || !mediaEl) {
      return;
    }

    const anim = evaluateOverlayAnimation(
      overlay.animation,
      currentTime,
      overlay.startTime,
      overlay.endTime,
      scaleFactor
    );

    const swayX = overlay.followMotion ? timedMotion.shakeOffsetX * 0.9 : 0;
    const swayY = overlay.followMotion ? timedMotion.shakeOffsetY * 0.9 : 0;

    const drawW = Math.max(24, overlay.width * canvasWidth);
    const safeRatio = overlay.aspectRatio > 0 ? overlay.aspectRatio : 1;
    const drawH = Math.max(24, drawW / safeRatio);
    const centerX = overlay.x * canvasWidth + anim.offsetX + swayX;
    const centerY = overlay.y * canvasHeight + anim.offsetY + swayY;
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
    ctx.globalAlpha =
      Math.max(0, Math.min(1, overlay.opacity)) * anim.alphaMult;

    if (anim.extrude3D) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 10 * scaleFactor;
      ctx.shadowOffsetX = 6 * scaleFactor;
      ctx.shadowOffsetY = 8 * scaleFactor;
    }

    if (overlay.animation === 'typewriter' && anim.revealFrac < 1) {
      ctx.beginPath();
      ctx.rect(left, top, drawW * anim.revealFrac, drawH);
      ctx.clip();
    }

    if (applyImageOnlyVisualFx) {
      const ovDur = Math.max(0.1, overlay.endTime - overlay.startTime);
      const ovProg = Math.max(
        0,
        Math.min(1, (currentTime - overlay.startTime) / ovDur)
      );
      let animZoom = 1;
      if (motionTransform.preset === 'zoom-in') {
        animZoom = 1 + 0.28 * ovProg;
      } else if (motionTransform.preset === 'zoom-out') {
        animZoom = 1.28 - 0.28 * ovProg;
      }
      const totalZoom =
        (motionTransform.zoom / 100) *
        animZoom *
        timedMotion.zoomMultiplier *
        anim.scaleMult;
      const panPxX =
        (motionTransform.panX / 100) * (canvasWidth * 0.5) +
        timedMotion.offsetX;
      const panPxY =
        (motionTransform.panY / 100) * (canvasHeight * 0.5) +
        timedMotion.offsetY;
      const rad =
        ((motionTransform.rotate + timedMotion.angleDeg) * Math.PI) / 180;
      const sx = totalZoom * (motionTransform.flipH ? -1 : 1);
      const sy = totalZoom * (motionTransform.flipV ? -1 : 1);
      ctx.translate(centerX + panPxX, centerY + panPxY);
      if (rad !== 0) ctx.rotate(rad);
      ctx.scale(sx, sy);
      ctx.filter = buildCanvasFilterString(filters);
      ctx.drawImage(cutout, -drawW / 2, -drawH / 2, drawW, drawH);
    } else {
      ctx.translate(centerX, centerY);
      ctx.scale(anim.scaleMult, anim.scaleMult);
      ctx.drawImage(cutout, -drawW / 2, -drawH / 2, drawW, drawH);
    }
    ctx.restore();

    const handleSize = Math.max(12, Math.round(14 * scaleFactor));
    if (showSelectionBox && overlay.id === selectedOverlayId) {
      ctx.save();
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = Math.max(2, 2 * scaleFactor);
      ctx.setLineDash([6 * scaleFactor, 4 * scaleFactor]);
      ctx.strokeRect(left, top, drawW, drawH);
      ctx.setLineDash([]);

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
  };

  let hasActivePipOverlay = false;
  for (const overlay of overlayLayers) {
    if (overlay.kind === 'sticker' || overlay.assetId === 'jit-watermark') {
      continue;
    }
    if (currentTime < overlay.startTime || currentTime > overlay.endTime) {
      continue;
    }
    hasActivePipOverlay = true;
    drawSingleOverlay(overlay, !mainReady);
  }

  // 2.4 Global Color Grading, Vignette, Face Glow & Timed Filter/Glitch Effects
  if (mainReady || hasActivePipOverlay) {
    drawColorGradingAndVignette(ctx, canvasWidth, canvasHeight, filters);
    if (filters.faceGlow > 0) {
      drawFaceGlowBeautyPass(ctx, canvasWidth, canvasHeight, filters.faceGlow);
    }
    if (effectItems.length > 0) {
      drawTimedFilterAndGlitchEffects(
        ctx,
        canvasWidth,
        canvasHeight,
        effectItems,
        currentTime
      );
      drawStudioAndCinemaVfx(
        ctx,
        canvasWidth,
        canvasHeight,
        effectItems,
        currentTime,
        beatTimes,
        isExport
      );
    }
  } else if (effectItems.length > 0) {
    drawTimedFilterAndGlitchEffects(
      ctx,
      canvasWidth,
      canvasHeight,
      effectItems,
      currentTime
    );
    drawStudioAndCinemaVfx(
      ctx,
      canvasWidth,
      canvasHeight,
      effectItems,
      currentTime,
      beatTimes,
      isExport
    );
  }

  // 2.6 Weather & Atmospheric Particle Effects Track
  if (effectItems.length > 0) {
    drawWeatherEffects(ctx, canvasWidth, canvasHeight, effectItems, currentTime);
  }

  // 3. Stickers & Official JIT Watermark Layers (crisp above VFX & weather)
  for (const overlay of overlayLayers) {
    if (overlay.kind !== 'sticker' && overlay.assetId !== 'jit-watermark') {
      continue;
    }
    if (currentTime < overlay.startTime || currentTime > overlay.endTime) {
      continue;
    }
    drawSingleOverlay(overlay, false);
  }

  // 4. Animated Text Overlays
  const textBounds: TextOverlayBounds[] = [];

  for (const overlay of textOverlays) {
    if (currentTime < overlay.startTime || currentTime > overlay.endTime) {
      continue;
    }
    const content = overlay.text.trim();
    if (!content) continue;

    const anim = evaluateOverlayAnimation(
      overlay.animation,
      currentTime,
      overlay.startTime,
      overlay.endTime,
      scaleFactor
    );

    const displayRaw =
      overlay.animation === 'typewriter' && anim.revealFrac < 1
        ? overlay.text.slice(
            0,
            Math.max(1, Math.ceil(overlay.text.length * anim.revealFrac))
          )
        : overlay.text;

    const scaledFontSize = Math.max(
      12,
      Math.round(overlay.fontSize * scaleFactor)
    );
    const lines = displayRaw.split('\n');
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

    const swayX = overlay.followMotion ? timedMotion.shakeOffsetX * 0.9 : 0;
    const swayY = overlay.followMotion ? timedMotion.shakeOffsetY * 0.9 : 0;

    const centerX = overlay.x * canvasWidth + anim.offsetX + swayX;
    const centerY = overlay.y * canvasHeight + anim.offsetY + swayY;
    const boxLeft = centerX - boxWidth / 2;
    const boxTop = centerY - boxHeight / 2;

    ctx.save();
    ctx.globalAlpha = anim.alphaMult;
    ctx.translate(centerX, centerY);
    ctx.scale(anim.scaleMult, anim.scaleMult);
    ctx.translate(-centerX, -centerY);

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

    const startY = centerY - ((lines.length - 1) * lineHeight) / 2;

    if (anim.extrude3D) {
      const depthSteps = 5;
      for (let d = depthSteps; d >= 1; d--) {
        ctx.fillStyle =
          d === depthSteps ? 'rgba(0,0,0,0.6)' : 'rgba(30, 58, 138, 0.85)';
        lines.forEach((line, index) => {
          ctx.fillText(
            line,
            centerX + d * 1.6 * scaleFactor,
            startY + index * lineHeight + d * 1.6 * scaleFactor
          );
        });
      }
    }

    ctx.fillStyle = overlay.color;
    if (!overlay.hasBackground && !anim.extrude3D) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
      ctx.shadowBlur = Math.max(4, scaledFontSize * 0.16);
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }

    lines.forEach((line, index) => {
      ctx.fillText(line, centerX, startY + index * lineHeight);
    });

    ctx.restore();

    if (showSelectionBox && overlay.id === selectedTextId) {
      ctx.save();
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = Math.max(2, 2 * scaleFactor);
      ctx.setLineDash([6 * scaleFactor, 4 * scaleFactor]);
      ctx.strokeRect(boxLeft - 4, boxTop - 4, boxWidth + 8, boxHeight + 8);
      ctx.setLineDash([]);
      ctx.restore();
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
