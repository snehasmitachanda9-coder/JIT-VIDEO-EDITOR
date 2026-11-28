import type {Effect34Type, TimelineEffectItem} from '../types/editor';

const fxScratchPool = new Map<string, HTMLCanvasElement>();

function getFxScratch(key: string): HTMLCanvasElement {
  let c = fxScratchPool.get(key);
  if (!c) {
    c = document.createElement('canvas');
    fxScratchPool.set(key, c);
  }
  return c;
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

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

export type SnapshotFn = (key?: string) => HTMLCanvasElement | null;

// Cached radial fisheye lookup table (capped at 6 entries)
const fisheyeLutCache = new Map<string, Int32Array>();

function getFisheyeLut(w: number, h: number, k: number): Int32Array {
  const key = `${w}x${h}_${Math.round(k * 100)}`;
  const cached = fisheyeLutCache.get(key);
  if (cached) return cached;

  if (fisheyeLutCache.size >= 6) {
    const firstKey = fisheyeLutCache.keys().next().value;
    if (firstKey !== undefined) fisheyeLutCache.delete(firstKey);
  }

  const lut = new Int32Array(w * h);
  const cx = w * 0.5;
  const cy = h * 0.5;
  const maxR = Math.hypot(cx, cy) || 1;
  // Slightly zoom out at border and curve outward with barrel distortion
  const strength = 0.25 + k * 0.95;

  for (let y = 0; y < h; y++) {
    const dy = (y - cy) / maxR;
    const dy2 = dy * dy;
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / maxR;
      const r2 = dx * dx + dy2;
      const r = Math.sqrt(r2);
      // Barrel mapping: center bulges, edges curve inward smoothly
      const theta = r > 0 ? Math.atan(r * strength * 1.45) / Math.atan(strength * 1.45) : 0;
      const factor = r > 1e-5 ? (theta / r) * (1 - 0.08 * k) : 1 - 0.08 * k;
      const sx = Math.min(w - 1, Math.max(0, (cx + (x - cx) * factor) | 0));
      const sy = Math.min(h - 1, Math.max(0, (cy + (y - cy) * factor) | 0));
      lut[rowOff + x] = sy * w + sx;
    }
  }

  fisheyeLutCache.set(key, lut);
  return lut;
}

function drawFisheyePass(
  ctx: CanvasRenderingContext2D,
  snapshot: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  intensity: number,
  opacity: number,
  isExport: boolean
) {
  const maxDim = isExport ? 1280 : 860;
  const scale = Math.min(1, maxDim / Math.max(canvasWidth, canvasHeight));
  const w = Math.max(32, Math.round(canvasWidth * scale));
  const h = Math.max(32, Math.round(canvasHeight * scale));

  const work = getFxScratch('fx34-fisheye-src');
  const out = getFxScratch('fx34-fisheye-dst');
  if (work.width !== w || work.height !== h) {
    work.width = w;
    work.height = h;
    out.width = w;
    out.height = h;
  }

  const wctx = work.getContext('2d', {willReadFrequently: true});
  const octx = out.getContext('2d');
  if (!wctx || !octx) return;

  wctx.imageSmoothingEnabled = true;
  wctx.imageSmoothingQuality = 'high';
  wctx.clearRect(0, 0, w, h);
  wctx.drawImage(snapshot, 0, 0, w, h);

  try {
    const srcImg = wctx.getImageData(0, 0, w, h);
    const dstImg = octx.createImageData(w, h);
    const src32 = new Uint32Array(srcImg.data.buffer);
    const dst32 = new Uint32Array(dstImg.data.buffer);
    const lut = getFisheyeLut(w, h, intensity);
    const total = w * h;
    for (let i = 0; i < total; i++) {
      dst32[i] = src32[lut[i]];
    }
    octx.putImageData(dstImg, 0, 0);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(out, 0, 0, canvasWidth, canvasHeight);

    // Subtle spherical glass rim vignette
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const rad = Math.hypot(cx, cy);
    const g = ctx.createRadialGradient(cx, cy, rad * 0.56, cx, cy, rad);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(4,8,16,${(0.32 * intensity * opacity).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  } catch {
    // ignore cross-origin fallback
  }
}

function drawGhostPass(
  ctx: CanvasRenderingContext2D,
  snapshot: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  localTime: number,
  intensity: number,
  opacity: number,
  effectId: string
) {
  const maxDim = 640;
  const scale = Math.min(1, maxDim / Math.max(canvasWidth, canvasHeight));
  const w = Math.max(32, Math.round(canvasWidth * scale));
  const h = Math.max(32, Math.round(canvasHeight * scale));

  // Keep a smooth trailing persistence buffer per effect
  const trail = getFxScratch(`fx34-ghost-trail-${effectId}`);
  if (trail.width !== w || trail.height !== h) {
    trail.width = w;
    trail.height = h;
  }
  const tctx = trail.getContext('2d');
  if (tctx) {
    tctx.save();
    tctx.globalCompositeOperation = 'source-over';
    tctx.globalAlpha = 0.25 + intensity * 0.35;
    tctx.drawImage(snapshot, 0, 0, w, h);
    tctx.restore();
  }

  ctx.save();
  // Ethereal cyan/white ghost copies fanning outward smoothly
  const copies = 3;
  for (let i = 1; i <= copies; i++) {
    const phase = localTime * 2.4 + i * 1.1;
    const spread = (8 + i * 11 * intensity) * (canvasWidth / 1280);
    const ox = Math.sin(phase) * spread;
    const oy = Math.cos(phase * 0.8) * spread * 0.45;
    const sc = 1 + i * 0.025 * intensity;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = ((0.26 / i) * (0.45 + intensity * 0.55)) * opacity;
    ctx.filter = `hue-rotate(${i === 1 ? 15 : -15}deg) saturate(140%) blur(${(i * 1.1).toFixed(1)}px)`;
    ctx.translate(canvasWidth / 2 + ox, canvasHeight / 2 + oy);
    ctx.scale(sc, sc);
    ctx.drawImage(
      snapshot,
      -canvasWidth / 2,
      -canvasHeight / 2,
      canvasWidth,
      canvasHeight
    );
    ctx.restore();
  }

  if (tctx) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.22 * intensity * opacity;
    ctx.filter = 'saturate(130%) brightness(110%)';
    ctx.drawImage(trail, 0, 0, canvasWidth, canvasHeight);
  }
  ctx.restore();
}

function drawNeonSketchPass(
  ctx: CanvasRenderingContext2D,
  snapshot: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  localTime: number,
  intensity: number,
  opacity: number,
  isExport: boolean
) {
  const maxDim = isExport ? 640 : 400;
  const scale = Math.min(1, maxDim / Math.max(canvasWidth, canvasHeight));
  const w = Math.max(32, Math.round(canvasWidth * scale));
  const h = Math.max(32, Math.round(canvasHeight * scale));

  const edge = getFxScratch('fx34-neon-sketch-edge');
  const glow = getFxScratch('fx34-neon-sketch-glow');
  if (edge.width !== w || edge.height !== h) {
    edge.width = w;
    edge.height = h;
    glow.width = w;
    glow.height = h;
  }

  const ectx = edge.getContext('2d', {willReadFrequently: true});
  const gctx = glow.getContext('2d');
  if (!ectx || !gctx) return;

  ectx.clearRect(0, 0, w, h);
  ectx.drawImage(snapshot, 0, 0, w, h);

  try {
    const img = ectx.getImageData(0, 0, w, h);
    const src = img.data;
    const out = new Uint8ClampedArray(src.length);
    const thresh = Math.max(16, 48 - intensity * 26);
    const huePhase = localTime * 0.9;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        const iL = i - 4;
        const iR = i + 4;
        const iU = i - w * 4;
        const iD = i + w * 4;
        const lumL = 0.299 * src[iL] + 0.587 * src[iL + 1] + 0.114 * src[iL + 2];
        const lumR = 0.299 * src[iR] + 0.587 * src[iR + 1] + 0.114 * src[iR + 2];
        const lumU = 0.299 * src[iU] + 0.587 * src[iU + 1] + 0.114 * src[iU + 2];
        const lumD = 0.299 * src[iD] + 0.587 * src[iD + 1] + 0.114 * src[iD + 2];

        const gx = lumR - lumL;
        const gy = lumD - lumU;
        const mag = Math.sqrt(gx * gx + gy * gy);
        if (mag > thresh) {
          const norm = Math.min(1, (mag - thresh) / 80);
          const wave = 0.5 + 0.5 * Math.sin((x / w + y / h) * 4.5 - huePhase);
          // Electric cyan -> neon magenta -> ultraviolet edge sketch
          out[i] = Math.min(255, Math.round(35 + wave * 220));
          out[i + 1] = Math.min(255, Math.round(240 - wave * 175));
          out[i + 2] = Math.min(255, Math.round(255 - (1 - wave) * 20));
          out[i + 3] = Math.round(norm * 255);
        }
      }
    }

    ectx.putImageData(new ImageData(out, w, h), 0, 0);

    gctx.clearRect(0, 0, w, h);
    gctx.save();
    gctx.filter = `blur(${(2.5 + intensity * 4.5).toFixed(1)}px)`;
    gctx.drawImage(edge, 0, 0, w, h);
    gctx.restore();

    ctx.save();
    // Darken base slightly as intensity increases so neon outlines pop cleanly
    ctx.fillStyle = `rgba(4, 6, 16, ${(0.55 * intensity * opacity).toFixed(3)})`;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = Math.min(1, (0.55 + intensity * 0.45) * opacity);
    ctx.drawImage(glow, 0, 0, canvasWidth, canvasHeight);
    ctx.globalAlpha = Math.min(1, (0.65 + intensity * 0.35) * opacity);
    ctx.drawImage(edge, 0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  } catch {
    // ignore cross-origin fallback
  }
}

