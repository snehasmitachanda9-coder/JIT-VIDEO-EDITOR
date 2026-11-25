import type {
  AspectRatioPreset,
  BackgroundRemovalConfig,
  ClipTransition,
  FilterPreset,
  MotionTransform,
  OverlayLayerItem,
  TextOverlayItem,
  TimelineEffectItem,
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
    return {w: source.naturalWidth || fallbackW, h: source.naturalHeight || fallbackH};
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
          (src[top + c] + src[bot + c] + src[left + c] + src[right + c]) * 0.25;
        dst[idx + c] = src[idx + c] + (src[idx + c] - avg) * strength;
      }
      dst[idx + 3] = src[idx + 3];
    }
  }

  ctx.putImageData(new ImageData(dst, w, h), 0, 0);
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

  // Apply sharpen pass if enabled
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

  // Compute combined static + animated motion transform
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
    animZoom = 1.06; // Slight zoom to prevent black border flicker during shake
  }

  const totalZoom = (motionTransform.zoom / 100) * animZoom;
  const panPxX = (motionTransform.panX / 100) * (canvasWidth * 0.5) + shakeOffsetX;
  const panPxY = (motionTransform.panY / 100) * (canvasHeight * 0.5) + shakeOffsetY;
  const rad = ((motionTransform.rotate + shakeAngleDeg) * Math.PI) / 180;
  const scaleX = totalZoom * (motionTransform.flipH ? -1 : 1);
  const scaleY = totalZoom * (motionTransform.flipV ? -1 : 1);

  ctx.save();
  ctx.translate(canvasWidth / 2 + panPxX, canvasHeight / 2 + panPxY);
  if (rad !== 0) ctx.rotate(rad);
  ctx.scale(scaleX, scaleY);
  ctx.filter = buildCanvasFilterString(filters);
  ctx.drawImage(finalSource, -drawW / 2, -drawH / 2, drawW, drawH);

  // Glitch effect: RGB offset slices synced deterministically to currentTime
  if (filters.preset === 'glitch') {
    const pulse = Math.abs(Math.sin(currentTime * 14.7));
    const offset = (4 + pulse * 14) * (canvasWidth / 1280);
    ctx.globalAlpha = 0.32;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(finalSource, -drawW / 2 + offset, -drawH / 2, drawW, drawH);
    ctx.drawImage(finalSource, -drawW / 2 - offset, -drawH / 2, drawW, drawH);

    // Subtle horizontal scanline glitch bar
    const barSeed = Math.sin(currentTime * 23.1);
    if (barSeed > 0.25) {
      const sliceY = -drawH / 2 + ((barSeed * 0.7 + 0.15) * drawH);
      const sliceH = Math.max(8, drawH * 0.06);
      ctx.globalAlpha = 0.45;
      ctx.drawImage(
        finalSource,
        0,
        ((barSeed * 0.7 + 0.15) * getCanvasSourceDims(finalSource, naturalW, naturalH).h),
        getCanvasSourceDims(finalSource, naturalW, naturalH).w,
        Math.max(8, getCanvasSourceDims(finalSource, naturalW, naturalH).h * 0.06),
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
  // Preset color grading washes
  if (filters.preset === 'teal-orange') {
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
    grad.addColorStop(0, 'rgba(13, 148, 136, 0.22)');
    grad.addColorStop(1, 'rgba(249, 115, 22, 0.22)');
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  } else if (filters.preset === 'cyberpunk') {
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
    grad.addColorStop(0, 'rgba(236, 72, 153, 0.24)');
    grad.addColorStop(1, 'rgba(6, 182, 212, 0.24)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  } else if (filters.preset === 'warm-sunset') {
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    grad.addColorStop(0, 'rgba(251, 146, 60, 0.2)');
    grad.addColorStop(1, 'rgba(180, 83, 9, 0.16)');
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  }

  // Vignette overlay
  if (filters.vignette > 0) {
    ctx.save();
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const outerR = Math.hypot(cx, cy);
    const innerR = outerR * (0.48 - (filters.vignette / 100) * 0.22);
    const strength = Math.min(0.92, (filters.vignette / 100) * 0.88);
    const radGrad = ctx.createRadialGradient(cx, cy, Math.max(0, innerR), cx, cy, outerR);
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

  // Beauty soften via soft-light + luminous screen radiance
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 0.24 + amount * 0.42;
  ctx.drawImage(glowCanvas, 0, 0, canvasWidth, canvasHeight);

  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = amount * 0.22;
  ctx.drawImage(glowCanvas, 0, 0, canvasWidth, canvasHeight);

  // Subtle warm center portrait glow
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
  return (h >>> 0) || 1;
}

function seededRand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
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
    if (currentTime < ef.startTime || currentTime > ef.endTime) {
      continue;
    }

    const intensity = Math.max(0.2, Math.min(1, ef.intensity));
    const opacity = Math.max(0.05, Math.min(1, ef.opacity));
    const localTime = Math.max(0, currentTime - ef.startTime);
    const baseSeed = hashSeed(ef.id);

    ctx.save();

    if (ef.type === 'rain') {
      const count = Math.round(55 + intensity * 165);
      ctx.lineCap = 'round';

      // Slight cool overcast atmosphere wash
      ctx.fillStyle = `rgba(148, 182, 224, ${(0.06 * opacity * intensity).toFixed(3)})`;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 7 + 1);
        const r2 = seededRand(baseSeed + i * 7 + 2);
        const r3 = seededRand(baseSeed + i * 7 + 3);
        const r4 = seededRand(baseSeed + i * 7 + 4);

        const speedY = (820 + r3 * 680) * scaleFactor * (0.75 + intensity * 0.5);
        const slant = -0.22; // Wind tilt
        const ySpan = canvasHeight + 120 * scaleFactor;
        const y = ((r2 * ySpan + localTime * speedY) % ySpan) - 60 * scaleFactor;
        const x =
          ((r1 * canvasWidth + y * slant + canvasWidth * 2) % canvasWidth);

        const streakLen = (26 + r4 * 36) * scaleFactor * (0.7 + intensity * 0.45);
        const alpha = (0.28 + r3 * 0.48) * opacity;

        ctx.strokeStyle = `rgba(210, 232, 255, ${alpha.toFixed(3)})`;
        ctx.lineWidth = (1.1 + r4 * 1.1) * scaleFactor;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + streakLen * slant, y + streakLen);
        ctx.stroke();

        // Occasional bottom splash ripple
        if (i % 5 === 0 && y > canvasHeight * 0.86) {
          const splashProgress = (y - canvasHeight * 0.86) / (canvasHeight * 0.14);
          const radius = (4 + splashProgress * 12) * scaleFactor;
          ctx.strokeStyle = `rgba(215, 236, 255, ${(alpha * (1 - splashProgress) * 0.65).toFixed(3)})`;
          ctx.lineWidth = Math.max(1, 1.1 * scaleFactor);
          ctx.beginPath();
          ctx.ellipse(x, canvasHeight * (0.9 + r1 * 0.08), radius, radius * 0.35, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    } else if (ef.type === 'snow') {
      const count = Math.round(40 + intensity * 125);
      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 11 + 1);
        const r2 = seededRand(baseSeed + i * 11 + 2);
        const r3 = seededRand(baseSeed + i * 11 + 3);
        const r4 = seededRand(baseSeed + i * 11 + 4);

        const depth = 0.4 + r3 * 0.6;
        const speedY = (55 + depth * 125) * scaleFactor * (0.65 + intensity * 0.55);
        const swayAmp = (14 + r4 * 26) * scaleFactor;
        const swayFreq = 0.8 + r2 * 1.4;
        const ySpan = canvasHeight + 60 * scaleFactor;
        const y = ((r2 * ySpan + localTime * speedY) % ySpan) - 30 * scaleFactor;
        const x =
          (r1 * canvasWidth +
            Math.sin(localTime * swayFreq + r4 * Math.PI * 2) * swayAmp +
            localTime * 18 * scaleFactor +
            canvasWidth * 2) %
          canvasWidth;

        const radius = (2.2 + depth * 4.8) * scaleFactor;
        const alpha = (0.35 + depth * 0.55) * opacity;

        const grad = ctx.createRadialGradient(x, y, 0, x, y, radius * 1.6);
        grad.addColorStop(0, `rgba(255, 255, 255, ${alpha.toFixed(3)})`);
        grad.addColorStop(0.55, `rgba(235, 245, 255, ${(alpha * 0.55).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (ef.type === 'smoke') {
      const count = Math.round(12 + intensity * 18);
      // Soft atmospheric haze layer
      ctx.fillStyle = `rgba(205, 214, 224, ${(0.08 * opacity * intensity).toFixed(3)})`;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 13 + 1);
        const r2 = seededRand(baseSeed + i * 13 + 2);
        const r3 = seededRand(baseSeed + i * 13 + 3);
        const r4 = seededRand(baseSeed + i * 13 + 4);

        const puffRadius = (130 + r3 * 210) * scaleFactor * (0.8 + intensity * 0.35);
        const driftX = (22 + r4 * 34) * scaleFactor;
        const driftY = (-10 - r2 * 18) * scaleFactor;
        const spanW = canvasWidth + puffRadius * 2;
        const spanH = canvasHeight + puffRadius * 2;

        const x =
          ((r1 * spanW + localTime * driftX + Math.sin(localTime * 0.4 + i) * 28) %
            spanW) -
          puffRadius;
        const y =
          (((r2 * spanH + localTime * driftY) % spanH) + spanH) % spanH -
          puffRadius;

        const breath = 0.72 + 0.28 * Math.sin(localTime * 0.9 + r4 * 6.28);
        const alpha = (0.12 + r3 * 0.16) * opacity * intensity * breath;

        const grad = ctx.createRadialGradient(x, y, 0, x, y, puffRadius);
        grad.addColorStop(0, `rgba(226, 232, 240, ${alpha.toFixed(3)})`);
        grad.addColorStop(0.5, `rgba(203, 213, 225, ${(alpha * 0.55).toFixed(3)})`);
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

  // 2. Main Video / Freeze Frame Layer (with Motion, Filters, BG Removal & Clip Transitions)
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
      const p = Math.min(1, Math.max(0, transitionProgress));
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

      if (transition.type === 'crossfade') {
        ctx.save();
        ctx.globalAlpha = 1 - p;
        drawTransformedSingleSource({
          ctx,
          canvasWidth,
          canvasHeight,
          source: outgoingCutout,
          naturalW: ow,
          naturalH: oh,
          fitMode,
          filters,
          motionTransform,
          clipProgress: outgoingClipProgress,
          currentTime,
          isExport,
        });
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = p;
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
          clipProgress: primaryClipProgress,
          currentTime,
          isExport,
        });
        ctx.restore();
      } else if (transition.type === 'slide-left') {
        ctx.save();
        ctx.translate(-p * canvasWidth, 0);
        drawTransformedSingleSource({
          ctx,
          canvasWidth,
          canvasHeight,
          source: outgoingCutout,
          naturalW: ow,
          naturalH: oh,
          fitMode,
          filters,
          motionTransform,
          clipProgress: outgoingClipProgress,
          currentTime,
          isExport,
        });
        ctx.restore();

        ctx.save();
        ctx.translate((1 - p) * canvasWidth, 0);
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
          clipProgress: primaryClipProgress,
          currentTime,
          isExport,
        });
        ctx.restore();
      } else if (transition.type === 'zoom') {
        const outScale = 1 + 0.35 * p;
        ctx.save();
        ctx.globalAlpha = 1 - p;
        ctx.translate(canvasWidth / 2, canvasHeight / 2);
        ctx.scale(outScale, outScale);
        ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
        drawTransformedSingleSource({
          ctx,
          canvasWidth,
          canvasHeight,
          source: outgoingCutout,
          naturalW: ow,
          naturalH: oh,
          fitMode,
          filters,
          motionTransform,
          clipProgress: outgoingClipProgress,
          currentTime,
          isExport,
        });
        ctx.restore();

        const inScale = 0.78 + 0.22 * p;
        ctx.save();
        ctx.globalAlpha = p;
        ctx.translate(canvasWidth / 2, canvasHeight / 2);
        ctx.scale(inScale, inScale);
        ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
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
          clipProgress: primaryClipProgress,
          currentTime,
          isExport,
        });
        ctx.restore();
      }
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
        clipProgress: primaryClipProgress,
        currentTime,
        isExport,
      });
    }

    drawColorGradingAndVignette(ctx, canvasWidth, canvasHeight, filters);
    if (filters.faceGlow > 0) {
      drawFaceGlowBeautyPass(ctx, canvasWidth, canvasHeight, filters.faceGlow);
    }
  }

  // 2.5 Weather & Atmospheric Particle Effects Track
  if (effectItems.length > 0) {
    drawWeatherEffects(ctx, canvasWidth, canvasHeight, effectItems, currentTime);
  }

  // 3. Overlay / PIP & Stickers Layers
  const overlayBounds: OverlayLayerBounds[] = [];
  const scaleFactor = Math.min(canvasWidth, canvasHeight) / 720;

  for (const overlay of overlayLayers) {
    if (currentTime < overlay.startTime || currentTime > overlay.endTime) {
      continue;
    }
    const mediaEl =
      overlay.kind === 'sticker' && overlay.stickerKind
        ? getStickerImageElement(overlay.stickerKind, onMaskUpdated)
        : overlayElementsMap.get(overlay.id);
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
