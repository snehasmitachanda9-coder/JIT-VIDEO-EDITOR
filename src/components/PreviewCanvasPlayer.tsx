import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Film,
  Layers,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AspectRatioPreset,
  AudioSettings,
  BackgroundRemovalConfig,
  OverlayLayerItem,
  TextOverlayItem,
  TimelineAudioClip,
  TimelineVideoClip,
  VideoFilters,
  VideoFitMode,
} from '../types/editor';
import {
  ASPECT_RATIO_DIMENSIONS,
  renderEditorFrame,
  type MediaSourceElement,
  type OverlayLayerBounds,
  type TextOverlayBounds,
} from '../utils/canvasRenderer';
import {formatTime} from '../utils/formatTime';
import {
  computeVideoTimelineSegments,
  findActiveVideoSegment,
  getAudioClipDuration,
} from '../utils/timelineMath';

interface PreviewCanvasPlayerProps {
  videoClips: TimelineVideoClip[];
  overlayLayers: OverlayLayerItem[];
  audioClips: TimelineAudioClip[];
  textOverlays: TextOverlayItem[];
  selectedOverlayId: string | null;
  selectedTextId: string | null;
  aspectRatio: AspectRatioPreset;
  fitMode: VideoFitMode;
  filters: VideoFilters;
  mainBgRemoval: BackgroundRemovalConfig;
  audioSettings: AudioSettings;
  currentTime: number;
  totalDuration: number;
  isPlaying: boolean;
  isFullPreview: boolean;
  onToggleFullPreview: () => void;
  onAspectRatioChange: (ratio: AspectRatioPreset) => void;
  onFitModeChange: (mode: VideoFitMode) => void;
  onTimeChange: (time: number) => void;
  onPlayStateChange: (playing: boolean) => void;
  onSelectOverlay: (id: string) => void;
  onUpdateOverlay: (id: string, patch: Partial<OverlayLayerItem>) => void;
  onDeleteOverlay: (id: string) => void;
  onOpenBgRemoveForOverlay: (id: string) => void;
  onSelectTextOverlay: (id: string) => void;
  onMoveTextOverlay: (id: string, x: number, y: number) => void;
  onOpenUpload: () => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const ASPECT_OPTIONS: Array<{
  value: AspectRatioPreset;
  label: string;
  tag: string;
}> = [
  {value: '16:9', label: '16:9', tag: 'YouTube'},
  {value: '9:16', label: '9:16', tag: 'Reels'},
  {value: '1:1', label: '1:1', tag: 'Square'},
];

type CanvasDragState =
  | {
      kind: 'text';
      id: string;
      offsetX: number;
      offsetY: number;
    }
  | {
      kind: 'overlay-move';
      id: string;
      offsetX: number;
      offsetY: number;
    }
  | {
      kind: 'overlay-resize';
      id: string;
      centerX: number;
    };

export function PreviewCanvasPlayer({
  videoClips,
  overlayLayers,
  audioClips,
  textOverlays,
  selectedOverlayId,
  selectedTextId,
  aspectRatio,
  fitMode,
  filters,
  mainBgRemoval,
  audioSettings,
  currentTime,
  totalDuration,
  isPlaying,
  isFullPreview,
  onToggleFullPreview,
  onAspectRatioChange,
  onFitModeChange,
  onTimeChange,
  onPlayStateChange,
  onSelectOverlay,
  onUpdateOverlay,
  onDeleteOverlay,
  onOpenBgRemoveForOverlay,
  onSelectTextOverlay,
  onMoveTextOverlay,
  onOpenUpload,
  canvasRef,
}: PreviewCanvasPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const overlayElementsRef = useRef<Map<string, MediaSourceElement>>(new Map());
  const bgReplacementElRef = useRef<MediaSourceElement | null>(null);
  const textBoundsRef = useRef<TextOverlayBounds[]>([]);
  const overlayBoundsRef = useRef<OverlayLayerBounds[]>([]);
  const dragStateRef = useRef<CanvasDragState | null>(null);

  const [renderTick, setRenderTick] = useState(0);
  const [stageSize, setStageSize] = useState<{width: number; height: number}>({
    width: 640,
    height: 360,
  });

  const targetDims = ASPECT_RATIO_DIMENSIONS[aspectRatio];

  const videoSegments = useMemo(
    () => computeVideoTimelineSegments(videoClips, audioSettings.playbackSpeed),
    [videoClips, audioSettings.playbackSpeed]
  );

  const activeSegment = useMemo(
    () => findActiveVideoSegment(videoSegments, currentTime),
    [videoSegments, currentTime]
  );

  const selectedOverlay = useMemo(
    () => overlayLayers.find((o) => o.id === selectedOverlayId) ?? null,
    [overlayLayers, selectedOverlayId]
  );

  // Measure available stage container dynamically
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const pad = 16;
      const availW = Math.max(160, rect.width - pad);
      const availH = Math.max(140, rect.height - pad);
      const ratio = targetDims.width / targetDims.height;

      let w = availW;
      let h = w / ratio;
      if (h > availH) {
        h = availH;
        w = h * ratio;
      }
      setStageSize({width: Math.round(w), height: Math.round(h)});
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [targetDims.width, targetDims.height, isFullPreview]);