function drawSilverPass(
  ctx: CanvasRenderingContext2D,
  snapshot: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  localTime: number,
  intensity: number,
  opacity: number,
  effectId: string
) {
  ctx.save();
  ctx.globalAlpha = opacity;
  const sat = Math.max(8, Math.round(100 - intensity * 88));
  const con = 100 + Math.round(intensity * 32);
  const bri = 100 + Math.round(intensity * 10);
  ctx.filter = `saturate(${sat}%) contrast(${con}%) brightness(${bri}%)`;
  ctx.drawImage(snapshot, 0, 0, canvasWidth, canvasHeight);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  const g = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
  g.addColorStop(0, `rgba(226, 232, 240, ${(0.34 * intensity * opacity).toFixed(3)})`);
  g.addColorStop(0.5, `rgba(148, 163, 184, ${(0.22 * intensity * opacity).toFixed(3)})`);
  g.addColorStop(1, `rgba(203, 213, 225, ${(0.38 * intensity * opacity).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Sparkling platinum glints
  ctx.globalCompositeOperation = 'screen';
  const scaleFactor = Math.min(canvasWidth, canvasHeight) / 720;
  const seedBase = hashSeed(effectId + '-silver');
  const glintCount = Math.round(8 + intensity * 14);
  for (let i = 0; i < glintCount; i++) {
    const rx = seededRand(seedBase + i * 5 + 1);
    const ry = seededRand(seedBase + i * 5 + 2);
    const rt = seededRand(seedBase + i * 5 + 3);
    const pulse = Math.pow(0.5 + 0.5 * Math.sin(localTime * (2.2 + rt * 2.5) + i * 1.7), 6);
    if (pulse < 0.08) continue;
    const x = rx * canvasWidth;
    const y = ry * canvasHeight;
    const arm = (10 + rt * 18) * scaleFactor * (0.6 + intensity * 0.5) * pulse;
    ctx.strokeStyle = `rgba(248, 250, 252, ${(0.85 * pulse * opacity).toFixed(3)})`;
    ctx.lineWidth = Math.max(1.2, 1.8 * scaleFactor);
    ctx.beginPath();
    ctx.moveTo(x - arm, y);
    ctx.lineTo(x + arm, y);
    ctx.moveTo(x, y - arm);
    ctx.lineTo(x, y + arm);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDreamyPass(
  ctx: CanvasRenderingContext2D,
  snapshot: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  localTime: number,
  intensity: number,
  opacity: number,
  effectId: string
) {
  const glow = getFxScratch('fx34-dreamy-bloom');
  const gw = Math.max(48, Math.round(canvasWidth * 0.28));
  const gh = Math.max(48, Math.round(canvasHeight * 0.28));
  if (glow.width !== gw || glow.height !== gh) {
    glow.width = gw;
    glow.height = gh;
  }
  const gctx = glow.getContext('2d');
  if (gctx) {
    gctx.clearRect(0, 0, gw, gh);
    gctx.save();
    gctx.filter = `blur(${(5 + intensity * 9).toFixed(1)}px) brightness(${112 + Math.round(intensity * 18)}%) saturate(${112 + Math.round(intensity * 16)}%)`;
    gctx.drawImage(snapshot, 0, 0, gw, gh);
    gctx.restore();
  }

  ctx.save();
  if (gctx) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = (0.28 + intensity * 0.34) * opacity;
    ctx.drawImage(glow, 0, 0, canvasWidth, canvasHeight);
  }

  // Soft pastel bloom wash
  ctx.globalCompositeOperation = 'soft-light';
  const pastel = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
  pastel.addColorStop(0, `rgba(244, 180, 226, ${(0.3 * intensity * opacity).toFixed(3)})`);
  pastel.addColorStop(0.5, `rgba(186, 230, 253, ${(0.24 * intensity * opacity).toFixed(3)})`);
  pastel.addColorStop(1, `rgba(253, 230, 186, ${(0.3 * intensity * opacity).toFixed(3)})`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = pastel;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Floating luminous light orbs
  ctx.globalCompositeOperation = 'screen';
  const scaleFactor = Math.min(canvasWidth, canvasHeight) / 720;
  const seedBase = hashSeed(effectId + '-dreamy');
  const orbCount = Math.round(8 + intensity * 14);
  const orbColors = ['251, 207, 232', '186, 230, 253', '254, 240, 138', '221, 214, 254'];
  for (let i = 0; i < orbCount; i++) {
    const r1 = seededRand(seedBase + i * 7 + 1);
    const r2 = seededRand(seedBase + i * 7 + 2);
    const r3 = seededRand(seedBase + i * 7 + 3);
    const x =
      ((r1 * canvasWidth + Math.sin(localTime * (0.4 + r3 * 0.5) + i) * 45 * scaleFactor) +
        canvasWidth) %
      canvasWidth;
    const y =
      ((r2 * canvasHeight - localTime * (12 + r3 * 18) * scaleFactor) % canvasHeight +
        canvasHeight) %
      canvasHeight;
    const radius = (22 + r3 * 44) * scaleFactor * (0.7 + intensity * 0.45);
    const alpha = (0.14 + 0.14 * Math.sin(localTime * 1.4 + i)) * intensity * opacity;
    const rgb = orbColors[i % orbColors.length];
    const rg = ctx.createRadialGradient(x, y, 0, x, y, radius);
    rg.addColorStop(0, `rgba(${rgb}, ${alpha.toFixed(3)})`);
    rg.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFourPointStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outerR: number,
  innerR: number,
  rotation: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / 4;
    if (i === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
    else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFivePointStarPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outerR: number,
  innerR: number,
  rotation: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    if (i === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
    else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  ctx.closePath();
  ctx.restore();
}

function drawHeartPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rotation: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  const s = size;
  ctx.beginPath();
  ctx.moveTo(0, s * 0.35);
  ctx.bezierCurveTo(-s * 0.05, -s * 0.25, -s * 0.95, -s * 0.2, -s * 0.95, s * 0.35);
  ctx.bezierCurveTo(-s * 0.95, s * 0.85, -s * 0.35, s * 1.15, 0, s * 1.45);
  ctx.bezierCurveTo(s * 0.35, s * 1.15, s * 0.95, s * 0.85, s * 0.95, s * 0.35);
  ctx.bezierCurveTo(s * 0.95, -s * 0.2, s * 0.05, -s * 0.25, 0, s * 0.35);
  ctx.closePath();
  ctx.restore();
}

export function drawDiscoFx(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  currentTime: number,
  localTime: number,
  intensity: number,
  opacity: number,
  beatTimes: number[] = []
) {
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
  const scaleFactor = Math.min(canvasWidth, canvasHeight) / 720;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  // Rotating volumetric spotlight cones from top corners
  const beamCount = 4;
  for (let b = 0; b < beamCount; b++) {
    const originX = b % 2 === 0 ? canvasWidth * 0.15 : canvasWidth * 0.85;
    const originY = -canvasHeight * 0.08;
    const sweep = Math.sin(localTime * (1.7 + b * 0.45) + b * 1.4) * 0.48;
    const angle = Math.PI / 2 + (b % 2 === 0 ? 0.25 : -0.25) + sweep;
    const len = Math.hypot(canvasWidth, canvasHeight) * 1.15;
    const spread = 0.14 + intensity * 0.08;
    const col = palette[(beatIndex + b) % palette.length];

    const grad = ctx.createLinearGradient(
      originX,
      0,
      originX + Math.cos(angle) * len,
      originY + Math.sin(angle) * len
    );
    grad.addColorStop(
      0,
      `rgba(${col}, ${((0.26 + beatPulse * 0.28) * intensity * opacity).toFixed(3)})`
    );
    grad.addColorStop(1, `rgba(${col}, 0)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(
      originX + Math.cos(angle - spread) * len,
      originY + Math.sin(angle - spread) * len
    );
    ctx.lineTo(
      originX + Math.cos(angle + spread) * len,
      originY + Math.sin(angle + spread) * len
    );
    ctx.closePath();
    ctx.fill();
  }

  // Flashing RGB bokeh dots
  const dotCount = Math.round(14 + intensity * 22);
  for (let i = 0; i < dotCount; i++) {
    const rx = seededRand(901 + i * 7);
    const ry = seededRand(902 + i * 7);
    const phase = 0.35 + 0.65 * Math.abs(Math.sin(localTime * 3.8 + i * 1.7));
    const x = (rx * canvasWidth + Math.sin(localTime + i) * 20 * scaleFactor + canvasWidth) % canvasWidth;
    const y = (ry * canvasHeight + Math.cos(localTime * 1.3 + i) * 16 * scaleFactor + canvasHeight) % canvasHeight;
    const r = (10 + (i % 4) * 7) * scaleFactor * (0.7 + beatPulse * 0.45);
    const col = palette[(beatIndex + i) % palette.length];
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${col}, ${(0.45 * phase * intensity * opacity).toFixed(3)})`);
    g.addColorStop(1, `rgba(${col}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawFx34FrameTransforms(params: {
  ctx: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  effectItems: TimelineEffectItem[];
  currentTime: number;
  isExport: boolean;
  takeSnapshot: SnapshotFn;
}) {
  const {
    ctx,
    canvasWidth,
    canvasHeight,
    effectItems,
    currentTime,
    isExport,
    takeSnapshot,
  } = params;

  for (const ef of effectItems) {
    if (ef.category !== 'fx34') continue;
    if (currentTime < ef.startTime || currentTime > ef.endTime) continue;
    const intensity = clamp01(ef.intensity);
    const opacity = clamp01(ef.opacity);
    if (intensity <= 0.01 || opacity <= 0.01) continue;
    const localTime = Math.max(0, currentTime - ef.startTime);

    if (
      ef.type !== 'fisheye' &&
      ef.type !== 'ghost' &&
      ef.type !== 'neon-sketch' &&
      ef.type !== 'silver' &&
      ef.type !== 'dreamy'
    ) {
      continue;
    }

    const snap = takeSnapshot(`fx34-snap-${ef.type}`);
    if (!snap) continue;

    if (ef.type === 'fisheye') {
      drawFisheyePass(ctx, snap, canvasWidth, canvasHeight, intensity, opacity, isExport);
    } else if (ef.type === 'ghost') {
      drawGhostPass(ctx, snap, canvasWidth, canvasHeight, localTime, intensity, opacity, ef.id);
    } else if (ef.type === 'neon-sketch') {
      drawNeonSketchPass(
        ctx,
        snap,
        canvasWidth,
        canvasHeight,
        localTime,
        intensity,
        opacity,
        isExport
      );
    } else if (ef.type === 'silver') {
      drawSilverPass(ctx, snap, canvasWidth, canvasHeight, localTime, intensity, opacity, ef.id);
    } else if (ef.type === 'dreamy') {
      drawDreamyPass(ctx, snap, canvasWidth, canvasHeight, localTime, intensity, opacity, ef.id);
    }
  }
}

export function drawFx34OverlayEffects(params: {
  ctx: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  effectItems: TimelineEffectItem[];
  currentTime: number;
  beatTimes?: number[];
}) {
  const {
    ctx,
    canvasWidth,
    canvasHeight,
    effectItems,
    currentTime,
    beatTimes = [],
  } = params;
  const scaleFactor = Math.min(canvasWidth, canvasHeight) / 720;

  for (const ef of effectItems) {
    if (ef.category !== 'fx34') continue;
    if (currentTime < ef.startTime || currentTime > ef.endTime) continue;
    const intensity = clamp01(ef.intensity);
    const opacity = clamp01(ef.opacity);
    if (intensity <= 0.01 || opacity <= 0.01) continue;

    const dur = Math.max(0.1, ef.endTime - ef.startTime);
    const localTime = Math.max(0, currentTime - ef.startTime);
    const progress = clamp01(localTime / dur);
    const baseSeed = hashSeed(ef.id);

    // 1. Heart Beat — warm crimson rhythmic vignette pulse (zoom handled in computeTimedMotionDelta)
    if (ef.type === 'heart-beat') {
      const period = 60 / 78;
      const phase = localTime % period;
      const lub = Math.exp(-phase * 15);
      const dub = phase >= 0.16 ? 0.62 * Math.exp(-(phase - 0.16) * 18) : 0;
      const pulse = Math.min(1, lub + dub);
      ctx.save();
      const cx = canvasWidth / 2;
      const cy = canvasHeight / 2;
      const outer = Math.hypot(cx, cy);
      const grad = ctx.createRadialGradient(cx, cy, outer * 0.35, cx, cy, outer);
      grad.addColorStop(0, 'rgba(225, 29, 72, 0)');
      grad.addColorStop(
        1,
        `rgba(225, 29, 72, ${((0.16 + pulse * 0.42) * intensity * opacity).toFixed(3)})`
      );
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.restore();
      continue;
    }

    // 2. Dazzling — bright starburst glints & sweeping diagonal light rays
    if (ef.type === 'dazzling') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';

      // Sweeping diagonal light beams
      for (let r = 0; r < 3; r++) {
        const sweep = ((localTime * (0.28 + r * 0.09) + r * 0.33) % 1.4) - 0.2;
        const xCenter = sweep * canvasWidth;
        const beamW = (110 + r * 45) * scaleFactor * (0.7 + intensity * 0.5);
        const grad = ctx.createLinearGradient(
          xCenter - beamW,
          0,
          xCenter + beamW,
          canvasHeight
        );
        grad.addColorStop(0, 'rgba(255, 250, 220, 0)');
        grad.addColorStop(
          0.5,
          `rgba(255, 246, 200, ${(0.28 * intensity * opacity).toFixed(3)})`
        );
        grad.addColorStop(1, 'rgba(255, 250, 220, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }

      // Multi-point starburst glints
      const starCount = Math.round(10 + intensity * 16);
      for (let i = 0; i < starCount; i++) {
        const rx = seededRand(baseSeed + i * 7 + 1);
        const ry = seededRand(baseSeed + i * 7 + 2);
        const rt = seededRand(baseSeed + i * 7 + 3);
        const blink = Math.pow(0.5 + 0.5 * Math.sin(localTime * (2.5 + rt * 3) + i), 3);
        const x = rx * canvasWidth;
        const y = ry * canvasHeight;
        const r = (14 + rt * 26) * scaleFactor * (0.6 + intensity * 0.6) * (0.4 + 0.6 * blink);
        const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 1.4);
        halo.addColorStop(0, `rgba(255, 255, 255, ${(0.9 * blink * opacity).toFixed(3)})`);
        halo.addColorStop(0.4, `rgba(253, 224, 71, ${(0.45 * blink * opacity).toFixed(3)})`);
        halo.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(255, 255, 245, ${(0.95 * blink * opacity).toFixed(3)})`;
        drawFourPointStar(ctx, x, y, r, r * 0.16, localTime * 0.6 + i);
      }
      ctx.restore();
      continue;
    }

    // 4. Flash — crisp camera strobe pulse burst with smooth exposure decay
    if (ef.type === 'flash') {
      const cycle = localTime % 0.9;
      const decay = Math.exp(-cycle * 6.5);
      const initialBurst = localTime < 0.25 ? Math.exp(-localTime * 8) : 0;
      const flashAlpha = Math.min(0.92, Math.max(decay, initialBurst) * (0.4 + intensity * 0.6) * opacity);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.restore();
      continue;
    }

    // 14. Fire Blaze — rising layered flames across lower frame & glowing embers
    if (ef.type === 'fire-blaze') {
      ctx.save();
      const baseH = canvasHeight * (0.28 + intensity * 0.24);
      const baseGlow = ctx.createLinearGradient(0, canvasHeight - baseH, 0, canvasHeight);
      baseGlow.addColorStop(0, 'rgba(239, 68, 68, 0)');
      baseGlow.addColorStop(0.5, `rgba(249, 115, 22, ${(0.34 * intensity * opacity).toFixed(3)})`);
      baseGlow.addColorStop(1, `rgba(254, 215, 102, ${(0.62 * intensity * opacity).toFixed(3)})`);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = baseGlow;
      ctx.fillRect(0, canvasHeight - baseH, canvasWidth, baseH);

      const tongueCount = Math.round(18 + intensity * 24);
      for (let i = 0; i < tongueCount; i++) {
        const rx = seededRand(baseSeed + i * 5 + 1);
        const rSpeed = 1.6 + seededRand(baseSeed + i * 5 + 2) * 2.2;
        const life = (localTime * rSpeed * 0.45 + rx) % 1;
        const x =
          (rx * canvasWidth + Math.sin(localTime * 4 + i) * 22 * scaleFactor + canvasWidth) %
          canvasWidth;
        const flameH = (90 + intensity * 170) * scaleFactor * (1 - life * 0.45);
        const y = canvasHeight - life * baseH * 0.72;
        const w = (36 + seededRand(baseSeed + i * 5 + 3) * 44) * scaleFactor;
        const alpha = (1 - life) * (0.45 + intensity * 0.45) * opacity;

        const fg = ctx.createRadialGradient(x, y, 0, x, y - flameH * 0.35, Math.max(w, flameH));
        fg.addColorStop(0, `rgba(255, 251, 200, ${alpha.toFixed(3)})`);
        fg.addColorStop(0.35, `rgba(251, 146, 60, ${(alpha * 0.85).toFixed(3)})`);
        fg.addColorStop(0.75, `rgba(220, 38, 38, ${(alpha * 0.45).toFixed(3)})`);
        fg.addColorStop(1, 'rgba(185, 28, 28, 0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.ellipse(x, y - flameH * 0.25, w * 0.55, flameH * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Glowing rising embers
      const emberCount = Math.round(24 + intensity * 38);
      for (let i = 0; i < emberCount; i++) {
        const r1 = seededRand(baseSeed + i * 11 + 1);
        const r2 = seededRand(baseSeed + i * 11 + 2);
        const r3 = seededRand(baseSeed + i * 11 + 3);
        const speedY = (110 + r3 * 160) * scaleFactor;
        const span = canvasHeight * 0.85;
        const y = canvasHeight - (((r2 * span + localTime * speedY) % span));
        const x = (r1 * canvasWidth + Math.sin(localTime * 3.2 + i * 2) * 28 * scaleFactor + canvasWidth) % canvasWidth;
        const er = (2 + r3 * 3.5) * scaleFactor;
        const alpha = Math.min(1, (1 - (canvasHeight - y) / span) * 1.1) * opacity;
        ctx.fillStyle = `rgba(253, 224, 71, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, er, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      continue;
    }

    // 15. Dust Super — floating golden dust motes & diagonal sunbeams
    if (ef.type === 'dust-super') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';

      // Diagonal sunbeam shafts from upper left
      for (let b = 0; b < 3; b++) {
        const xTop = canvasWidth * (0.05 + b * 0.22 + 0.04 * Math.sin(localTime * 0.5 + b));
        const xBot = xTop + canvasWidth * 0.45;
        const g = ctx.createLinearGradient(xTop, 0, xBot, canvasHeight);
        g.addColorStop(0, `rgba(254, 240, 138, ${(0.18 * intensity * opacity).toFixed(3)})`);
        g.addColorStop(1, 'rgba(254, 240, 138, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(xTop, 0);
        ctx.lineTo(xTop + canvasWidth * 0.14, 0);
        ctx.lineTo(xBot + canvasWidth * 0.24, canvasHeight);
        ctx.lineTo(xBot, canvasHeight);
        ctx.closePath();
        ctx.fill();
      }

      const moteCount = Math.round(36 + intensity * 65);
      for (let i = 0; i < moteCount; i++) {
        const r1 = seededRand(baseSeed + i * 7 + 1);
        const r2 = seededRand(baseSeed + i * 7 + 2);
        const r3 = seededRand(baseSeed + i * 7 + 3);
        const x =
          (r1 * canvasWidth + localTime * (12 + r3 * 16) * scaleFactor +
            Math.sin(localTime * 0.9 + i) * 26 * scaleFactor) %
          canvasWidth;
        const y =
          (((r2 * canvasHeight - localTime * (10 + r3 * 18) * scaleFactor) % canvasHeight) +
            canvasHeight) %
          canvasHeight;
        const rad = (2.2 + r3 * 5.2) * scaleFactor;
        const twinkle = 0.4 + 0.6 * Math.sin(localTime * (1.8 + r3 * 2.5) + i * 1.4);
        const alpha = (0.35 + 0.55 * twinkle) * (0.45 + intensity * 0.55) * opacity;
        const rg = ctx.createRadialGradient(x, y, 0, x, y, rad * 2.2);
        rg.addColorStop(0, `rgba(255, 250, 220, ${alpha.toFixed(3)})`);
        rg.addColorStop(0.45, `rgba(253, 224, 71, ${(alpha * 0.65).toFixed(3)})`);
        rg.addColorStop(1, 'rgba(253, 224, 71, 0)');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(x, y, rad * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      continue;
    }

    // 16. Doodling — animated chalk doodle squiggles, stars, spirals & crowns
    if (ef.type === 'doodling') {
      ctx.save();
      const colors = ['#FFFFFF', '#38BDF8', '#F472B6', '#FACC15', '#4ADE80'];
      const jitterStep = Math.floor(localTime * 8);
      const count = Math.round(6 + intensity * 8);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 0; i < count; i++) {
        const rx = seededRand(baseSeed + i * 9 + 1);
        const ry = seededRand(baseSeed + i * 9 + 2);
        // Keep doodles mostly framing the edges so center subject stays clear
        const x =
          rx < 0.5
            ? canvasWidth * (0.08 + rx * 0.45)
            : canvasWidth * (0.72 + (rx - 0.5) * 0.46);
        const y = canvasHeight * (0.12 + ry * 0.76);
        const col = colors[i % colors.length];
        const jx = (seededRand(jitterStep + i * 3) - 0.5) * 4 * scaleFactor;
        const jy = (seededRand(jitterStep + i * 5) - 0.5) * 4 * scaleFactor;
        const size = (18 + (i % 3) * 8) * scaleFactor * (0.75 + intensity * 0.35);

        ctx.strokeStyle = col;
        ctx.globalAlpha = (0.7 + 0.25 * Math.sin(localTime * 3 + i)) * opacity;
        ctx.lineWidth = Math.max(2, 3.2 * scaleFactor);
        ctx.shadowColor = col;
        ctx.shadowBlur = 6 * scaleFactor;

        const shape = i % 4;
        if (shape === 0) {
          // Chalk Star
          drawFivePointStarPath(ctx, x + jx, y + jy, size, size * 0.46, Math.sin(localTime * 2 + i) * 0.3);
          ctx.stroke();
        } else if (shape === 1) {
          // Hand-drawn spiral
          ctx.beginPath();
          for (let a = 0; a < 18; a++) {
            const ang = a * 0.55 + localTime * 2;
            const r = (a / 18) * size;
            const px = x + jx + Math.cos(ang) * r;
            const py = y + jy + Math.sin(ang) * r;
            if (a === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        } else if (shape === 2) {
          // Zigzag lightning / squiggle
          ctx.beginPath();
          ctx.moveTo(x - size + jx, y - size * 0.3 + jy);
          ctx.lineTo(x - size * 0.3 + jx, y + size * 0.3 + jy);
          ctx.lineTo(x + size * 0.2 + jx, y - size * 0.25 + jy);
          ctx.lineTo(x + size + jx, y + size * 0.35 + jy);
          ctx.stroke();
        } else {
          // Doodle crown
          ctx.beginPath();
          ctx.moveTo(x - size + jx, y + size * 0.4 + jy);
          ctx.lineTo(x - size * 0.8 + jx, y - size * 0.4 + jy);
          ctx.lineTo(x - size * 0.25 + jx, y + size * 0.05 + jy);
          ctx.lineTo(x + jx, y - size * 0.65 + jy);
          ctx.lineTo(x + size * 0.25 + jx, y + size * 0.05 + jy);
          ctx.lineTo(x + size * 0.8 + jx, y - size * 0.4 + jy);
          ctx.lineTo(x + size + jx, y + size * 0.4 + jy);
          ctx.closePath();
          ctx.stroke();
        }
      }
      ctx.restore();
      continue;
    }

    // 17. Footage — Camcorder REC viewfinder, live timecode, scanlines & corner brackets
    if (ef.type === 'footage') {
      ctx.save();
      // Subtle CRT/VHS scanlines
      ctx.fillStyle = `rgba(0, 0, 0, ${(0.18 * intensity * opacity).toFixed(3)})`;
      const step = Math.max(4, Math.round(5 * scaleFactor));
      for (let y = 0; y < canvasHeight; y += step) {
        ctx.fillRect(0, y, canvasWidth, Math.max(1, step * 0.35));
      }

      // Corner viewfinder brackets
      const pad = 28 * scaleFactor;
      const arm = 34 * scaleFactor;
      ctx.strokeStyle = `rgba(255, 255, 255, ${(0.86 * opacity).toFixed(3)})`;
      ctx.lineWidth = Math.max(2, 2.8 * scaleFactor);
      const corners: Array<[number, number, number, number]> = [
        [pad, pad, 1, 1],
        [canvasWidth - pad, pad, -1, 1],
        [pad, canvasHeight - pad, 1, -1],
        [canvasWidth - pad, canvasHeight - pad, -1, -1],
      ];
      for (const [cx, cy, dx, dy] of corners) {
        ctx.beginPath();
        ctx.moveTo(cx, cy + dy * arm);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + dx * arm, cy);
        ctx.stroke();
      }

      // Blinking REC dot + label
      const blink = Math.floor(localTime * 2) % 2 === 0;
      const recX = pad + 18 * scaleFactor;
      const recY = pad + 24 * scaleFactor;
      if (blink) {
        ctx.fillStyle = `rgba(239, 68, 68, ${opacity.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(recX, recY, 7 * scaleFactor, 0, Math.PI * 2);
        ctx.fill();
      }
      const fontSz = Math.max(12, Math.round(20 * scaleFactor));
      ctx.font = `700 ${fontSz}px "JetBrains Mono", monospace`;
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.92 * opacity).toFixed(3)})`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText('REC', recX + 14 * scaleFactor, recY + 1);

      // Battery + HD badge top right
      ctx.textAlign = 'right';
      ctx.fillText('HD 60FPS', canvasWidth - pad - 14 * scaleFactor, recY + 1);

      // Live formatted timecode bottom left
      const mins = Math.floor(currentTime / 60);
      const secs = Math.floor(currentTime % 60);
      const frames = Math.floor((currentTime % 1) * 60);
      const tc = `00:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
      ctx.textAlign = 'left';
      ctx.fillText(tc, pad + 14 * scaleFactor, canvasHeight - pad - 20 * scaleFactor);
      ctx.textAlign = 'right';
      ctx.fillText('JIT CAM', canvasWidth - pad - 14 * scaleFactor, canvasHeight - pad - 20 * scaleFactor);
      ctx.restore();
      continue;
    }

    // 19. Disco — rotating party beams & RGB bokeh
    if (ef.type === 'disco') {
      drawDiscoFx(ctx, canvasWidth, canvasHeight, currentTime, localTime, intensity, opacity, beatTimes);
      continue;
    }

    // 20. Butterfly — animated colorful butterflies flapping wings & fluttering
    if (ef.type === 'butterfly') {
      ctx.save();
      const count = Math.round(6 + intensity * 10);
      const palettes: Array<[string, string]> = [
        ['#F97316', '#FACC15'],
        ['#38BDF8', '#A855F7'],
        ['#EC4899', '#F472B6'],
        ['#34D399', '#22D3EE'],
      ];
      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 7 + 1);
        const r2 = seededRand(baseSeed + i * 7 + 2);
        const r3 = seededRand(baseSeed + i * 7 + 3);
        const speedX = (38 + r3 * 45) * scaleFactor;
        const x =
          ((r1 * canvasWidth + localTime * speedX * (i % 2 === 0 ? 1 : -1)) % canvasWidth +
            canvasWidth) %
          canvasWidth;
        const y =
          ((r2 * canvasHeight + Math.sin(localTime * (1.8 + r3) + i * 1.9) * 52 * scaleFactor) %
            canvasHeight +
            canvasHeight) %
          canvasHeight;

        const flap = 0.25 + 0.75 * Math.abs(Math.sin(localTime * (8.5 + r3 * 4) + i));
        const size = (15 + r3 * 12) * scaleFactor * (0.75 + intensity * 0.35);
        const [c1, c2] = palettes[i % palettes.length];
        const heading = (i % 2 === 0 ? 0.25 : -0.25) + Math.cos(localTime * 1.8 + i) * 0.2;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(heading);
        ctx.globalAlpha = (0.78 + 0.2 * flap) * opacity;

        for (const side of [-1, 1]) {
          ctx.save();
          ctx.scale(side * flap, 1);
          const wg = ctx.createLinearGradient(0, -size, size, size);
          wg.addColorStop(0, c1);
          wg.addColorStop(1, c2);
          ctx.fillStyle = wg;
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.75)';
          ctx.lineWidth = Math.max(1, 1.4 * scaleFactor);
          // Upper wing
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(size * 0.7, -size * 1.15, size * 1.45, -size * 0.35, size * 0.85, size * 0.2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          // Lower wing
          ctx.beginPath();
          ctx.moveTo(0, size * 0.08);
          ctx.bezierCurveTo(size * 0.9, size * 0.22, size * 0.65, size * 1.05, 0, size * 0.65);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        // Body
        ctx.fillStyle = '#0F172A';
        ctx.beginPath();
        ctx.ellipse(0, size * 0.2, size * 0.1, size * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      continue;
    }

    // 21. Spark — bright golden electric sparks bursting & showering downward
    if (ef.type === 'spark') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.lineCap = 'round';
      const count = Math.round(35 + intensity * 65);
      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 9 + 1);
        const r2 = seededRand(baseSeed + i * 9 + 2);
        const r3 = seededRand(baseSeed + i * 9 + 3);
        const cycle = (localTime * (0.75 + r3 * 0.6) + r2) % 1;
        const originX = (0.2 + r1 * 0.6) * canvasWidth;
        const originY = (0.12 + r2 * 0.35) * canvasHeight;
        const angle = (r1 - 0.5) * Math.PI * 1.6;
        const speed = (140 + r3 * 220) * scaleFactor;
        const vx = Math.sin(angle) * speed;
        const vy = -Math.abs(Math.cos(angle)) * speed * 0.45 + cycle * 420 * scaleFactor;
        const x = originX + vx * cycle;
        const y = originY + vy * cycle + 0.5 * 360 * scaleFactor * cycle * cycle;
        const tailX = x - vx * 0.045;
        const tailY = y - (vy + 360 * scaleFactor * cycle) * 0.045;
        const alpha = (1 - cycle) * (0.55 + intensity * 0.45) * opacity;

        ctx.strokeStyle = i % 3 === 0
          ? `rgba(255, 255, 255, ${alpha.toFixed(3)})`
          : `rgba(251, 191, 36, ${alpha.toFixed(3)})`;
        ctx.lineWidth = Math.max(1.4, (2.2 + r3 * 1.8) * scaleFactor);
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(x, y);
        ctx.stroke();

        ctx.fillStyle = `rgba(255, 245, 200, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, (2 + r3 * 2.2) * scaleFactor, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      continue;
    }

    // 22. Smokey — volumetric drifting wisps of soft layered smoke/mist
    if (ef.type === 'smokey') {
      ctx.save();
      const count = Math.round(14 + intensity * 18);
      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 13 + 1);
        const r2 = seededRand(baseSeed + i * 13 + 2);
        const r3 = seededRand(baseSeed + i * 13 + 3);
        const r4 = seededRand(baseSeed + i * 13 + 4);
        const puffR = (130 + r3 * 190) * scaleFactor * (0.8 + intensity * 0.35);
        const spanW = canvasWidth + puffR * 2;
        const spanH = canvasHeight + puffR * 2;
        const x =
          ((r1 * spanW + localTime * (22 + r4 * 34) * scaleFactor +
            Math.sin(localTime * 0.5 + i) * 32) %
            spanW) -
          puffR;
        const y =
          (((r2 * spanH - localTime * (10 + r2 * 18) * scaleFactor) % spanH) + spanH) % spanH -
          puffR;
        const breath = 0.72 + 0.28 * Math.sin(localTime * 0.9 + r4 * 6.28);
        const alpha = Math.min(0.4, (0.14 + r3 * 0.16) * (0.4 + intensity * 0.6) * breath * opacity);
        const g = ctx.createRadialGradient(x, y, 0, x, y, puffR);
        g.addColorStop(0, `rgba(232, 238, 246, ${alpha.toFixed(3)})`);
        g.addColorStop(0.55, `rgba(196, 208, 224, ${(alpha * 0.5).toFixed(3)})`);
        g.addColorStop(1, 'rgba(196, 208, 224, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, puffR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      continue;
    }

    // 23. Matrix — cascading green digital code rain with bright leading glyphs
    if (ef.type === 'matrix') {
      ctx.save();
      const glyphs = '01アイウエオカキクケコサシスセソ789ZXCV';
      const cols = Math.round(18 + intensity * 24);
      const colW = canvasWidth / cols;
      const fontSize = Math.max(11, Math.round(colW * 0.58));
      ctx.font = `700 ${fontSize}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let c = 0; c < cols; c++) {
        const r1 = seededRand(baseSeed + c * 7 + 1);
        const r2 = seededRand(baseSeed + c * 7 + 2);
        const speed = (140 + r1 * 210) * scaleFactor;
        const streamLen = Math.round(8 + r2 * 10);
        const headY =
          ((r2 * (canvasHeight + streamLen * fontSize) + localTime * speed) %
            (canvasHeight + streamLen * fontSize)) -
          fontSize;
        const x = (c + 0.5) * colW;
        for (let k = 0; k < streamLen; k++) {
          const gy = headY - k * fontSize * 1.08;
          if (gy < -fontSize || gy > canvasHeight + fontSize) continue;
          const charIdx =
            Math.floor(localTime * 8 + c * 3 + k * 5) % glyphs.length;
          const ch = glyphs[Math.abs(charIdx)];
          const fade = 1 - k / streamLen;
          if (k === 0) {
            ctx.fillStyle = `rgba(220, 255, 220, ${(0.95 * opacity).toFixed(3)})`;
          } else {
            ctx.fillStyle = `rgba(34, 197, 94, ${(fade * (0.45 + intensity * 0.45) * opacity).toFixed(3)})`;
          }
          ctx.fillText(ch, x, gy);
        }
      }
      ctx.restore();
      continue;
    }

    // 24. Bubble — glossy iridescent soap bubbles floating upward
    if (ef.type === 'bubble') {
      ctx.save();
      const count = Math.round(14 + intensity * 22);
      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 7 + 1);
        const r2 = seededRand(baseSeed + i * 7 + 2);
        const r3 = seededRand(baseSeed + i * 7 + 3);
        const radius = (14 + r3 * 28) * scaleFactor * (0.75 + intensity * 0.35);
        const span = canvasHeight + radius * 2;
        const y =
          (((r2 * span - localTime * (45 + r3 * 65) * scaleFactor) % span) + span) % span -
          radius;
        const x =
          (r1 * canvasWidth + Math.sin(localTime * (1.2 + r3) + i) * 26 * scaleFactor + canvasWidth) %
          canvasWidth;

        // Rim iridescent gradient
        const bg = ctx.createRadialGradient(
          x - radius * 0.3,
          y - radius * 0.3,
          radius * 0.15,
          x,
          y,
          radius
        );
        bg.addColorStop(0, `rgba(255, 255, 255, ${(0.06 * opacity).toFixed(3)})`);
        bg.addColorStop(0.7, `rgba(125, 211, 252, ${(0.18 * opacity).toFixed(3)})`);
        bg.addColorStop(0.9, `rgba(244, 114, 182, ${(0.34 * opacity).toFixed(3)})`);
        bg.addColorStop(1, `rgba(255, 255, 255, ${(0.62 * opacity).toFixed(3)})`);

        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.55 * opacity).toFixed(3)})`;
        ctx.lineWidth = Math.max(1, 1.4 * scaleFactor);
        ctx.stroke();

        // Glossy specular highlight
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.75 * opacity).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(
          x - radius * 0.38,
          y - radius * 0.38,
          radius * 0.22,
          radius * 0.11,
          -0.6,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      ctx.restore();
      continue;
    }

    // 25. Ribbon — flowing silky neon/pastel ribbons weaving smoothly across
    if (ef.type === 'ribbon') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const ribbonCount = Math.round(3 + intensity * 3);
      const colors = ['#38BDF8', '#F472B6', '#A78BFA', '#34D399', '#FBBF24', '#FB7185'];
      ctx.lineCap = 'round';
      for (let r = 0; r < ribbonCount; r++) {
        const yBase = canvasHeight * (0.2 + (r / ribbonCount) * 0.6);
        const amp = (45 + r * 14) * scaleFactor * (0.6 + intensity * 0.6);
        const freq = 0.004 + r * 0.0008;
        const speed = 2.1 + r * 0.45;
        const col = colors[r % colors.length];

        ctx.strokeStyle = col;
        ctx.globalAlpha = (0.38 + intensity * 0.35) * opacity;
        ctx.lineWidth = (12 + r * 3) * scaleFactor;
        ctx.shadowColor = col;
        ctx.shadowBlur = 16 * scaleFactor;
        ctx.beginPath();
        const steps = 28;
        for (let s = 0; s <= steps; s++) {
          const x = (s / steps) * canvasWidth;
          const y =
            yBase +
            Math.sin(x * freq + localTime * speed + r * 1.4) * amp +
            Math.cos(x * freq * 1.7 - localTime * 1.3) * (amp * 0.4);
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Bright silk core
        ctx.strokeStyle = '#FFFFFF';
        ctx.globalAlpha = (0.28 + intensity * 0.25) * opacity;
        ctx.lineWidth = 3 * scaleFactor;
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }

    // 26. Shimmer — diagonal glass sheen sweeping smoothly + crystalline glints
    if (ef.type === 'shimmer') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const cycle = (localTime * (0.55 + intensity * 0.35)) % 1.6;
      const sweepX = (cycle - 0.3) * canvasWidth;
      const bandW = canvasWidth * (0.18 + intensity * 0.14);
      const grad = ctx.createLinearGradient(
        sweepX - bandW,
        0,
        sweepX + bandW,
        canvasHeight
      );
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.45, `rgba(224, 242, 254, ${(0.38 * intensity * opacity).toFixed(3)})`);
      grad.addColorStop(0.5, `rgba(255, 255, 255, ${(0.62 * intensity * opacity).toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(250, 232, 255, ${(0.38 * intensity * opacity).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      const glintCount = Math.round(12 + intensity * 18);
      for (let i = 0; i < glintCount; i++) {
        const rx = seededRand(baseSeed + i * 7 + 1);
        const ry = seededRand(baseSeed + i * 7 + 2);
        const pulse = Math.pow(0.5 + 0.5 * Math.sin(localTime * 3.5 + i * 1.9), 5);
        if (pulse < 0.1) continue;
        const x = rx * canvasWidth;
        const y = ry * canvasHeight;
        const r = (10 + (i % 4) * 5) * scaleFactor * pulse;
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.88 * pulse * opacity).toFixed(3)})`;
        drawFourPointStar(ctx, x, y, r, r * 0.15, localTime * 0.8 + i);
      }
      ctx.restore();
      continue;
    }

    // 28. Love Bloom — glowing pink/red hearts & soft rose bokeh
    if (ef.type === 'love-bloom') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const warm = ctx.createRadialGradient(
        canvasWidth / 2,
        canvasHeight / 2,
        0,
        canvasWidth / 2,
        canvasHeight / 2,
        Math.hypot(canvasWidth, canvasHeight) * 0.65
      );
      warm.addColorStop(0, `rgba(244, 114, 182, ${(0.16 * intensity * opacity).toFixed(3)})`);
      warm.addColorStop(1, `rgba(225, 29, 72, ${(0.22 * intensity * opacity).toFixed(3)})`);
      ctx.fillStyle = warm;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      ctx.globalCompositeOperation = 'source-over';
      const count = Math.round(14 + intensity * 20);
      const heartColors = ['#FB7185', '#F43F5E', '#EC4899', '#FDA4AF'];
      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 7 + 1);
        const r2 = seededRand(baseSeed + i * 7 + 2);
        const r3 = seededRand(baseSeed + i * 7 + 3);
        const size = (10 + r3 * 16) * scaleFactor * (0.75 + intensity * 0.35);
        const span = canvasHeight + size * 4;
        const y =
          (((r2 * span - localTime * (42 + r3 * 52) * scaleFactor) % span) + span) % span -
          size * 2;
        const x =
          (r1 * canvasWidth + Math.sin(localTime * 1.4 + i) * 28 * scaleFactor + canvasWidth) %
          canvasWidth;
        const rot = Math.sin(localTime * 1.8 + i) * 0.25;
        const col = heartColors[i % heartColors.length];
        ctx.save();
        ctx.globalAlpha = (0.55 + 0.35 * Math.sin(localTime * 2 + i)) * opacity;
        ctx.fillStyle = col;
        ctx.shadowColor = '#F43F5E';
        ctx.shadowBlur = 12 * scaleFactor;
        drawHeartPath(ctx, x, y, size, rot);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      continue;
    }

    // 29. Neon Star — electric cyan, magenta & yellow stars popping and spinning
    if (ef.type === 'neon-star') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const count = Math.round(14 + intensity * 22);
      const starPalette = ['#22D3EE', '#E879F9', '#FACC15', '#38BDF8', '#FB7185'];
      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 7 + 1);
        const r2 = seededRand(baseSeed + i * 7 + 2);
        const r3 = seededRand(baseSeed + i * 7 + 3);
        const cycle = (localTime * (0.7 + r3 * 0.6) + r2) % 1;
        const popScale = Math.sin(cycle * Math.PI);
        if (popScale <= 0.05) continue;
        const x = r1 * canvasWidth;
        const y = r2 * canvasHeight;
        const radius = (14 + r3 * 22) * scaleFactor * popScale * (0.7 + intensity * 0.45);
        const col = starPalette[i % starPalette.length];

        ctx.save();
        ctx.globalAlpha = popScale * (0.65 + intensity * 0.35) * opacity;
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = Math.max(1.8, 2.6 * scaleFactor);
        ctx.shadowColor = col;
        ctx.shadowBlur = 14 * scaleFactor;
        drawFivePointStarPath(ctx, x, y, radius, radius * 0.45, localTime * (1.8 + r3) + i);
        ctx.stroke();
        ctx.globalAlpha *= 0.28;
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      continue;
    }

    // 30. Pumpkin — festive glowing jack-o-lanterns & autumn sparkles
    if (ef.type === 'pumpkin') {
      ctx.save();
      const count = Math.round(6 + intensity * 8);
      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 7 + 1);
        const r2 = seededRand(baseSeed + i * 7 + 2);
        const r3 = seededRand(baseSeed + i * 7 + 3);
        const r = (22 + r3 * 16) * scaleFactor * (0.75 + intensity * 0.35);
        const x =
          (r1 * canvasWidth + Math.sin(localTime * 1.1 + i) * 26 * scaleFactor + canvasWidth) %
          canvasWidth;
        const y =
          (((r2 * canvasHeight - localTime * (24 + r3 * 28) * scaleFactor) % canvasHeight) +
            canvasHeight) %
          canvasHeight;
        const wobble = Math.sin(localTime * 2.4 + i) * 0.14;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(wobble);
        ctx.globalAlpha = 0.88 * opacity;
        // Stem
        ctx.fillStyle = '#15803D';
        ctx.fillRect(-r * 0.12, -r * 1.05, r * 0.24, r * 0.35);
        // Body
        ctx.fillStyle = '#EA580C';
        ctx.shadowColor = '#F97316';
        ctx.shadowBlur = 12 * scaleFactor;
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.82, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#9A3412';
        ctx.lineWidth = Math.max(1, 1.5 * scaleFactor);
        ctx.stroke();
        // Glowing Jack-o'-lantern eyes & grin
        ctx.shadowBlur = 6 * scaleFactor;
        ctx.shadowColor = '#FDE047';
        ctx.fillStyle = '#FEF08A';
        ctx.beginPath();
        ctx.moveTo(-r * 0.45, -r * 0.12);
        ctx.lineTo(-r * 0.22, -r * 0.36);
        ctx.lineTo(-r * 0.12, -r * 0.12);
        ctx.closePath();
        ctx.moveTo(r * 0.45, -r * 0.12);
        ctx.lineTo(r * 0.22, -r * 0.36);
        ctx.lineTo(r * 0.12, -r * 0.12);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, r * 0.14, r * 0.46, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      continue;
    }

    // 31. Bats — animated flocking bat silhouettes flapping across twilight tint
    if (ef.type === 'bats') {
      ctx.save();
      ctx.fillStyle = `rgba(30, 27, 75, ${(0.22 * intensity * opacity).toFixed(3)})`;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      const count = Math.round(9 + intensity * 14);
      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 7 + 1);
        const r2 = seededRand(baseSeed + i * 7 + 2);
        const r3 = seededRand(baseSeed + i * 7 + 3);
        const speed = (95 + r3 * 120) * scaleFactor;
        const x =
          ((r1 * canvasWidth + localTime * speed * (i % 2 === 0 ? 1 : -1)) % canvasWidth +
            canvasWidth) %
          canvasWidth;
        const y =
          ((r2 * canvasHeight * 0.85 + Math.sin(localTime * 2.2 + i) * 32 * scaleFactor) %
            canvasHeight +
            canvasHeight) %
          canvasHeight;
        const flap = Math.sin(localTime * (10 + r3 * 5) + i * 1.3);
        const span = (18 + r3 * 18) * scaleFactor * (0.75 + intensity * 0.35);

        ctx.save();
        ctx.translate(x, y);
        ctx.globalAlpha = 0.86 * opacity;
        ctx.fillStyle = '#09090B';
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.45)';
        ctx.lineWidth = Math.max(1, 1.2 * scaleFactor);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-span * 0.5, -span * (0.55 * flap + 0.35), -span, flap * span * 0.35);
        ctx.quadraticCurveTo(-span * 0.55, span * 0.32, 0, span * 0.25);
        ctx.quadraticCurveTo(span * 0.55, span * 0.32, span, flap * span * 0.35);
        ctx.quadraticCurveTo(span * 0.5, -span * (0.55 * flap + 0.35), 0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      continue;
    }

    // 32. Fire Frame — animated burning flame border framing all 4 edges
    if (ef.type === 'fire-frame') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const borderDepth = Math.min(canvasWidth, canvasHeight) * (0.08 + intensity * 0.1);

      // Four glowing edge gradients
      const topG = ctx.createLinearGradient(0, 0, 0, borderDepth);
      topG.addColorStop(0, `rgba(254, 215, 102, ${(0.65 * opacity).toFixed(3)})`);
      topG.addColorStop(0.5, `rgba(249, 115, 22, ${(0.35 * intensity * opacity).toFixed(3)})`);
      topG.addColorStop(1, 'rgba(220, 38, 38, 0)');
      ctx.fillStyle = topG;
      ctx.fillRect(0, 0, canvasWidth, borderDepth);

      const botG = ctx.createLinearGradient(0, canvasHeight, 0, canvasHeight - borderDepth);
      botG.addColorStop(0, `rgba(254, 215, 102, ${(0.72 * opacity).toFixed(3)})`);
      botG.addColorStop(0.5, `rgba(249, 115, 22, ${(0.38 * intensity * opacity).toFixed(3)})`);
      botG.addColorStop(1, 'rgba(220, 38, 38, 0)');
      ctx.fillStyle = botG;
      ctx.fillRect(0, canvasHeight - borderDepth, canvasWidth, borderDepth);

      const leftG = ctx.createLinearGradient(0, 0, borderDepth, 0);
      leftG.addColorStop(0, `rgba(254, 215, 102, ${(0.65 * opacity).toFixed(3)})`);
      leftG.addColorStop(0.5, `rgba(249, 115, 22, ${(0.35 * intensity * opacity).toFixed(3)})`);
      leftG.addColorStop(1, 'rgba(220, 38, 38, 0)');
      ctx.fillStyle = leftG;
      ctx.fillRect(0, 0, borderDepth, canvasHeight);

      const rightG = ctx.createLinearGradient(canvasWidth, 0, canvasWidth - borderDepth, 0);
      rightG.addColorStop(0, `rgba(254, 215, 102, ${(0.65 * opacity).toFixed(3)})`);
      rightG.addColorStop(0.5, `rgba(249, 115, 22, ${(0.35 * intensity * opacity).toFixed(3)})`);
      rightG.addColorStop(1, 'rgba(220, 38, 38, 0)');
      ctx.fillStyle = rightG;
      ctx.fillRect(canvasWidth - borderDepth, 0, borderDepth, canvasHeight);

      // Flickering flame tongues around perimeter
      const stepsX = Math.round(14 + intensity * 12);
      for (let i = 0; i <= stepsX; i++) {
        const fx = (i / stepsX) * canvasWidth;
        const flick = 0.65 + 0.35 * Math.sin(localTime * 11 + i * 2.1);
        const r = borderDepth * (0.65 + flick * 0.55);
        for (const fy of [0, canvasHeight]) {
          const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
          g.addColorStop(0, `rgba(255, 250, 200, ${(0.65 * opacity).toFixed(3)})`);
          g.addColorStop(0.45, `rgba(249, 115, 22, ${(0.45 * opacity).toFixed(3)})`);
          g.addColorStop(1, 'rgba(220, 38, 38, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(fx, fy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const stepsY = Math.round(8 + intensity * 8);
      for (let i = 0; i <= stepsY; i++) {
        const fy = (i / stepsY) * canvasHeight;
        const flick = 0.65 + 0.35 * Math.cos(localTime * 10 + i * 2.3);
        const r = borderDepth * (0.65 + flick * 0.55);
        for (const fx of [0, canvasWidth]) {
          const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
          g.addColorStop(0, `rgba(255, 250, 200, ${(0.65 * opacity).toFixed(3)})`);
          g.addColorStop(0.45, `rgba(249, 115, 22, ${(0.45 * opacity).toFixed(3)})`);
          g.addColorStop(1, 'rgba(220, 38, 38, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(fx, fy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      continue;
    }

    // 34. Gold Coin — spinning 3D-styled golden coins raining down and sparkling
    if (ef.type === 'gold-coin') {
      ctx.save();
      const count = Math.round(14 + intensity * 22);
      for (let i = 0; i < count; i++) {
        const r1 = seededRand(baseSeed + i * 11 + 1);
        const r2 = seededRand(baseSeed + i * 11 + 2);
        const r3 = seededRand(baseSeed + i * 11 + 3);
        const r = (14 + r3 * 12) * scaleFactor * (0.75 + intensity * 0.35);
        const span = canvasHeight + r * 3;
        const y = ((r2 * span + localTime * (120 + r3 * 140) * scaleFactor) % span) - r * 1.5;
        const x =
          (r1 * canvasWidth + Math.sin(localTime * 2 + i) * 20 * scaleFactor + canvasWidth) %
          canvasWidth;
        const spin = Math.cos(localTime * (4.5 + r3 * 3.5) + i * 1.3);
        const absSpin = Math.max(0.16, Math.abs(spin));
        const rimThick = (1 - absSpin) * r * 0.34;

        ctx.save();
        ctx.translate(x, y);
        ctx.globalAlpha = 0.94 * opacity;

        // Edge rim for 3D depth
        if (rimThick > 0.5) {
          ctx.fillStyle = '#B45309';
          ctx.beginPath();
          ctx.ellipse(spin >= 0 ? rimThick : -rimThick, 0, r * absSpin, r, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        // Front coin face
        const cg = ctx.createLinearGradient(-r * absSpin, -r, r * absSpin, r);
        cg.addColorStop(0, '#FEF08A');
        cg.addColorStop(0.45, '#FACC15');
        cg.addColorStop(1, '#CA8A04');
        ctx.fillStyle = cg;
        ctx.strokeStyle = '#92400E';
        ctx.lineWidth = Math.max(1.2, 1.8 * scaleFactor);
        ctx.beginPath();
        ctx.ellipse(0, 0, r * absSpin, r, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Inner coin ring & shine
        if (absSpin > 0.35) {
          ctx.strokeStyle = 'rgba(255, 251, 235, 0.72)';
          ctx.lineWidth = Math.max(1, 1.3 * scaleFactor);
          ctx.beginPath();
          ctx.ellipse(0, 0, r * absSpin * 0.72, r * 0.72, 0, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
          ctx.fillRect(-r * absSpin * 0.14, -r * 0.38, r * absSpin * 0.28, r * 0.76);
        }
        ctx.restore();
      }
      ctx.restore();
      continue;
    }

    // Keep unused variable lint clean when effect didn't need progress
    void progress;
  }
}

export function drawFx34RevealAndClosures(params: {
  ctx: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  effectItems: TimelineEffectItem[];
  currentTime: number;
}) {
  const {ctx, canvasWidth, canvasHeight, effectItems, currentTime} = params;
  const scaleFactor = Math.min(canvasWidth, canvasHeight) / 720;

  for (const ef of effectItems) {
    if (ef.category !== 'fx34') continue;
    if (currentTime < ef.startTime || currentTime > ef.endTime) continue;
    const intensity = clamp01(ef.intensity);
    const opacity = clamp01(ef.opacity);
    if (intensity <= 0.01 || opacity <= 0.01) continue;

    const dur = Math.max(0.1, ef.endTime - ef.startTime);
    const localTime = Math.max(0, currentTime - ef.startTime);
    // Speed scales with intensity so 100% covers full transition cleanly
    const rawProg = clamp01(localTime / dur);
    const eased = easeInOutCubic(rawProg);

    // 5. Open 1 — horizontal cinema curtain / split gate opening from center outward
    if (ef.type === 'open-1') {
      const closedFrac = Math.max(0, 1 - eased);
      if (closedFrac <= 0.002) continue;
      const barH = (canvasHeight * 0.5) * closedFrac * (0.45 + intensity * 0.55);
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${opacity.toFixed(3)})`;
      ctx.fillRect(0, 0, canvasWidth, barH);
      ctx.fillRect(0, canvasHeight - barH, canvasWidth, barH);
      ctx.restore();
      continue;
    }

    // 6. Open 2 — circular iris shutter opening cleanly onto scene
    if (ef.type === 'open-2') {
      const maxR = Math.hypot(canvasWidth / 2, canvasHeight / 2) * 1.05;
      const irisR = maxR * easeOutCubic(rawProg) + maxR * (1 - intensity) * 0.25;
      if (irisR >= maxR) continue;
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${opacity.toFixed(3)})`;
      ctx.beginPath();
      ctx.rect(0, 0, canvasWidth, canvasHeight);
      ctx.arc(canvasWidth / 2, canvasHeight / 2, Math.max(0, irisR), 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
      continue;
    }

    // 7. Close 1 — horizontal cinema curtain closing inward to pure black
    if (ef.type === 'close-1') {
      const barH = (canvasHeight * 0.5) * eased * (0.45 + intensity * 0.55);
      if (barH <= 0.5) continue;
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${opacity.toFixed(3)})`;
      ctx.fillRect(0, 0, canvasWidth, barH);
      ctx.fillRect(0, canvasHeight - barH, canvasWidth, barH);
      ctx.restore();
      continue;
    }

    // 8. Close 2 — circular iris shutter closing smoothly onto center
    if (ef.type === 'close-2') {
      const maxR = Math.hypot(canvasWidth / 2, canvasHeight / 2) * 1.05;
      const irisR = Math.max(0, maxR * (1 - eased * (0.55 + intensity * 0.45)));
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${opacity.toFixed(3)})`;
      ctx.beginPath();
      ctx.rect(0, 0, canvasWidth, canvasHeight);
      ctx.arc(canvasWidth / 2, canvasHeight / 2, irisR, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
      continue;
    }

    // 9. Fade In — silky opacity fade-in from pure black
    if (ef.type === 'fade-in') {
      const blackAlpha = (1 - eased) * (0.45 + intensity * 0.55) * opacity;
      if (blackAlpha <= 0.002) continue;
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${blackAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.restore();
      continue;
    }

    // 10. Fade Out — silky opacity fade-out to pure black
    if (ef.type === 'fade-out') {
      const blackAlpha = eased * (0.45 + intensity * 0.55) * opacity;
      if (blackAlpha <= 0.002) continue;
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${blackAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.restore();
      continue;
    }

    // 13. White In — dreamy bright white-light bloom fade-in
    if (ef.type === 'white-in') {
      const whiteAlpha = Math.pow(1 - rawProg, 1.35) * (0.45 + intensity * 0.55) * opacity;
      if (whiteAlpha <= 0.002) continue;
      ctx.save();
      ctx.fillStyle = `rgba(255, 255, 255, ${whiteAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.restore();
      continue;
    }

    // 12. The End — classic cinema vignette closing with golden/white serif typography & grain
    if (ef.type === 'the-end') {
      const fadeIn = easeOutCubic(Math.min(1, rawProg / 0.55));
      ctx.save();
      // Deep cinema vignette darkening
      const cx = canvasWidth / 2;
      const cy = canvasHeight / 2;
      const outer = Math.hypot(cx, cy);
      const vg = ctx.createRadialGradient(cx, cy, outer * 0.1, cx, cy, outer);
      vg.addColorStop(0, `rgba(10, 8, 6, ${(0.55 * fadeIn * intensity * opacity).toFixed(3)})`);
      vg.addColorStop(1, `rgba(0, 0, 0, ${(0.95 * fadeIn * opacity).toFixed(3)})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Classic cinema top & bottom matte bars
      const barH = canvasHeight * 0.1 * fadeIn;
      ctx.fillStyle = `rgba(0, 0, 0, ${opacity.toFixed(3)})`;
      ctx.fillRect(0, 0, canvasWidth, barH);
      ctx.fillRect(0, canvasHeight - barH, canvasWidth, barH);

      // Ornate golden/cream serif "THE END" typography
      const titleSize = Math.max(26, Math.round(68 * scaleFactor));
      const textScale = 0.9 + 0.1 * fadeIn;
      ctx.translate(cx, cy);
      ctx.scale(textScale, textScale);
      ctx.globalAlpha = fadeIn * opacity;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Subtle golden filigree rule lines above & below
      const ruleW = Math.min(canvasWidth * 0.34, 240 * scaleFactor) * fadeIn;
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.72)';
      ctx.lineWidth = Math.max(1.5, 2 * scaleFactor);
      ctx.beginPath();
      ctx.moveTo(-ruleW / 2, -titleSize * 0.85);
      ctx.lineTo(ruleW / 2, -titleSize * 0.85);
      ctx.moveTo(-ruleW / 2, titleSize * 0.85);
      ctx.lineTo(ruleW / 2, titleSize * 0.85);
      ctx.stroke();

      ctx.font = `700 italic ${titleSize}px "Georgia", "Times New Roman", serif`;
      ctx.shadowColor = 'rgba(251, 191, 36, 0.45)';
      ctx.shadowBlur = 18 * scaleFactor;
      const tg = ctx.createLinearGradient(0, -titleSize / 2, 0, titleSize / 2);
      tg.addColorStop(0, '#FFFBEB');
      tg.addColorStop(0.55, '#FDE68A');
      tg.addColorStop(1, '#F59E0B');
      ctx.fillStyle = tg;
      ctx.fillText('THE END', 0, 0);
      ctx.restore();
      continue;
    }
  }
}

/**
 * Live animated miniature stage renderer used inside Effects tab preview cards.
 * Draws a vibrant stylized mountain/sun/city backdrop and runs the real Canvas FX.
 */
export function drawFx34PreviewScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  type: Effect34Type,
  timeSec: number
) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // Subtle rhythmic zoom for Heart Beat preview card
  let pulseZoom = 1;
  if (type === 'heart-beat') {
    const period = 60 / 78;
    const phase = timeSec % period;
    const lub = Math.exp(-phase * 15);
    const dub = phase >= 0.16 ? 0.62 * Math.exp(-(phase - 0.16) * 18) : 0;
    pulseZoom = 1 + Math.min(1, lub + dub) * 0.13;
  }

  ctx.save();
  if (pulseZoom !== 1) {
    ctx.translate(w / 2, h / 2);
    ctx.scale(pulseZoom, pulseZoom);
    ctx.translate(-w / 2, -h / 2);
  }

  // Stylized twilight cinema gradient backdrop
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1E1B4B');
  sky.addColorStop(0.52, '#7C2D12');
  sky.addColorStop(1, '#0F172A');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Glowing horizon sun moving gently so Ghost / Fisheye / Neon Sketch read clearly
  const sunX = w * (0.5 + 0.16 * Math.sin(timeSec * 1.1));
  const sunY = h * 0.44;
  const sunR = Math.min(w, h) * 0.22;
  const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 1.6);
  sg.addColorStop(0, '#FEF08A');
  sg.addColorStop(0.45, '#F97316');
  sg.addColorStop(1, 'rgba(249, 115, 22, 0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR * 1.6, 0, Math.PI * 2);
  ctx.fill();

  // Sharp foreground geometric peaks & glowing skyline bars (great contrast for Neon Sketch / Silver)
  ctx.fillStyle = '#090D16';
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, h * 0.7);
  ctx.lineTo(w * 0.24, h * 0.48);
  ctx.lineTo(w * 0.48, h * 0.68);
  ctx.lineTo(w * 0.74, h * 0.42);
  ctx.lineTo(w, h * 0.66);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  // Crisp silhouette figure / tower accent
  ctx.fillStyle = '#38BDF8';
  ctx.fillRect(w * 0.47, h * 0.56, w * 0.06, h * 0.34);
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.48, Math.min(w, h) * 0.065, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const dur = 3.0;
  const loopT = timeSec % dur;
  const fakeItem: TimelineEffectItem = {
    id: `preview-${type}`,
    type,
    category: 'fx34',
    name: type,
    icon: '',
    intensity: 0.8,
    opacity: 1,
    startTime: 0,
    endTime: dur,
  };

  const snapFn: SnapshotFn = (key = 'preview-snap') => {
    const s = getFxScratch(key);
    if (s.width !== ctx.canvas.width || s.height !== ctx.canvas.height) {
      s.width = ctx.canvas.width;
      s.height = ctx.canvas.height;
    }
    const sctx = s.getContext('2d');
    if (!sctx) return null;
    sctx.clearRect(0, 0, s.width, s.height);
    sctx.drawImage(ctx.canvas, 0, 0, s.width, s.height);
    return s;
  };

  drawFx34FrameTransforms({
    ctx,
    canvasWidth: w,
    canvasHeight: h,
    effectItems: [fakeItem],
    currentTime: loopT,
    isExport: false,
    takeSnapshot: snapFn,
  });

  drawFx34OverlayEffects({
    ctx,
    canvasWidth: w,
    canvasHeight: h,
    effectItems: [fakeItem],
    currentTime: loopT,
  });

  drawFx34RevealAndClosures({
    ctx,
    canvasWidth: w,
    canvasHeight: h,
    effectItems: [fakeItem],
    currentTime: loopT,
  });

  ctx.restore();
}
