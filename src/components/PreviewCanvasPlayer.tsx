import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
import type {ViewportLayoutMode} from '../hooks/useViewportMode';
import type {
  AspectRatioPreset,
  AudioSettings,
  BackgroundRemovalConfig,
  MotionTransform,
  OverlayLayerItem,
  TextOverlayItem,
  TimelineAudioClip,
  TimelineEffectItem,
  TimelineVideoClip,
  VideoFilters,
  VideoFitMode,
} from '../types/editor';
import {AudioEffectsGraph} from '../utils/audioEffects';
import {
  ASPECT_RATIO_DIMENSIONS,
  isMediaReady,
  renderEditorFrame,
  type MediaSourceElement,
  type OverlayLayerBounds,
  type TextOverlayBounds,
} from '../utils/canvasRenderer';
import {formatTime} from '../utils/formatTime';
import {preloadStickerImage} from '../utils/stickerRenderer';
import {
  computeVideoTimelineSegments,
  getAudioClipDuration,
  getSpeedRampMultiplierAtTime,
  resolveSegmentSourceTime,
  resolveVideoStateAtTime,
  type ComputedVideoSegment,
} from '../utils/timelineMath';

interface PreviewCanvasPlayerProps {
  videoClips: TimelineVideoClip[];
  effectItems: TimelineEffectItem[];
  overlayLayers: OverlayLayerItem[];
  audioClips: TimelineAudioClip[];
  textOverlays: TextOverlayItem[];
  selectedOverlayId: string | null;
  selectedTextId: string | null;
  aspectRatio: AspectRatioPreset;
  fitMode: VideoFitMode;
  filters: VideoFilters;
  motionTransform: MotionTransform;
  mainBgRemoval: BackgroundRemovalConfig;
  audioSettings: AudioSettings;
  beatTimes?: number[];
  currentTime: number;
  totalDuration: number;
  isPlaying: boolean;
  isFullPreview: boolean;
  layoutMode?: ViewportLayoutMode;
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
  captureRawFrameRef: React.MutableRefObject<(() => string | null) | null>;
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
      centerY: number;
      aspectRatio: number;
    };