  // Manage DOM media elements for all Overlay / PIP layers
  useEffect(() => {
    const map = overlayElementsRef.current;
    const activeIds = new Set(overlayLayers.map((l) => l.id));

    for (const [id, el] of map.entries()) {
      if (!activeIds.has(id)) {
        if (el instanceof HTMLVideoElement) {
          el.pause();
          el.removeAttribute('src');
          el.load();
        }
        map.delete(id);
      }
    }

    for (const layer of overlayLayers) {
      if (map.has(layer.id)) continue;
      if (layer.kind === 'image') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => setRenderTick((t) => t + 1);
        img.src = layer.url;
        map.set(layer.id, img);
      } else {
        const vid = document.createElement('video');
        vid.crossOrigin = 'anonymous';
        vid.playsInline = true;
        vid.muted = true;
        vid.preload = 'auto';
        vid.onloadeddata = () => setRenderTick((t) => t + 1);
        vid.onseeked = () => setRenderTick((t) => t + 1);
        vid.src = layer.url;
        map.set(layer.id, vid);
      }
    }
  }, [overlayLayers]);

  // Manage custom background replacement image/video element
  useEffect(() => {
    const prev = bgReplacementElRef.current;
    if (prev instanceof HTMLVideoElement) {
      prev.pause();
      prev.removeAttribute('src');
      prev.load();
    }
    bgReplacementElRef.current = null;

    if (
      mainBgRemoval.mode === 'none' ||
      !mainBgRemoval.replacementAssetUrl ||
      (mainBgRemoval.replacementType !== 'image' &&
        mainBgRemoval.replacementType !== 'video')
    ) {
      return;
    }

    if (mainBgRemoval.replacementType === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => setRenderTick((t) => t + 1);
      img.src = mainBgRemoval.replacementAssetUrl;
      bgReplacementElRef.current = img;
    } else {
      const vid = document.createElement('video');
      vid.crossOrigin = 'anonymous';
      vid.playsInline = true;
      vid.loop = true;
      vid.muted = true;
      vid.onloadeddata = () => setRenderTick((t) => t + 1);
      vid.src = mainBgRemoval.replacementAssetUrl;
      bgReplacementElRef.current = vid;
    }
  }, [
    mainBgRemoval.mode,
    mainBgRemoval.replacementType,
    mainBgRemoval.replacementAssetUrl,
  ]);

  // Keep volume & playback rate updated
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = audioSettings.videoMuted;
    video.volume = audioSettings.videoMuted ? 0 : audioSettings.videoVolume;
    video.playbackRate = audioSettings.playbackSpeed;
  }, [
    audioSettings.videoMuted,
    audioSettings.videoVolume,
    audioSettings.playbackSpeed,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = audioSettings.musicMuted;
    audio.volume = audioSettings.musicMuted ? 0 : audioSettings.musicVolume;
  }, [audioSettings.musicMuted, audioSettings.musicVolume]);

  const drawCurrentFrame = useCallback(
    (timeToDraw: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const seg = findActiveVideoSegment(videoSegments, timeToDraw);
      const result = renderEditorFrame({
        ctx,
        canvasWidth: targetDims.width,
        canvasHeight: targetDims.height,
        video: videoRef.current,
        hasActiveVideo: Boolean(seg),
        fitMode,
        filters,
        mainBgRemoval,
        mainBgReplacementEl: bgReplacementElRef.current,
        overlayLayers,
        overlayElementsMap: overlayElementsRef.current,
        textOverlays,
        currentTime: timeToDraw,
        selectedOverlayId,
        selectedTextId,
        showSelectionBox: !isPlaying,
        onMaskUpdated: () => setRenderTick((t) => t + 1),
      });
      textBoundsRef.current = result.textBounds;
      overlayBoundsRef.current = result.overlayBounds;
    },
    [
      canvasRef,
      videoSegments,
      targetDims.width,
      targetDims.height,
      fitMode,
      filters,
      mainBgRemoval,
      overlayLayers,
      textOverlays,
      selectedOverlayId,
      selectedTextId,
      isPlaying,
    ]
  );

  // Sync overlay videos when paused or playing
  const syncOverlayVideos = useCallback(
    (timelineTime: number, playing: boolean) => {
      for (const layer of overlayLayers) {
        if (layer.kind !== 'video') continue;
        const vid = overlayElementsRef.current.get(layer.id);
        if (!(vid instanceof HTMLVideoElement)) continue;

        const active =
          timelineTime >= layer.startTime && timelineTime <= layer.endTime;
        if (!active) {
          if (!vid.paused) vid.pause();
          continue;
        }

        const targetOffset =
          layer.sourceTrimStart + (timelineTime - layer.startTime);
        const safeTime =
          layer.sourceDuration > 0
            ? targetOffset % layer.sourceDuration
            : targetOffset;

        if (!playing) {
          if (!vid.paused) vid.pause();
          if (Math.abs(vid.currentTime - safeTime) > 0.08) {
            try {
              vid.currentTime = safeTime;
            } catch {
              // ignore
            }
          }
        } else {
          if (Math.abs(vid.currentTime - safeTime) > 0.25) {
            try {
              vid.currentTime = safeTime;
            } catch {
              // ignore
            }
          }
          if (vid.paused) {
            void vid.play().catch(() => {});
          }
        }
      }

      const bgEl = bgReplacementElRef.current;
      if (bgEl instanceof HTMLVideoElement) {
        if (playing && bgEl.paused) {
          void bgEl.play().catch(() => {});
        } else if (!playing && !bgEl.paused) {
          bgEl.pause();
        }
      }
    },
    [overlayLayers]
  );

  // Sync hidden main <video> source & seek position
  const activeClipUrl = activeSegment?.clip.url ?? null;
  const activeClipId = activeSegment?.clip.id ?? null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!activeSegment || !activeClipUrl) {
      video.pause();
      if (video.getAttribute('src')) {
        video.removeAttribute('src');
        video.load();
      }
      syncOverlayVideos(currentTime, isPlaying);
      drawCurrentFrame(currentTime);
      return;
    }

    const expectedSourceTime =
      activeSegment.clip.trimStart +
      Math.max(0, currentTime - activeSegment.timelineStart) *
        audioSettings.playbackSpeed;

    const currentSrcAttr = video.getAttribute('data-clip-url');
    if (currentSrcAttr !== activeClipUrl) {
      video.setAttribute('data-clip-url', activeClipUrl);
      video.src = activeClipUrl;
      video.playbackRate = audioSettings.playbackSpeed;
      const onReady = () => {
        try {
          video.currentTime = Math.min(
            activeSegment.clip.trimEnd,
            Math.max(activeSegment.clip.trimStart, expectedSourceTime)
          );
        } catch {
          // ignore
        }
        if (isPlaying) {
          void video.play().catch(() => {});
        }
      };
      video.addEventListener('loadedmetadata', onReady, {once: true});
    } else if (!isPlaying) {
      if (Math.abs(video.currentTime - expectedSourceTime) > 0.05) {
        try {
          video.currentTime = Math.min(
            activeSegment.clip.trimEnd,
            Math.max(activeSegment.clip.trimStart, expectedSourceTime)
          );
        } catch {
          // ignore
        }
      }
      syncOverlayVideos(currentTime, false);
      drawCurrentFrame(currentTime);
    }
  }, [
    activeClipId,
    activeClipUrl,
    activeSegment,
    audioSettings.playbackSpeed,
    currentTime,
    drawCurrentFrame,
    isPlaying,
    syncOverlayVideos,
  ]);

  useEffect(() => {
    if (!isPlaying) {
      drawCurrentFrame(currentTime);
    }
  }, [isPlaying, currentTime, renderTick, drawCurrentFrame]);

  const syncAudioAtTime = useCallback(
    (timelineTime: number, playing: boolean) => {
      const audio = audioRef.current;
      if (!audio) return;

      const matching = audioClips.find((ac) => {
        const dur = getAudioClipDuration(ac);
        return (
          timelineTime >= ac.startTime && timelineTime < ac.startTime + dur
        );
      });

      if (!playing || !matching) {
        if (!audio.paused) audio.pause();
        return;
      }

      const targetTime =
        matching.trimStart + (timelineTime - matching.startTime);

      if (audio.getAttribute('data-audio-url') !== matching.url) {
        audio.setAttribute('data-audio-url', matching.url);
        audio.src = matching.url;
        audio.addEventListener(
          'loadedmetadata',
          () => {
            audio.currentTime = targetTime;
            void audio.play().catch(() => {});
          },
          {once: true}
        );
      } else {
        if (Math.abs(audio.currentTime - targetTime) > 0.25) {
          audio.currentTime = targetTime;
        }
        if (audio.paused) {
          void audio.play().catch(() => {});
        }
      }
    },
    [audioClips]
  );

  useEffect(() => {
    if (!isPlaying) {
      const video = videoRef.current;
      const audio = audioRef.current;
      if (video && !video.paused) video.pause();
      if (audio && !audio.paused) audio.pause();
      syncOverlayVideos(currentTime, false);
    }
  }, [isPlaying, currentTime, syncOverlayVideos]);

  const playTimeRef = useRef(currentTime);
  playTimeRef.current = currentTime;

  useEffect(() => {
    if (!isPlaying) return;
    if (totalDuration <= 0) {
      onPlayStateChange(false);
      return;
    }

    let rafId = 0;
    let lastStamp = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - lastStamp) / 1000));
      lastStamp = now;

      const video = videoRef.current;
      const currentSeg = findActiveVideoSegment(
        videoSegments,
        playTimeRef.current
      );

      let nextTime = playTimeRef.current + dt;

      if (
        currentSeg &&
        video &&
        video.getAttribute('data-clip-url') === currentSeg.clip.url &&
        video.readyState >= 2
      ) {
        if (video.paused && !video.ended) {
          const expectedSource =
            currentSeg.clip.trimStart +
            Math.max(0, playTimeRef.current - currentSeg.timelineStart) *
              audioSettings.playbackSpeed;
          if (Math.abs(video.currentTime - expectedSource) > 0.12) {
            video.currentTime = expectedSource;
          }
          void video.play().catch(() => {});
        }

        const elapsedInClip =
          Math.max(0, video.currentTime - currentSeg.clip.trimStart) /
          audioSettings.playbackSpeed;
        const videoDerivedTime = currentSeg.timelineStart + elapsedInClip;

        if (
          video.currentTime >= currentSeg.clip.trimEnd - 0.03 ||
          video.ended
        ) {
          nextTime = currentSeg.timelineEnd + 0.005;
        } else {
          nextTime = Math.max(playTimeRef.current, videoDerivedTime);
        }
      } else if (video && !video.paused) {
        video.pause();
      }

      if (nextTime >= totalDuration) {
        playTimeRef.current = totalDuration;
        onTimeChange(totalDuration);
        syncOverlayVideos(totalDuration, false);
        drawCurrentFrame(totalDuration);
        syncAudioAtTime(totalDuration, false);
        if (video && !video.paused) video.pause();
        onPlayStateChange(false);
        return;
      }

      playTimeRef.current = nextTime;
      onTimeChange(nextTime);
      syncOverlayVideos(nextTime, true);
      drawCurrentFrame(nextTime);
      syncAudioAtTime(nextTime, true);

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    isPlaying,
    totalDuration,
    videoSegments,
    audioSettings.playbackSpeed,
    drawCurrentFrame,
    onTimeChange,
    onPlayStateChange,
    syncAudioAtTime,
    syncOverlayVideos,
  ]);

  const handleTogglePlay = () => {
    if (totalDuration <= 0) return;
    if (!isPlaying && currentTime >= totalDuration - 0.05) {
      onTimeChange(0);
    }
    onPlayStateChange(!isPlaying);
  };

  const handleSeekInput = (event: ChangeEvent<HTMLInputElement>) => {
    const val = Number(event.target.value);
    if (Number.isFinite(val)) {
      onTimeChange(val);
    }
  };

  // Canvas Pointer Drag & Resize for Text + Overlay PIP Layers
  const getCanvasPoint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * targetDims.width,
      y: ((e.clientY - rect.top) / rect.height) * targetDims.height,
    };
  };

  const handleCanvasPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const pt = getCanvasPoint(e);
    if (!pt) return;

    // 1. Check selected overlay bottom-right resize handle
    if (selectedOverlayId) {
      const selBounds = overlayBoundsRef.current.find(
        (b) => b.id === selectedOverlayId
      );
      if (selBounds) {
        const dx = Math.abs(pt.x - selBounds.handleX);
        const dy = Math.abs(pt.y - selBounds.handleY);
        if (dx <= selBounds.handleSize && dy <= selBounds.handleSize) {
          const layer = overlayLayers.find((l) => l.id === selectedOverlayId);
          if (layer) {
            dragStateRef.current = {
              kind: 'overlay-resize',
              id: layer.id,
              centerX: layer.x * targetDims.width,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
          }
        }
      }
    }

    // 2. Check Text Overlays (topmost)
    for (let i = textBoundsRef.current.length - 1; i >= 0; i--) {
      const b = textBoundsRef.current[i];
      if (
        pt.x >= b.left &&
        pt.x <= b.left + b.width &&
        pt.y >= b.top &&
        pt.y <= b.top + b.height
      ) {
        const txt = textOverlays.find((o) => o.id === b.id);
        if (!txt) continue;
        onSelectTextOverlay(txt.id);
        dragStateRef.current = {
          kind: 'text',
          id: txt.id,
          offsetX: pt.x / targetDims.width - txt.x,
          offsetY: pt.y / targetDims.height - txt.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }

    // 3. Check Overlay / PIP Layers (topmost)
    for (let i = overlayBoundsRef.current.length - 1; i >= 0; i--) {
      const b = overlayBoundsRef.current[i];
      if (
        pt.x >= b.left &&
        pt.x <= b.left + b.width &&
        pt.y >= b.top &&
        pt.y <= b.top + b.height
      ) {
        const layer = overlayLayers.find((l) => l.id === b.id);
        if (!layer) continue;
        onSelectOverlay(layer.id);
        dragStateRef.current = {
          kind: 'overlay-move',
          id: layer.id,
          offsetX: pt.x / targetDims.width - layer.x,
          offsetY: pt.y / targetDims.height - layer.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }
  };

  const handleCanvasPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const pt = getCanvasPoint(e);
    if (!pt) return;

    if (drag.kind === 'text') {
      const nextX = Math.min(0.96, Math.max(0.04, pt.x / targetDims.width - drag.offsetX));
      const nextY = Math.min(0.96, Math.max(0.04, pt.y / targetDims.height - drag.offsetY));
      onMoveTextOverlay(drag.id, nextX, nextY);
    } else if (drag.kind === 'overlay-move') {
      const nextX = Math.min(0.96, Math.max(0.04, pt.x / targetDims.width - drag.offsetX));
      const nextY = Math.min(0.96, Math.max(0.04, pt.y / targetDims.height - drag.offsetY));
      onUpdateOverlay(drag.id, {x: nextX, y: nextY});
    } else if (drag.kind === 'overlay-resize') {
      const halfW = Math.max(24, pt.x - drag.centerX);
      const nextWidthNorm = Math.min(
        1,
        Math.max(0.08, (halfW * 2) / targetDims.width)
      );
      onUpdateOverlay(drag.id, {width: nextWidthNorm});
    }
  };

  const handleCanvasPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragStateRef.current) {
      dragStateRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const progressPercent =
    totalDuration > 0
      ? Math.min(100, Math.max(0, (currentTime / totalDuration) * 100))
      : 0;

  return (
    <section
      aria-label="Preview Player"
      className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#090B0E]"
    >
      {/* Top Aspect Ratio Switcher + Full Preview Bar */}
      <div className="h-10 shrink-0 border-b border-zinc-800/80 bg-[#101319] px-3 flex items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Aspect Ratio"
          className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#090B0E] border border-zinc-800/80"
        >
          {ASPECT_OPTIONS.map((opt) => {
            const active = aspectRatio === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onAspectRatioChange(opt.value)}
                aria-pressed={active}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {opt.label}
                <span
                  className={`hidden md:inline ml-1 text-[10px] ${
                    active ? 'text-blue-100' : 'text-zinc-500'
                  }`}
                >
                  {opt.tag}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Video Scaling"
            className="hidden sm:flex items-center gap-0.5 p-0.5 rounded-md bg-[#090B0E] border border-zinc-800/80"
          >
            <button
              type="button"
              onClick={() => onFitModeChange('contain')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                fitMode === 'contain'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Fit
            </button>
            <button
              type="button"
              onClick={() => onFitModeChange('cover')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                fitMode === 'cover'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Fill
            </button>
          </div>

          <span className="hidden lg:inline text-[11px] font-mono tabular-nums text-zinc-400 whitespace-nowrap">
            {targetDims.width}×{targetDims.height}
          </span>

          <button
            type="button"
            onClick={onToggleFullPreview}
            title={
              isFullPreview
                ? 'Exit Full Preview (Esc)'
                : 'Expand to Full Preview'
            }
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors whitespace-nowrap ${
              isFullPreview
                ? 'border-blue-500/60 bg-blue-600/20 text-blue-200'
                : 'border-zinc-700/80 bg-[#090B0E] text-zinc-300 hover:text-white hover:border-zinc-600'
            }`}
          >
            {isFullPreview ? (
              <>
                <Minimize2 className="w-3 h-3" aria-hidden="true" />
                <span>Exit Full Preview</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3 h-3" aria-hidden="true" />
                <span>Full Preview</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live HTML5 Canvas Stage */}
      <div
        ref={stageRef}
        className="flex-1 min-h-0 flex items-center justify-center p-2 overflow-hidden relative"
      >
        <video
          ref={videoRef}
          className="hidden"
          playsInline
          onLoadedData={() => {
            if (!isPlaying) drawCurrentFrame(currentTime);
          }}
          onSeeked={() => {
            if (!isPlaying) drawCurrentFrame(currentTime);
          }}
        />
        <audio ref={audioRef} className="hidden" />

        {videoClips.length === 0 &&
        overlayLayers.length === 0 &&
        textOverlays.length === 0 ? (
          <div className="max-w-sm w-full rounded-xl border border-zinc-800/80 bg-[#12151B]/95 px-6 py-7 text-center">
            <div className="mx-auto w-10 h-10 rounded-lg bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center text-zinc-300 mb-3.5">
              <Film className="w-5 h-5" aria-hidden="true" />
            </div>
            <h2 className="text-sm font-semibold text-zinc-100">
              Timeline is empty
            </h2>
            <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
              Upload MP4/WebM videos or PNG/JPG/WebP images in the Media Upload
              panel to get started.
            </p>
            <button
              type="button"
              onClick={onOpenUpload}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Upload Media</span>
            </button>
          </div>
        ) : (
          <div
            className="relative rounded-md overflow-hidden border border-zinc-800 bg-black shadow-2xl flex items-center justify-center"
            style={{
              width: stageSize.width,
              height: stageSize.height,
            }}
          >
            <canvas
              ref={canvasRef}
              width={targetDims.width}
              height={targetDims.height}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
              className="w-full h-full block touch-none cursor-default"
            />
          </div>
        )}
      </div>

      {/* Selected Overlay / PIP Properties Bar */}
      {selectedOverlay && !isFullPreview && (
        <div className="shrink-0 border-t border-zinc-800/80 bg-[#10141B] px-3 py-1.5 flex flex-wrap items-center justify-between gap-3 text-[11px]">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
            <span className="font-medium text-zinc-200 truncate max-w-[140px]">
              {selectedOverlay.name}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-zinc-400">
              <span>Opacity</span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={selectedOverlay.opacity}
                onChange={(e) =>
                  onUpdateOverlay(selectedOverlay.id, {
                    opacity: Number(e.target.value),
                  })
                }
                className="w-16 accent-sky-400 cursor-pointer"
              />
              <span className="font-mono tabular-nums text-zinc-300 w-8">
                {Math.round(selectedOverlay.opacity * 100)}%
              </span>
            </label>

            <label className="inline-flex items-center gap-1.5 text-zinc-400">
              <span>Size</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.02}
                value={selectedOverlay.width}
                onChange={(e) =>
                  onUpdateOverlay(selectedOverlay.id, {
                    width: Number(e.target.value),
                  })
                }
                className="w-16 accent-sky-400 cursor-pointer"
              />
              <span className="font-mono tabular-nums text-zinc-300 w-8">
                {Math.round(selectedOverlay.width * 100)}%
              </span>
            </label>

            <div className="inline-flex items-center gap-1 text-zinc-400">
              <span>Start</span>
              <input
                type="number"
                min={0}
                max={Math.max(0, selectedOverlay.endTime - 0.2)}
                step={0.1}
                value={Number(selectedOverlay.startTime.toFixed(1))}
                onChange={(e) =>
                  onUpdateOverlay(selectedOverlay.id, {
                    startTime: Math.max(
                      0,
                      Math.min(
                        selectedOverlay.endTime - 0.2,
                        Number(e.target.value)
                      )
                    ),
                  })
                }
                className="w-12 rounded border border-zinc-700 bg-[#090B0E] px-1.5 py-0.5 text-[11px] font-mono tabular-nums text-zinc-200"
              />
              <span>End</span>
              <input
                type="number"
                min={selectedOverlay.startTime + 0.2}
                step={0.1}
                value={Number(selectedOverlay.endTime.toFixed(1))}
                onChange={(e) =>
                  onUpdateOverlay(selectedOverlay.id, {
                    endTime: Math.max(
                      selectedOverlay.startTime + 0.2,
                      Number(e.target.value)
                    ),
                  })
                }
                className="w-12 rounded border border-zinc-700 bg-[#090B0E] px-1.5 py-0.5 text-[11px] font-mono tabular-nums text-zinc-200"
              />
            </div>

            <button
              type="button"
              onClick={() => onOpenBgRemoveForOverlay(selectedOverlay.id)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 font-medium"
            >
              <Scissors className="w-3 h-3" aria-hidden="true" />
              <span>BG Remove</span>
            </button>

            <button
              type="button"
              onClick={() => onDeleteOverlay(selectedOverlay.id)}
              aria-label="Delete selected overlay"
              className="p-1 rounded text-zinc-400 hover:text-red-300 hover:bg-zinc-800"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Transport Controls */}
      <div className="shrink-0 border-t border-zinc-800/80 bg-[#12151B] px-4 py-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            onPlayStateChange(false);
            onTimeChange(0);
          }}
          disabled={totalDuration <= 0}
          aria-label="Restart from beginning"
          className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center transition-colors ${
            totalDuration > 0
              ? 'text-zinc-300 hover:text-white hover:bg-zinc-800'
              : 'text-zinc-600 cursor-not-allowed'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={handleTogglePlay}
          disabled={totalDuration <= 0}
          aria-label={isPlaying ? 'Pause video' : 'Play video'}
          className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center transition-colors duration-150 ${
            totalDuration > 0
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-zinc-800/70 text-zinc-600 cursor-not-allowed'
          }`}
        >
          {isPlaying ? (
            <Pause className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-current ml-0.5" aria-hidden="true" />
          )}
        </button>

        <div className="flex-1 flex items-center gap-2.5 min-w-0">
          <span className="text-[11px] font-mono tabular-nums text-zinc-200 whitespace-nowrap shrink-0">
            {formatTime(currentTime)}
          </span>

          <div className="relative flex-1 flex items-center">
            <div className="w-full h-1 rounded-full bg-zinc-800 overflow-hidden pointer-events-none">
              <div
                className="h-full bg-blue-500"
                style={{width: `${progressPercent}%`}}
              />
            </div>
            <input
              type="range"
              min={0}
              max={totalDuration > 0 ? totalDuration : 100}
              step={0.02}
              value={totalDuration > 0 ? Math.min(currentTime, totalDuration) : 0}
              disabled={totalDuration <= 0}
              onChange={handleSeekInput}
              aria-label="Seek timeline position"
              className="seek-slider absolute inset-0 w-full h-5 my-auto"
            />
          </div>

          <span className="text-[11px] font-mono tabular-nums text-zinc-400 whitespace-nowrap shrink-0">
            {formatTime(totalDuration)}
          </span>
        </div>
      </div>
    </section>
  );
}
