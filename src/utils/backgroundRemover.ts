type SegmentationSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

interface MediaPipeResults {
  segmentationMask: CanvasImageSource;
}

interface MediaPipeSelfieSegmentation {
  setOptions: (options: {modelSelection?: number; selfieMode?: boolean}) => void;
  onResults: (callback: (results: MediaPipeResults) => void) => void;
  initialize: () => Promise<void>;
  send: (input: {image: HTMLCanvasElement}) => Promise<void>;
}

declare global {
  interface Window {
    SelfieSegmentation?: new (config?: {
      locateFile?: (file: string) => string;
    }) => MediaPipeSelfieSegmentation;
  }
}

let scriptLoadPromise: Promise<void> | null = null;
let segmenterPromise: Promise<MediaPipeSelfieSegmentation> | null = null;
let mediaPipeUnavailable = false;
let pendingResolve: ((mask: CanvasImageSource) => void) | null = null;
let queueTail: Promise<void> = Promise.resolve();
let isBusy = false;

const maskCache = new Map<string, HTMLCanvasElement>();
const lastRequestStamp = new Map<string, number>();
let pendingNotifyAfterBusy: (() => void) | null = null;

function loadSelfieSegmentationScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window unavailable'));
  }
  if (mediaPipeUnavailable) {
    return Promise.reject(new Error('MediaPipe unavailable; using canvas fallback'));
  }
  if (window.SelfieSegmentation) {
    return Promise.resolve();
  }
  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/mediapipe/selfie_segmentation/selfie_segmentation.js';
    script.async = true;
    const timeout = window.setTimeout(() => {
      scriptLoadPromise = null;
      reject(new Error('Timed out loading MediaPipe SelfieSegmentation script.'));
    }, 6000);
    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.SelfieSegmentation) {
        resolve();
      } else {
        reject(new Error('SelfieSegmentation global not found after script load.'));
      }
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      scriptLoadPromise = null;
      reject(new Error('Failed to load MediaPipe SelfieSegmentation script.'));
    };
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

async function getSegmenter(): Promise<MediaPipeSelfieSegmentation> {
  if (mediaPipeUnavailable) {
    throw new Error('MediaPipe unavailable');
  }
  if (segmenterPromise) return segmenterPromise;

  segmenterPromise = (async () => {
    try {
      await loadSelfieSegmentationScript();
      const Ctor = window.SelfieSegmentation;
      if (!Ctor) {
        throw new Error('SelfieSegmentation constructor unavailable');
      }
      const instance = new Ctor({
        locateFile: (file: string) => `/mediapipe/selfie_segmentation/${file}`,
      });
      instance.setOptions({
        modelSelection: 1,
        selfieMode: false,
      });
      instance.onResults((results) => {
        if (pendingResolve) {
          const res = pendingResolve;
          pendingResolve = null;
          res(results.segmentationMask);
        }
      });
      await instance.initialize();
      return instance;
    } catch (err) {
      mediaPipeUnavailable = true;
      segmenterPromise = null;
      throw err;
    }
  })();

  return segmenterPromise;
}

export function warmUpSelfieSegmentation(): Promise<void> {
  return getSegmenter()
    .then(() => undefined)
    .catch(() => undefined);
}

const inputCanvas =
  typeof document !== 'undefined' ? document.createElement('canvas') : null;

function getSourceDimensions(source: SegmentationSource): {w: number; h: number} {
  if (source instanceof HTMLVideoElement) {
    return {w: source.videoWidth, h: source.videoHeight};
  }
  if (source instanceof HTMLImageElement) {
    return {w: source.naturalWidth, h: source.naturalHeight};
  }
  return {w: source.width, h: source.height};
}

/**
 * Safe HTML5 Canvas foreground/person fallback mask when MediaPipe WASM/CDN is unavailable.
 * Combines border background color separation (YCbCr + luminance) with a soft portrait silhouette prior.
 */