export function PreviewCanvasPlayer({
  videoClips,
  effectItems,
  overlayLayers,
  audioClips,
  textOverlays,
  selectedOverlayId,
  selectedTextId,
  aspectRatio,
  fitMode,
  filters,
  motionTransform,
  mainBgRemoval,
  audioSettings,
  beatTimes = [],
  currentTime,
  totalDuration,
  isPlaying,
  isFullPreview,
  layoutMode = 'desktop',
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
  captureRawFrameRef,
}: PreviewCanvasPlayerProps) {
  const videoRefA = useRef<HTMLVideoElement | null>(null);
  const videoRefB = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const audioGraphRef = useRef<AudioEffectsGraph | null>(null);
  const videoAudioConnectedRef = useRef(false);
  const audioPoolRef = useRef<
    Map<
      string,
      {
        el: HTMLAudioElement;
        url: string;
        connected: boolean;
        gainNode: GainNode | null;
        clipVolume: number;
      }
    >
  >(new Map());

  const freezeImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
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
    () =>
      computeVideoTimelineSegments(
        videoClips,
        audioSettings.playbackSpeed,
        effectItems
      ),
    [videoClips, audioSettings.playbackSpeed, effectItems]
  );

  const hasSpeedRamps = useMemo(
    () => effectItems.some((e) => e.type === 'speed-ramp'),
    [effectItems]
  );

  const activeState = useMemo(
    () => resolveVideoStateAtTime(videoSegments, currentTime),
    [videoSegments, currentTime]
  );

  const selectedOverlay = useMemo(
    () => overlayLayers.find((o) => o.id === selectedOverlayId) ?? null,
    [overlayLayers, selectedOverlayId]
  );

  // Measure available stage container dynamically (synchronous layout pass for Full Preview & Aspect Ratio changes)
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const pad = layoutMode === 'desktop' ? 16 : 6;
      const availW = Math.max(120, rect.width - pad);
      const availH = Math.max(72, rect.height - pad);
      const ratio = targetDims.width / targetDims.height;

      let w = availW;
      let h = w / ratio;
      if (h > availH) {
        h = availH;
        w = h * ratio;
      }
      const nextW = Math.round(w);
      const nextH = Math.round(h);
      setStageSize((prev) =>
        prev.width === nextW && prev.height === nextH
          ? prev
          : {width: nextW, height: nextH}
      );
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [targetDims.width, targetDims.height, isFullPreview, layoutMode]);

  // Preload freeze-frame HTMLImageElements
  useEffect(() => {
    const map = freezeImagesRef.current;
    const activeIds = new Set(
      videoClips.filter((c) => c.kind === 'freeze').map((c) => c.id)
    );
    for (const id of map.keys()) {
      if (!activeIds.has(id)) map.delete(id);
    }
    for (const clip of videoClips) {
      if (clip.kind !== 'freeze' || map.has(clip.id)) continue;
      const img = new Image();
      img.onload = () => setRenderTick((t) => t + 1);
      img.src = clip.url;
      map.set(clip.id, img);
    }
  }, [videoClips]);

  // Manage DOM media elements for Overlay / PIP layers
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
      if (layer.kind === 'sticker' && layer.stickerKind) {
        void preloadStickerImage(layer.stickerKind).then((img) => {
          map.set(layer.id, img);
          setRenderTick((t) => t + 1);
        });
      } else if (layer.kind === 'image') {
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

  // Manage custom BG replacement asset
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

  const ensureAudioGraph = useCallback(() => {
    if (!audioGraphRef.current) {
      const ctx = new AudioContext();
      audioGraphRef.current = new AudioEffectsGraph(ctx, ctx.destination);
    }
    const graph = audioGraphRef.current;
    if (graph.ctx.state === 'suspended') {
      void graph.ctx.resume().catch(() => {});
    }

    const videoA = videoRefA.current;
    if (videoA && !videoAudioConnectedRef.current) {
      try {
        const src = graph.ctx.createMediaElementSource(videoA);
        src.connect(graph.videoInputGain);
        videoAudioConnectedRef.current = true;
        videoA.muted = false;
        videoA.volume = 1;
      } catch {
        // already connected or unavailable
      }
    }

    audioPoolRef.current.forEach((entry) => {
      if (!entry.connected) {
        try {
          const src = graph.ctx.createMediaElementSource(entry.el);
          const gainNode = graph.ctx.createGain();
          gainNode.gain.value = entry.clipVolume;
          src.connect(gainNode);
          gainNode.connect(graph.musicInputGain);
          entry.connected = true;
          entry.gainNode = gainNode;
          entry.el.muted = false;
          entry.el.volume = 1;
        } catch {
          // ignore
        }
      }
    });

    graph.updateVolumes({
      videoVolume: audioSettings.videoVolume,
      videoMuted: audioSettings.videoMuted,
      musicVolume: audioSettings.musicVolume,
      musicMuted: audioSettings.musicMuted,
    });
    graph.updateEffects(audioSettings.effects);
    return graph;
  }, [
    audioSettings.videoVolume,
    audioSettings.videoMuted,
    audioSettings.musicVolume,
    audioSettings.musicMuted,
    audioSettings.effects,
  ]);

  // Manage audio element pool for simultaneous Music + SFX clips
  useEffect(() => {
    const pool = audioPoolRef.current;
    const activeIds = new Set(audioClips.map((c) => c.id));

    for (const [id, entry] of pool.entries()) {
      if (!activeIds.has(id)) {
        entry.el.pause();
        entry.el.removeAttribute('src');
        entry.el.load();
        pool.delete(id);
      }
    }

    for (const clip of audioClips) {
      const clipVol = Math.max(0, Math.min(1.5, clip.volume ?? 1));
      const existing = pool.get(clip.id);
      if (!existing) {
        const el = document.createElement('audio');
        el.crossOrigin = 'anonymous';
        el.preload = 'auto';
        el.src = clip.url;
        pool.set(clip.id, {
          el,
          url: clip.url,
          connected: false,
          gainNode: null,
          clipVolume: clipVol,
        });
      } else {
        existing.clipVolume = clipVol;
        if (existing.url !== clip.url) {
          existing.url = clip.url;
          existing.el.src = clip.url;
        }
      }
    }

    if (audioGraphRef.current) {
      ensureAudioGraph();
    }

    for (const clip of audioClips) {
      const entry = pool.get(clip.id);
      if (!entry) continue;
      const clipVol = entry.clipVolume;
      if (entry.gainNode && audioGraphRef.current) {
        entry.gainNode.gain.setTargetAtTime(
          clipVol,
          audioGraphRef.current.ctx.currentTime,
          0.015
        );
      } else {
        entry.el.muted = audioSettings.musicMuted;
        entry.el.volume = audioSettings.musicMuted
          ? 0
          : Math.min(1, audioSettings.musicVolume * clipVol);
      }
    }
  }, [
    audioClips,
    audioSettings.musicMuted,
    audioSettings.musicVolume,
    ensureAudioGraph,
  ]);

  // Cleanup AudioContext & audio pool on unmount
  useEffect(() => {
    const pool = audioPoolRef.current;
    return () => {
      pool.forEach((entry) => {
        entry.el.pause();
        entry.el.removeAttribute('src');
        entry.el.load();
      });
      pool.clear();
      if (audioGraphRef.current) {
        void audioGraphRef.current.ctx.close().catch(() => {});
        audioGraphRef.current = null;
      }
    };
  }, []);

  // Volume, Audio Effects (Echo / Reverb) & playback rate
  useEffect(() => {
    const videoA = videoRefA.current;
    const videoB = videoRefB.current;
    const rampMult = getSpeedRampMultiplierAtTime(effectItems, playTimeRef.current);
    const effectiveRate = Math.max(
      0.25,
      Math.min(3, audioSettings.playbackSpeed * rampMult)
    );
    if (videoA) {
      if (Math.abs(videoA.playbackRate - effectiveRate) > 0.02) {
        videoA.playbackRate = effectiveRate;
      }
      if (!videoAudioConnectedRef.current) {
        videoA.muted = audioSettings.videoMuted;
        videoA.volume = audioSettings.videoMuted ? 0 : audioSettings.videoVolume;
      }
    }
    if (videoB) {
      videoB.muted = true;
      if (Math.abs(videoB.playbackRate - effectiveRate) > 0.02) {
        videoB.playbackRate = effectiveRate;
      }
    }
    if (audioGraphRef.current) {
      audioGraphRef.current.updateVolumes({
        videoVolume: audioSettings.videoVolume,
        videoMuted: audioSettings.videoMuted,
        musicVolume: audioSettings.musicVolume,
        musicMuted: audioSettings.musicMuted,
      });
      audioGraphRef.current.updateEffects(audioSettings.effects);
    }
  }, [
    audioSettings.videoMuted,
    audioSettings.videoVolume,
    audioSettings.musicMuted,
    audioSettings.musicVolume,
    audioSettings.playbackSpeed,
    audioSettings.effects,
    effectItems,
  ]);

  // Expose raw active video/freeze frame capture for Freeze Frame button
  useEffect(() => {
    captureRawFrameRef.current = () => {
      const seg = activeState.primary;
      if (!seg) return null;
      const src: MediaSourceElement | null =
        seg.clip.kind === 'freeze'
          ? freezeImagesRef.current.get(seg.clip.id) ?? null
          : videoRefA.current;
      if (!src || !isMediaReady(src)) return null;

      const w =
        src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
      const h =
        src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
      if (w <= 0 || h <= 0) return null;

      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d');
      if (!octx) return null;
      octx.drawImage(src, 0, 0, w, h);
      return off.toDataURL('image/png');
    };
    return () => {
      captureRawFrameRef.current = null;
    };
  }, [activeState.primary, captureRawFrameRef]);

  const resolveSegmentSource = useCallback(
    (
      seg: ComputedVideoSegment | null,
      videoEl: HTMLVideoElement | null
    ): MediaSourceElement | null => {
      if (!seg) return null;
      if (seg.clip.kind === 'freeze') {
        return freezeImagesRef.current.get(seg.clip.id) ?? null;
      }
      return videoEl;
    },
    []
  );

  const drawCurrentFrame = useCallback(
    (timeToDraw: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const state = resolveVideoStateAtTime(videoSegments, timeToDraw);
      const primarySource = resolveSegmentSource(
        state.primary,
        videoRefA.current
      );
      const outgoingSource = resolveSegmentSource(
        state.outgoing,
        videoRefB.current
      );

      const primaryClipProgress =
        state.primary && state.primary.effectiveDuration > 0
          ? (timeToDraw - state.primary.timelineStart) /
            state.primary.effectiveDuration
          : 0;
      const outgoingClipProgress =
        state.outgoing && state.outgoing.effectiveDuration > 0
          ? (timeToDraw - state.outgoing.timelineStart) /
            state.outgoing.effectiveDuration
          : 1;

      const result = renderEditorFrame({
        ctx,
        canvasWidth: targetDims.width,
        canvasHeight: targetDims.height,
        primarySource,
        primaryClipProgress,
        outgoingSource,
        outgoingClipProgress,
        transition: state.transition,
        transitionProgress: state.transitionProgress,
        fitMode,
        filters,
        motionTransform,
        mainBgRemoval,
        mainBgReplacementEl: bgReplacementElRef.current,
        effectItems,
        beatTimes,
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
      resolveSegmentSource,
      targetDims.width,
      targetDims.height,
      fitMode,
      filters,
      motionTransform,
      mainBgRemoval,
      effectItems,
      beatTimes,
      overlayLayers,
      textOverlays,
      selectedOverlayId,
      selectedTextId,
      isPlaying,
    ]
  );

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

  const syncVideoElementToSegment = useCallback(
    (
      videoEl: HTMLVideoElement | null,
      seg: ComputedVideoSegment | null,
      timelineTime: number,
      playing: boolean
    ) => {
      if (!videoEl) return;
      if (!seg || seg.clip.kind === 'freeze') {
        if (!videoEl.paused) videoEl.pause();
        if (!seg && videoEl.getAttribute('src')) {
          videoEl.removeAttribute('src');
          videoEl.removeAttribute('data-clip-url');
          videoEl.load();
        }
        return;
      }

      const expectedSourceTime = resolveSegmentSourceTime(
        seg,
        timelineTime,
        audioSettings.playbackSpeed,
        effectItems
      );
      const effectiveRate = Math.max(
        0.25,
        Math.min(
          3,
          audioSettings.playbackSpeed *
            getSpeedRampMultiplierAtTime(effectItems, timelineTime)
        )
      );
      const currentSrcAttr = videoEl.getAttribute('data-clip-url');

      if (currentSrcAttr !== seg.clip.url) {
        videoEl.setAttribute('data-clip-url', seg.clip.url);
        videoEl.src = seg.clip.url;
        videoEl.playbackRate = effectiveRate;
        const onReady = () => {
          try {
            videoEl.currentTime = Math.min(
              seg.clip.trimEnd,
              Math.max(seg.clip.trimStart, expectedSourceTime)
            );
          } catch {
            // ignore
          }
          if (playing) {
            void videoEl.play().catch(() => {});
          }
        };
        videoEl.addEventListener('loadedmetadata', onReady, {once: true});
      } else {
        if (Math.abs(videoEl.playbackRate - effectiveRate) > 0.02) {
          videoEl.playbackRate = effectiveRate;
        }
        if (!playing) {
          if (Math.abs(videoEl.currentTime - expectedSourceTime) > 0.05) {
            try {
              videoEl.currentTime = Math.min(
                seg.clip.trimEnd,
                Math.max(seg.clip.trimStart, expectedSourceTime)
              );
            } catch {
              // ignore
            }
          }
        } else if (videoEl.paused) {
          if (Math.abs(videoEl.currentTime - expectedSourceTime) > 0.15) {
            try {
              videoEl.currentTime = Math.min(
                seg.clip.trimEnd,
                Math.max(seg.clip.trimStart, expectedSourceTime)
              );
            } catch {
              // ignore
            }
          }
          if (expectedSourceTime < seg.clip.trimEnd - 0.05) {
            void videoEl.play().catch(() => {});
          }
        }
      }
    },
    [audioSettings.playbackSpeed, effectItems]
  );

  // Sync primary and outgoing video elements when paused or seeking
  useEffect(() => {
    syncVideoElementToSegment(
      videoRefA.current,
      activeState.primary,
      currentTime,
      isPlaying
    );
    syncVideoElementToSegment(
      videoRefB.current,
      activeState.outgoing,
      currentTime,
      isPlaying
    );
    if (!isPlaying) {
      syncOverlayVideos(currentTime, false);
      drawCurrentFrame(currentTime);
    }
  }, [
    activeState.primary,
    activeState.outgoing,
    currentTime,
    isPlaying,
    syncVideoElementToSegment,
    syncOverlayVideos,
    drawCurrentFrame,
  ]);

  useLayoutEffect(() => {
    drawCurrentFrame(isPlaying ? playTimeRef.current : currentTime);
  }, [isPlaying, currentTime, renderTick, drawCurrentFrame]);

  const syncAudioAtTime = useCallback(
    (timelineTime: number, playing: boolean) => {
      const pool = audioPoolRef.current;

      for (const ac of audioClips) {
        const entry = pool.get(ac.id);
        if (!entry) continue;
        const audio = entry.el;
        const dur = getAudioClipDuration(ac);
        const active =
          playing &&
          timelineTime >= ac.startTime &&
          timelineTime < ac.startTime + dur;

        if (!active) {
          if (!audio.paused) audio.pause();
          continue;
        }

        const elapsed = Math.max(0, timelineTime - ac.startTime);
        const remaining = Math.max(0, dur - elapsed);
        const fadeIn = Math.max(0, Math.min(5, ac.fadeIn ?? 0));
        const fadeOut = Math.max(0, Math.min(5, ac.fadeOut ?? 0));
        let env = 1;
        if (fadeIn > 0 && elapsed < fadeIn) env *= elapsed / fadeIn;
        if (fadeOut > 0 && remaining < fadeOut) env *= remaining / fadeOut;
        const effectiveVol =
          entry.clipVolume * Math.max(0, Math.min(1, env));

        if (entry.gainNode && audioGraphRef.current) {
          entry.gainNode.gain.setTargetAtTime(
            effectiveVol,
            audioGraphRef.current.ctx.currentTime,
            0.015
          );
        } else {
          audio.muted = audioSettings.musicMuted;
          audio.volume = audioSettings.musicMuted
            ? 0
            : Math.min(1, audioSettings.musicVolume * effectiveVol);
        }

        const targetTime = ac.trimStart + elapsed;
        if (audio.readyState < 1) {
          audio.addEventListener(
            'loadedmetadata',
            () => {
              try {
                audio.currentTime = targetTime;
              } catch {
                // ignore
              }
              void audio.play().catch(() => {});
            },
            {once: true}
          );
        } else {
          if (Math.abs(audio.currentTime - targetTime) > 0.25) {
            try {
              audio.currentTime = targetTime;
            } catch {
              // ignore
            }
          }
          if (audio.paused) {
            void audio.play().catch(() => {});
          }
        }
      }
    },
    [audioClips, audioSettings.musicMuted, audioSettings.musicVolume]
  );

  useEffect(() => {
    if (!isPlaying) {
      if (videoRefA.current && !videoRefA.current.paused) {
        videoRefA.current.pause();
      }
      if (videoRefB.current && !videoRefB.current.paused) {
        videoRefB.current.pause();
      }
      audioPoolRef.current.forEach((entry) => {
        if (!entry.el.paused) entry.el.pause();
      });
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

      const videoA = videoRefA.current;
      const state = resolveVideoStateAtTime(
        videoSegments,
        playTimeRef.current
      );
      const currentSeg = state.primary;

      let nextTime = playTimeRef.current + dt;

      if (
        currentSeg &&
        currentSeg.clip.kind === 'video' &&
        videoA &&
        videoA.getAttribute('data-clip-url') === currentSeg.clip.url &&
        videoA.readyState >= 2
      ) {
        const effectiveRate = Math.max(
          0.25,
          Math.min(
            3,
            audioSettings.playbackSpeed *
              getSpeedRampMultiplierAtTime(effectItems, playTimeRef.current)
          )
        );
        if (Math.abs(videoA.playbackRate - effectiveRate) > 0.02) {
          videoA.playbackRate = effectiveRate;
        }

        const expectedSource = resolveSegmentSourceTime(
          currentSeg,
          playTimeRef.current,
          audioSettings.playbackSpeed,
          effectItems
        );

        if (videoA.paused) {
          if (Math.abs(videoA.currentTime - expectedSource) > 0.12) {
            try {
              videoA.currentTime = Math.min(
                currentSeg.clip.trimEnd,
                Math.max(currentSeg.clip.trimStart, expectedSource)
              );
            } catch {
              // ignore
            }
          }
          if (expectedSource < currentSeg.clip.trimEnd - 0.05) {
            void videoA.play().catch(() => {});
          }
        }

        if (hasSpeedRamps) {
          const candidateTime = playTimeRef.current + dt;
          const expectedNextSource = resolveSegmentSourceTime(
            currentSeg,
            candidateTime,
            audioSettings.playbackSpeed,
            effectItems
          );
          if (
            candidateTime >= currentSeg.timelineEnd - 0.02 ||
            expectedNextSource >= currentSeg.clip.trimEnd - 0.02 ||
            videoA.ended
          ) {
            nextTime = currentSeg.timelineEnd + 0.005;
          } else {
            nextTime = candidateTime;
            if (Math.abs(videoA.currentTime - expectedNextSource) > 0.18) {
              try {
                videoA.currentTime = Math.min(
                  currentSeg.clip.trimEnd,
                  Math.max(currentSeg.clip.trimStart, expectedNextSource)
                );
              } catch {
                // ignore
              }
            }
          }
        } else {
          const elapsedInClip =
            Math.max(0, videoA.currentTime - currentSeg.clip.trimStart) /
            audioSettings.playbackSpeed;
          const videoDerivedTime = currentSeg.timelineStart + elapsedInClip;

          if (
            videoA.currentTime >= currentSeg.clip.trimEnd - 0.03 ||
            videoA.ended
          ) {
            nextTime = currentSeg.timelineEnd + 0.005;
          } else {
            nextTime = Math.max(playTimeRef.current, videoDerivedTime);
          }
        }
      } else if (videoA && !videoA.paused) {
        videoA.pause();
      }

      if (nextTime >= totalDuration) {
        playTimeRef.current = totalDuration;
        onTimeChange(totalDuration);
        syncOverlayVideos(totalDuration, false);
        drawCurrentFrame(totalDuration);
        syncAudioAtTime(totalDuration, false);
        if (videoA && !videoA.paused) videoA.pause();
        if (videoRefB.current && !videoRefB.current.paused) {
          videoRefB.current.pause();
        }
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
    effectItems,
    hasSpeedRamps,
    audioSettings.playbackSpeed,
    drawCurrentFrame,
    onTimeChange,
    onPlayStateChange,
    syncAudioAtTime,
    syncOverlayVideos,
  ]);

  const handleTogglePlay = () => {
    if (totalDuration <= 0) return;
    if (!isPlaying) {
      ensureAudioGraph();
      if (currentTime >= totalDuration - 0.05) {
        onTimeChange(0);
      }
    }
    onPlayStateChange(!isPlaying);
  };

  const handleSeekInput = (event: ChangeEvent<HTMLInputElement>) => {
    const val = Number(event.target.value);
    if (Number.isFinite(val)) {
      onTimeChange(val);
    }
  };

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
              centerY: layer.y * targetDims.height,
              aspectRatio: layer.aspectRatio > 0 ? layer.aspectRatio : 1,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
          }
        }
      }
    }

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
      const nextX = Math.min(
        0.96,
        Math.max(0.04, pt.x / targetDims.width - drag.offsetX)
      );
      const nextY = Math.min(
        0.96,
        Math.max(0.04, pt.y / targetDims.height - drag.offsetY)
      );
      onMoveTextOverlay(drag.id, nextX, nextY);
    } else if (drag.kind === 'overlay-move') {
      const nextX = Math.min(
        0.96,
        Math.max(0.04, pt.x / targetDims.width - drag.offsetX)
      );
      const nextY = Math.min(
        0.96,
        Math.max(0.04, pt.y / targetDims.height - drag.offsetY)
      );
      onUpdateOverlay(drag.id, {x: nextX, y: nextY});
    } else if (drag.kind === 'overlay-resize') {
      const halfWFromX = pt.x - drag.centerX;
      const halfWFromY = (pt.y - drag.centerY) * drag.aspectRatio;
      const halfW = Math.max(24, halfWFromX, halfWFromY);
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

  const isMobile = layoutMode !== 'desktop';

  return (
    <section
      aria-label="Preview Player"
      className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#090B0E]"
    >
      {/* Top Aspect Ratio Switcher + Full Preview Bar */}
      <div
        className={`shrink-0 border-b border-zinc-800/80 bg-[#101319] flex items-center justify-between gap-1.5 overflow-x-auto no-scrollbar ${
          isMobile ? 'h-8 px-2' : 'h-10 px-3 gap-2'
        }`}
      >
        <div
          role="group"
          aria-label="Aspect Ratio"
          className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#090B0E] border border-zinc-800/80 shrink-0"
        >
          {ASPECT_OPTIONS.map((opt) => {
            const active = aspectRatio === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onAspectRatioChange(opt.value)}
                aria-pressed={active}
                className={`rounded-md font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isMobile
                    ? 'px-1.5 py-0.5 text-[10px]'
                    : 'px-2 py-1 text-[11px]'
                } ${
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

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div
            role="group"
            aria-label="Video Scaling"
            className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#090B0E] border border-zinc-800/80 shrink-0"
          >
            <button
              type="button"
              onClick={() => onFitModeChange('contain')}
              aria-pressed={fitMode === 'contain'}
              title="Fit: Letterbox inside frame without cropping"
              className={`rounded-md font-medium transition-colors whitespace-nowrap ${
                isMobile
                  ? 'px-1.5 py-0.5 text-[10px]'
                  : 'px-2 py-1 text-[11px]'
              } ${
                fitMode === 'contain'
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              Fit
            </button>
            <button
              type="button"
              onClick={() => onFitModeChange('cover')}
              aria-pressed={fitMode === 'cover'}
              title="Fill: Crop to cover entire frame"
              className={`rounded-md font-medium transition-colors whitespace-nowrap ${
                isMobile
                  ? 'px-1.5 py-0.5 text-[10px]'
                  : 'px-2 py-1 text-[11px]'
              } ${
                fitMode === 'cover'
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-100'
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
            className={`inline-flex items-center gap-1 rounded-md border font-medium transition-colors whitespace-nowrap shrink-0 ${
              isMobile
                ? 'px-1.5 py-0.5 text-[10px]'
                : 'px-2.5 py-1 text-[11px] gap-1.5'
            } ${
              isFullPreview
                ? 'border-blue-500/60 bg-blue-600/20 text-blue-200'
                : 'border-zinc-700/80 bg-[#090B0E] text-zinc-300 hover:text-white hover:border-zinc-600'
            }`}
          >
            {isFullPreview ? (
              <>
                <Minimize2 className="w-3 h-3" aria-hidden="true" />
                <span>{isMobile ? 'Exit' : 'Exit Full Preview'}</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3 h-3" aria-hidden="true" />
                <span>{isMobile ? 'Expand' : 'Full Preview'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live HTML5 Canvas Stage */}
      <div
        ref={stageRef}
        className={`flex-1 min-h-0 flex items-center justify-center overflow-hidden relative ${
          isMobile ? 'p-1' : 'p-2'
        }`}
      >
        <video
          ref={videoRefA}
          className="hidden"
          playsInline
          onLoadedData={() => {
            if (!isPlaying) drawCurrentFrame(currentTime);
          }}
          onCanPlay={() => {
            if (!isPlaying) drawCurrentFrame(currentTime);
          }}
          onSeeked={() => {
            if (!isPlaying) drawCurrentFrame(currentTime);
          }}
        />
        <video
          ref={videoRefB}
          className="hidden"
          playsInline
          muted
          onLoadedData={() => {
            if (!isPlaying) drawCurrentFrame(currentTime);
          }}
          onCanPlay={() => {
            if (!isPlaying) drawCurrentFrame(currentTime);
          }}
          onSeeked={() => {
            if (!isPlaying) drawCurrentFrame(currentTime);
          }}
        />
        {videoClips.length === 0 &&
        overlayLayers.length === 0 &&
        textOverlays.length === 0 &&
        effectItems.length === 0 ? (
          <div
            className={`max-w-sm w-full rounded-xl border border-zinc-800/80 bg-[#12151B]/95 text-center ${
              isMobile ? 'px-4 py-3' : 'px-6 py-7'
            }`}
          >
            {!isMobile && (
              <div className="mx-auto w-10 h-10 rounded-lg bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center text-zinc-300 mb-3.5">
                <Film className="w-5 h-5" aria-hidden="true" />
              </div>
            )}
            <h2
              className={`font-semibold text-zinc-100 ${
                isMobile ? 'text-xs' : 'text-sm'
              }`}
            >
              Timeline is empty
            </h2>
            <p
              className={`text-zinc-400 leading-snug ${
                isMobile ? 'mt-1 text-[11px]' : 'mt-1.5 text-xs leading-relaxed'
              }`}
            >
              Upload MP4/WebM videos or PNG/JPG/WebP images to start editing.
            </p>
            <button
              type="button"
              onClick={onOpenUpload}
              className={`inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors ${
                isMobile ? 'mt-2.5 px-3 py-1.5' : 'mt-4 px-4 py-2 gap-2'
              }`}
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

      {/* Selected Overlay / PIP Properties Bar (Desktop only; mobile edits via Stickers/Overlay tab) */}
      {selectedOverlay && !isFullPreview && !isMobile && (
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
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (!Number.isFinite(val)) return;
                  onUpdateOverlay(selectedOverlay.id, {
                    startTime: Math.max(
                      0,
                      Math.min(selectedOverlay.endTime - 0.2, val)
                    ),
                  });
                }}
                className="w-12 rounded border border-zinc-700 bg-[#090B0E] px-1.5 py-0.5 text-[11px] font-mono tabular-nums text-zinc-200"
              />
              <span>End</span>
              <input
                type="number"
                min={selectedOverlay.startTime + 0.2}
                step={0.1}
                value={Number(selectedOverlay.endTime.toFixed(1))}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (!Number.isFinite(val)) return;
                  onUpdateOverlay(selectedOverlay.id, {
                    endTime: Math.max(selectedOverlay.startTime + 0.2, val),
                  });
                }}
                className="w-12 rounded border border-zinc-700 bg-[#090B0E] px-1.5 py-0.5 text-[11px] font-mono tabular-nums text-zinc-200"
              />
            </div>

            {selectedOverlay.kind !== 'sticker' && (
              <button
                type="button"
                onClick={() => onOpenBgRemoveForOverlay(selectedOverlay.id)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 font-medium"
              >
                <Scissors className="w-3 h-3" aria-hidden="true" />
                <span>BG Remove</span>
              </button>
            )}

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
      <div
        className={`shrink-0 border-t border-zinc-800/80 bg-[#12151B] flex items-center ${
          isMobile ? 'px-2.5 py-1.5 gap-2' : 'px-4 py-2 gap-3'
        }`}
      >
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
