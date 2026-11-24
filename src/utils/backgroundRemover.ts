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
let pendingResolve: ((mask: CanvasImageSource) => void) | null = null;
let queueTail: Promise<void> = Promise.resolve();
let isBusy = false;

const maskCache = new Map<string, HTMLCanvasElement>();
const lastRequestStamp = new Map<string, number>();

function loadSelfieSegmentationScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window unavailable'));
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
    script.onload = () => {
      if (window.SelfieSegmentation) {
        resolve();
      } else {
        reject(new Error('SelfieSegmentation global not found after script load.'));
      }
    };
    script.onerror = () => {
      scriptLoadPromise = null;
      reject(new Error('Failed to load MediaPipe SelfieSegmentation script.'));
    };
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

async function getSegmenter(): Promise<MediaPipeSelfieSegmentation> {
  if (segmenterPromise) return segmenterPromise;

  segmenterPromise = (async () => {
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

function runSegmentationInternal(
  key: string,
  source: SegmentationSource
): Promise<HTMLCanvasElement | null> {
  const {w, h} = getSourceDimensions(source);
  if (w <= 0 || h <= 0 || !inputCanvas) {
    return Promise.resolve(null);
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
      if (!ictx) return null;
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
      return maskCache.get(key) ?? null;
    } finally {
      isBusy = false;
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

  if (!isBusy && now - last > 30) {
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