function buildCanvasFallbackMask(
  key: string,
  source: SegmentationSource,
  w: number,
  h: number
): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || w <= 0 || h <= 0) return null;

  const maxFallbackDim = 160;
  const scale = Math.min(1, maxFallbackDim / Math.max(w, h));
  const fw = Math.max(24, Math.round(w * scale));
  const fh = Math.max(24, Math.round(h * scale));

  const sampleCanvas = getScratchCanvasInternal('fallback-sample');
  if (sampleCanvas.width !== fw || sampleCanvas.height !== fh) {
    sampleCanvas.width = fw;
    sampleCanvas.height = fh;
  }
  const sctx = sampleCanvas.getContext('2d', {willReadFrequently: true});
  if (!sctx) return null;

  try {
    sctx.clearRect(0, 0, fw, fh);
    sctx.drawImage(source, 0, 0, fw, fh);
    const img = sctx.getImageData(0, 0, fw, fh);
    const px = img.data;

    // Estimate background color from outer top/left/right border pixels
    let sumY = 0;
    let sumCb = 0;
    let sumCr = 0;
    let count = 0;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        if (y < 3 || x < 3 || x >= fw - 3) {
          const i = (y * fw + x) * 4;
          const r = px[i];
          const g = px[i + 1];
          const b = px[i + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
          const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
          sumY += lum;
          sumCb += cb;
          sumCr += cr;
          count++;
        }
      }
    }

    const bgY = count > 0 ? sumY / count : 128;
    const bgCb = count > 0 ? sumCb / count : 128;
    const bgCr = count > 0 ? sumCr / count : 128;

    const maskData = new Uint8ClampedArray(px.length);
    for (let y = 0; y < fh; y++) {
      const ny = (y / fh - 0.54) / 0.46; // centered slightly lower for torso + head
      for (let x = 0; x < fw; x++) {
        const nx = (x / fw - 0.5) / 0.36;
        const radialDist = Math.sqrt(nx * nx + ny * ny);
        const prior = Math.max(0, Math.min(1, 1.32 - radialDist * 0.85));

        const i = (y * fw + x) * 4;
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

        const colorDist = Math.sqrt(
          (lum - bgY) * (lum - bgY) * 0.22 +
            (cb - bgCb) * (cb - bgCb) +
            (cr - bgCr) * (cr - bgCr)
        );
        const fgLikelihood = Math.min(1, colorDist / 38);
        const score = prior * 0.62 + fgLikelihood * 0.55;
        const alpha = Math.max(
          0,
          Math.min(255, Math.round(((score - 0.42) / 0.28) * 255))
        );

        maskData[i] = 255;
        maskData[i + 1] = 255;
        maskData[i + 2] = 255;
        maskData[i + 3] = alpha;
      }
    }

    let cached = maskCache.get(key);
    if (!cached) {
      cached = document.createElement('canvas');
      maskCache.set(key, cached);
    }
    if (cached.width !== fw || cached.height !== fh) {
      cached.width = fw;
      cached.height = fh;
    }
    const mctx = cached.getContext('2d');
    if (mctx) {
      mctx.putImageData(new ImageData(maskData, fw, fh), 0, 0);
    }
    return cached;
  } catch {
    return maskCache.get(key) ?? null;
  }
}

const internalScratch = new Map<string, HTMLCanvasElement>();
function getScratchCanvasInternal(name: string): HTMLCanvasElement {
  let c = internalScratch.get(name);
  if (!c) {
    c = document.createElement('canvas');
    internalScratch.set(name, c);
  }
  return c;
}

function runSegmentationInternal(
  key: string,
  source: SegmentationSource
): Promise<HTMLCanvasElement | null> {
  const {w, h} = getSourceDimensions(source);
  if (w <= 0 || h <= 0 || !inputCanvas) {
    return Promise.resolve(null);
  }

  if (mediaPipeUnavailable) {
    return Promise.resolve(buildCanvasFallbackMask(key, source, w, h));
  }

  const task = queueTail.then(async () => {
    isBusy = true;
    try {
      const seg = await getSegmenter();
      const maxDim = 512;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const sw = Math.max(16, Math.round(w * scale));
      const sh = Math.max(16, Math.round(h * scale));

      if (inputCanvas.width !== sw || inputCanvas.height !== sh) {
        inputCanvas.width = sw;
        inputCanvas.height = sh;
      }
      const ictx = inputCanvas.getContext('2d');
      if (!ictx) return buildCanvasFallbackMask(key, source, w, h);
      ictx.clearRect(0, 0, sw, sh);
      ictx.drawImage(source, 0, 0, sw, sh);

      const maskSource = await new Promise<CanvasImageSource>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingResolve = null;
          reject(new Error('Segmentation frame timeout'));
        }, 3000);
        pendingResolve = (mask) => {
          window.clearTimeout(timer);
          resolve(mask);
        };
        void seg.send({image: inputCanvas}).catch((err) => {
          window.clearTimeout(timer);
          pendingResolve = null;
          reject(err);
        });
      });

      let cached = maskCache.get(key);
      if (!cached) {
        cached = document.createElement('canvas');
        maskCache.set(key, cached);
      }
      if (cached.width !== sw || cached.height !== sh) {
        cached.width = sw;
        cached.height = sh;
      }
      const mctx = cached.getContext('2d');
      if (mctx) {
        mctx.clearRect(0, 0, sw, sh);
        mctx.drawImage(maskSource, 0, 0, sw, sh);
      }
      return cached;
    } catch {
      return buildCanvasFallbackMask(key, source, w, h);
    } finally {
      isBusy = false;
      const notify = pendingNotifyAfterBusy;
      pendingNotifyAfterBusy = null;
      if (notify) {
        window.setTimeout(notify, 0);
      }
    }
  });

  queueTail = task.then(
    () => undefined,
    () => undefined
  );

  return task;
}

/**
 * Non-blocking mask fetch for 60fps real-time preview.
 * Returns the latest cached mask immediately and triggers a background update if idle.
 */
export function getCachedMaskOrSchedule(
  key: string,
  source: SegmentationSource,
  onUpdated?: () => void
): HTMLCanvasElement | null {
  const now = performance.now();
  const last = lastRequestStamp.get(key) ?? 0;

  if (mediaPipeUnavailable) {
    if (now - last > 32) {
      lastRequestStamp.set(key, now);
      const {w, h} = getSourceDimensions(source);
      return buildCanvasFallbackMask(key, source, w, h);
    }
    return maskCache.get(key) ?? null;
  }

  if (isBusy) {
    if (onUpdated) {
      pendingNotifyAfterBusy = onUpdated;
    }
    return maskCache.get(key) ?? null;
  }

  if (now - last > 24) {
    lastRequestStamp.set(key, now);
    void runSegmentationInternal(key, source).then((mask) => {
      if (mask && onUpdated) {
        onUpdated();
      }
    });
  }

  return maskCache.get(key) ?? null;
}

/**
 * Frame-accurate awaited segmentation used during final video export.
 */
export async function segmentFrameForExport(
  key: string,
  source: SegmentationSource
): Promise<HTMLCanvasElement | null> {
  return runSegmentationInternal(key, source);
}

export function clearMaskCache(key?: string) {
  if (key) {
    maskCache.delete(key);
    lastRequestStamp.delete(key);
  } else {
    maskCache.clear();
    lastRequestStamp.clear();
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return [r || 0, g || 0, b || 0];
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return [
      Number.isFinite(r) ? r : 0,
      Number.isFinite(g) ? g : 255,
      Number.isFinite(b) ? b : 0,
    ];
  }
  return [0, 255, 0];
}

function rgbToCbCr(r: number, g: number, b: number): [number, number] {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return [cb, cr];
}

/**
 * Applies YCbCr chroma keying with smooth edge alpha and spill suppression onto outCanvas.
 */
export function applyChromaKeyToCanvas(
  source: SegmentationSource,
  outCanvas: HTMLCanvasElement,
  keyColorHex: string,
  similarity: number,
  smoothness: number,
  maxWidth = 720
): void {
  const {w, h} = getSourceDimensions(source);
  if (w <= 0 || h <= 0) return;

  const scale = Math.min(1, maxWidth / Math.max(w, h));
  const pw = Math.max(8, Math.round(w * scale));
  const ph = Math.max(8, Math.round(h * scale));

  if (outCanvas.width !== pw || outCanvas.height !== ph) {
    outCanvas.width = pw;
    outCanvas.height = ph;
  }

  const ctx = outCanvas.getContext('2d', {willReadFrequently: true});
  if (!ctx) return;

  ctx.clearRect(0, 0, pw, ph);
  ctx.drawImage(source, 0, 0, pw, ph);

  try {
    const imgData = ctx.getImageData(0, 0, pw, ph);
    const data = imgData.data;

    const [kr, kg, kb] = hexToRgb(keyColorHex);
    const [keyCb, keyCr] = rgbToCbCr(kr, kg, kb);
    const isGreenish = kg > kr && kg > kb;

    // Map normalized similarity/smoothness to CbCr distance space (0..180)
    const simDist = similarity * 145;
    const smoothDist = Math.max(2, smoothness * 145);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

      const dCb = cb - keyCb;
      const dCr = cr - keyCr;
      const dist = Math.sqrt(dCb * dCb + dCr * dCr);

      if (dist < simDist) {
        data[i + 3] = 0;
      } else if (dist < simDist + smoothDist) {
        const alphaFactor = (dist - simDist) / smoothDist;
        data[i + 3] = Math.round(data[i + 3] * alphaFactor);
        if (isGreenish && g > Math.max(r, b)) {
          data[i + 1] = Math.round(
            g * alphaFactor + Math.max(r, b) * (1 - alphaFactor)
          );
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  } catch {
    // Keep drawn source frame if pixel access is blocked
  }
}

/**
 * Composites source with a grayscale/alpha segmentation mask onto outCanvas.
 */
export function applyMaskToCanvas(
  source: SegmentationSource,
  maskCanvas: HTMLCanvasElement,
  outCanvas: HTMLCanvasElement,
  maskBlur = 1.5,
  maxWidth = 960
): void {
  const {w, h} = getSourceDimensions(source);
  if (w <= 0 || h <= 0) return;

  const scale = Math.min(1, maxWidth / Math.max(w, h));
  const pw = Math.max(8, Math.round(w * scale));
  const ph = Math.max(8, Math.round(h * scale));

  if (outCanvas.width !== pw || outCanvas.height !== ph) {
    outCanvas.width = pw;
    outCanvas.height = ph;
  }

  const ctx = outCanvas.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.clearRect(0, 0, pw, ph);
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.drawImage(source, 0, 0, pw, ph);

  ctx.globalCompositeOperation = 'destination-in';
  ctx.filter = maskBlur > 0 ? `blur(${maskBlur}px)` : 'none';
  ctx.drawImage(maskCanvas, 0, 0, pw, ph);
  ctx.restore();
}
