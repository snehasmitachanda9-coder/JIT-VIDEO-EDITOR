import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  Eraser,
  Film,
  Move,
  Music,
  Sliders,
  Smile,
  Sparkles,
  Type as TypeIcon,
  X,
} from 'lucide-react';
import {ExportModal} from './components/ExportModal';
import {Header} from './components/Header';
import {MediaSidebar} from './components/MediaSidebar';
import {PreviewCanvasPlayer} from './components/PreviewCanvasPlayer';
import {RightEditorPanel} from './components/RightEditorPanel';
import {TimelinePanel} from './components/TimelinePanel';
import {useViewportMode} from './hooks/useViewportMode';
import {
  DEFAULT_AUDIO_EFFECTS,
  DEFAULT_BG_REMOVAL,
  DEFAULT_MOTION_TRANSFORM,
  type AIStudioCaption,
  type AspectRatioPreset,
  type AudioAsset,
  type AudioSettings,
  type BackgroundRemovalConfig,
  type BeatSyncAnalysis,
  type BuiltInSfxKind,
  type ClipTransition,
  type FilterPreset,
  type MediaAsset,
  type MotionTransform,
  type OverlayLayerItem,
  type RightPanelTab,
  type SelectedTimelineItem,
  type StickerKind,
  type TextOverlayItem,
  type TimelineAudioClip,
  type TimelineEffectItem,
  type TimelineEffectType,
  type TimelineVideoClip,
  type VideoFilters,
  type VideoFitMode,
} from './types/editor';
import {clearMaskCache} from './utils/backgroundRemover';
import {analyzeAudioClipBeats} from './utils/beatAnalyzer';
import {FILTER_PRESET_VALUES} from './utils/canvasRenderer';
import {
  getEffectCatalogEntry,
  JIT_LOGO_URL,
  WATERMARK_CORNER_POSITIONS,
  type WatermarkCorner,
} from './utils/effectCatalog';
import {exportEditedVideo} from './utils/exportVideo';
import {
  BUILT_IN_SFX_LIST,
  generateBuiltInSfxAsset,
} from './utils/soundEffects';
import {getStickerDefinition} from './utils/stickerRenderer';
import {
  computeTotalTimelineDuration,
  computeVideoTimelineSegments,
  extractAudioDuration,
  resolveSegmentSourceTime,
  resolveVideoStateAtTime,
} from './utils/timelineMath';
import {
  extractImageMetadata,
  extractVideoMetadata,
} from './utils/videoThumbnail';

const SUPPORTED_VIDEO_EXT = ['.mp4', '.webm'];
const SUPPORTED_VIDEO_MIME = new Set(['video/mp4', 'video/webm']);
const SUPPORTED_IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const SUPPORTED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
const SUPPORTED_AUDIO_EXT = ['.mp3', '.wav'];
const SUPPORTED_AUDIO_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
]);

function isSupportedVideo(file: File): boolean {
  if (SUPPORTED_VIDEO_MIME.has(file.type.toLowerCase())) return true;
  const lower = file.name.toLowerCase();
  return SUPPORTED_VIDEO_EXT.some((ext) => lower.endsWith(ext));
}

function isSupportedImage(file: File): boolean {
  if (SUPPORTED_IMAGE_MIME.has(file.type.toLowerCase())) return true;
  const lower = file.name.toLowerCase();
  return SUPPORTED_IMAGE_EXT.some((ext) => lower.endsWith(ext));
}

function isSupportedAudio(file: File): boolean {
  if (SUPPORTED_AUDIO_MIME.has(file.type.toLowerCase())) return true;
  const lower = file.name.toLowerCase();
  return SUPPORTED_AUDIO_EXT.some((ext) => lower.endsWith(ext));
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const DEFAULT_FILTERS: VideoFilters = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  blur: 0,
  hueRotate: 0,
  vignette: 0,
  sharpen: 0,
  faceGlow: 0,
  preset: 'none',
};

const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  videoVolume: 1,
  videoMuted: false,
  musicVolume: 0.7,
  musicMuted: false,
  playbackSpeed: 1,
  effects: {...DEFAULT_AUDIO_EFFECTS},
};

const DEFAULT_TRANSITION: ClipTransition = {
  type: 'none',
  duration: 0.8,
};

const MAX_HISTORY_STATES = 30;

interface EditorHistorySnapshot {
  videoClips: TimelineVideoClip[];
  effectItems: TimelineEffectItem[];
  overlayLayers: OverlayLayerItem[];
  audioClips: TimelineAudioClip[];
  textOverlays: TextOverlayItem[];
  filters: VideoFilters;
  motionTransform: MotionTransform;
  mainBgRemoval: BackgroundRemovalConfig;
  audioSettings: AudioSettings;
}

function areSnapshotsEqual(
  a: EditorHistorySnapshot,
  b: EditorHistorySnapshot
): boolean {
  return (
    a.videoClips === b.videoClips &&
    a.effectItems === b.effectItems &&
    a.overlayLayers === b.overlayLayers &&
    a.audioClips === b.audioClips &&
    a.textOverlays === b.textOverlays &&
    a.filters === b.filters &&
    a.motionTransform === b.motionTransform &&
    a.mainBgRemoval === b.mainBgRemoval &&
    a.audioSettings === b.audioSettings
  );
}

function haveSameItemIds(
  a: ReadonlyArray<{id: string}>,
  b: ReadonlyArray<{id: string}>
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
}

function isStructuralHistoryChange(
  a: EditorHistorySnapshot,
  b: EditorHistorySnapshot
): boolean {
  if (!haveSameItemIds(a.videoClips, b.videoClips)) return true;
  if (!haveSameItemIds(a.effectItems, b.effectItems)) return true;
  if (!haveSameItemIds(a.overlayLayers, b.overlayLayers)) return true;
  if (!haveSameItemIds(a.audioClips, b.audioClips)) return true;
  if (!haveSameItemIds(a.textOverlays, b.textOverlays)) return true;
  if (a.filters.preset !== b.filters.preset) return true;
  if (
    a.motionTransform.flipH !== b.motionTransform.flipH ||
    a.motionTransform.flipV !== b.motionTransform.flipV
  ) {
    return true;
  }
  if (a.mainBgRemoval.mode !== b.mainBgRemoval.mode) return true;
  if (
    a.audioSettings.videoMuted !== b.audioSettings.videoMuted ||
    a.audioSettings.musicMuted !== b.audioSettings.musicMuted ||
    a.audioSettings.playbackSpeed !== b.audioSettings.playbackSpeed
  ) {
    return true;
  }
  return false;
}

export default function App() {
  // Responsive Layout & Collapse State
  const layoutMode = useViewportMode();
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isFullPreview, setIsFullPreview] = useState(false);
  const [isDocFullscreen, setIsDocFullscreen] = useState(false);
  const [mobileBottomTab, setMobileBottomTab] = useState<'media' | RightPanelTab>(
    'media'
  );
  const [landscapeDrawer, setLandscapeDrawer] = useState<
    'none' | 'media' | 'tools'
  >('none');

  // Media Libraries
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [audioAssets, setAudioAssets] = useState<AudioAsset[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Multi-Track Timeline State
  const [videoClips, setVideoClips] = useState<TimelineVideoClip[]>([]);
  const [effectItems, setEffectItems] = useState<TimelineEffectItem[]>([]);
  const [overlayLayers, setOverlayLayers] = useState<OverlayLayerItem[]>([]);
  const [audioClips, setAudioClips] = useState<TimelineAudioClip[]>([]);
  const [textOverlays, setTextOverlays] = useState<TextOverlayItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<SelectedTimelineItem>(null);

  // Canvas & Effects State
  const [aspectRatio, setAspectRatio] = useState<AspectRatioPreset>('16:9');
  const [fitMode, setFitMode] = useState<VideoFitMode>('contain');
  const [filters, setFilters] = useState<VideoFilters>(DEFAULT_FILTERS);
  const [motionTransform, setMotionTransform] = useState<MotionTransform>(
    DEFAULT_MOTION_TRANSFORM
  );
  const [mainBgRemoval, setMainBgRemoval] = useState<BackgroundRemovalConfig>({
    ...DEFAULT_BG_REMOVAL,
  });
  const [bgTargetKey, setBgTargetKey] = useState<string>('main');
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(
    DEFAULT_AUDIO_SETTINGS
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Right Inspector Tab
  const [activeRightTab, setActiveRightTab] = useState<RightPanelTab>('motion');

  // Audio Beat Sync Analysis
  const [beatSync, setBeatSync] = useState<BeatSyncAnalysis | null>(null);
  const [beatAnalyzing, setBeatAnalyzing] = useState(false);
  const [beatError, setBeatError] = useState<string | null>(null);

  // Export Modal State
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportPhase, setExportPhase] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDownloadUrl, setExportDownloadUrl] = useState<string | null>(
    null
  );
  const [exportFilename, setExportFilename] = useState('jit-video-export.webm');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureRawFrameRef = useRef<(() => string | null) | null>(null);
  const urlsRef = useRef<Set<string>>(new Set());
  const exportAbortRef = useRef<AbortController | null>(null);

  // 30-State Undo / Redo History Engine
  const initialSnapshotRef = useRef<EditorHistorySnapshot | null>(null);
  if (!initialSnapshotRef.current) {
    initialSnapshotRef.current = {
      videoClips,
      effectItems,
      overlayLayers,
      audioClips,
      textOverlays,
      filters,
      motionTransform,
      mainBgRemoval,
      audioSettings,
    };
  }
  const historyRef = useRef<{
    past: EditorHistorySnapshot[];
    future: EditorHistorySnapshot[];
  }>({past: [], future: []});
  const [historyCounts, setHistoryCounts] = useState({
    canUndo: false,
    canRedo: false,
  });
  const prevCommittedRef = useRef<EditorHistorySnapshot>(
    initialSnapshotRef.current
  );
  const pendingBaseRef = useRef<EditorHistorySnapshot | null>(null);
  const pendingLatestRef = useRef<EditorHistorySnapshot | null>(null);
  const historyDebounceRef = useRef<number | null>(null);
  const isRestoringHistoryRef = useRef(false);

  const currentSnapshot = useMemo<EditorHistorySnapshot>(
    () => ({
      videoClips,
      effectItems,
      overlayLayers,
      audioClips,
      textOverlays,
      filters,
      motionTransform,
      mainBgRemoval,
      audioSettings,
    }),
    [
      videoClips,
      effectItems,
      overlayLayers,
      audioClips,
      textOverlays,
      filters,
      motionTransform,
      mainBgRemoval,
      audioSettings,
    ]
  );

  const syncHistoryFlags = useCallback(() => {
    const canUndo =
      historyRef.current.past.length > 0 || pendingBaseRef.current !== null;
    const canRedo = historyRef.current.future.length > 0;
    setHistoryCounts((prev) =>
      prev.canUndo === canUndo && prev.canRedo === canRedo
        ? prev
        : {canUndo, canRedo}
    );
  }, []);

  const flushPendingHistory = useCallback(() => {
    if (historyDebounceRef.current !== null) {
      window.clearTimeout(historyDebounceRef.current);
      historyDebounceRef.current = null;
    }
    if (pendingBaseRef.current && pendingLatestRef.current) {
      historyRef.current.past = [
        ...historyRef.current.past,
        pendingBaseRef.current,
      ].slice(-MAX_HISTORY_STATES);
      historyRef.current.future = [];
      prevCommittedRef.current = pendingLatestRef.current;
      pendingBaseRef.current = null;
      pendingLatestRef.current = null;
      syncHistoryFlags();
    }
  }, [syncHistoryFlags]);

  useEffect(() => {
    if (isRestoringHistoryRef.current) {
      isRestoringHistoryRef.current = false;
      prevCommittedRef.current = currentSnapshot;
      return;
    }

    if (areSnapshotsEqual(prevCommittedRef.current, currentSnapshot)) {
      return;
    }

    const baseForComparison =
      pendingLatestRef.current ?? prevCommittedRef.current;

    if (isStructuralHistoryChange(baseForComparison, currentSnapshot)) {
      flushPendingHistory();
      historyRef.current.past = [
        ...historyRef.current.past,
        prevCommittedRef.current,
      ].slice(-MAX_HISTORY_STATES);
      historyRef.current.future = [];
      prevCommittedRef.current = currentSnapshot;
      syncHistoryFlags();
    } else {
      if (!pendingBaseRef.current) {
        pendingBaseRef.current = prevCommittedRef.current;
      }
      pendingLatestRef.current = currentSnapshot;
      historyRef.current.future = [];
      syncHistoryFlags();

      if (historyDebounceRef.current !== null) {
        window.clearTimeout(historyDebounceRef.current);
      }
      historyDebounceRef.current = window.setTimeout(() => {
        flushPendingHistory();
      }, 300);
    }
  }, [currentSnapshot, flushPendingHistory, syncHistoryFlags]);

  useEffect(() => {
    return () => {
      if (historyDebounceRef.current !== null) {
        window.clearTimeout(historyDebounceRef.current);
      }
    };
  }, []);

  const applyHistorySnapshot = useCallback((snap: EditorHistorySnapshot) => {
    isRestoringHistoryRef.current = true;
    prevCommittedRef.current = snap;
    setIsPlaying(false);
    setVideoClips(snap.videoClips);
    setEffectItems(snap.effectItems);
    setOverlayLayers(snap.overlayLayers);
    setAudioClips(snap.audioClips);
    setTextOverlays(snap.textOverlays);
    setFilters(snap.filters);
    setMotionTransform(snap.motionTransform);
    setMainBgRemoval(snap.mainBgRemoval);
    setAudioSettings(snap.audioSettings);

    setSelectedItem((prev) => {
      if (!prev) return null;
      if (prev.track === 'video') {
        return snap.videoClips.some((c) => c.id === prev.id) ? prev : null;
      }
      if (prev.track === 'effect') {
        return snap.effectItems.some((e) => e.id === prev.id) ? prev : null;
      }
      if (prev.track === 'overlay') {
        return snap.overlayLayers.some((o) => o.id === prev.id) ? prev : null;
      }
      if (prev.track === 'audio') {
        return snap.audioClips.some((a) => a.id === prev.id) ? prev : null;
      }
      if (prev.track === 'text') {
        return snap.textOverlays.some((t) => t.id === prev.id) ? prev : null;
      }
      return null;
    });

    setBgTargetKey((prevKey) =>
      prevKey !== 'main' &&
      !snap.overlayLayers.some((o) => o.id === prevKey)
        ? 'main'
        : prevKey
    );
  }, []);

  const handleUndo = useCallback(() => {
    flushPendingHistory();
    const past = historyRef.current.past;
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    historyRef.current.past = past.slice(0, -1);
    historyRef.current.future = [
      currentSnapshot,
      ...historyRef.current.future,
    ].slice(0, MAX_HISTORY_STATES);
    applyHistorySnapshot(previous);
    syncHistoryFlags();
  }, [
    currentSnapshot,
    flushPendingHistory,
    applyHistorySnapshot,
    syncHistoryFlags,
  ]);

  const handleRedo = useCallback(() => {
    flushPendingHistory();
    const future = historyRef.current.future;
    if (future.length === 0) return;
    const next = future[0];
    historyRef.current.future = future.slice(1);
    historyRef.current.past = [
      ...historyRef.current.past,
      currentSnapshot,
    ].slice(-MAX_HISTORY_STATES);
    applyHistorySnapshot(next);
    syncHistoryFlags();
  }, [
    currentSnapshot,
    flushPendingHistory,
    applyHistorySnapshot,
    syncHistoryFlags,
  ]);

  useEffect(() => {
    const activeUrls = urlsRef.current;
    return () => {
      activeUrls.forEach((url) => URL.revokeObjectURL(url));
      activeUrls.clear();
    };
  }, []);

  useEffect(() => {
    const syncFullscreen = () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
      };
      setIsDocFullscreen(
        Boolean(document.fullscreenElement || doc.webkitFullscreenElement)
      );
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    document.addEventListener('webkitfullscreenchange', syncFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
      document.removeEventListener('webkitfullscreenchange', syncFullscreen);
    };
  }, []);

  useEffect(() => {
    if (layoutMode !== 'mobile-landscape' && landscapeDrawer !== 'none') {
      setLandscapeDrawer('none');
    }
  }, [layoutMode, landscapeDrawer]);

  const handleToggleFullscreen = useCallback(async () => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const rootEl = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };

    try {
      if (document.fullscreenElement || doc.webkitFullscreenElement) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
        return;
      }

      if (rootEl.requestFullscreen) {
        await rootEl.requestFullscreen();
        return;
      }
      if (rootEl.webkitRequestFullscreen) {
        await rootEl.webkitRequestFullscreen();
        return;
      }
    } catch {
      // Fallback for iOS Safari / restricted iframes where Fullscreen API is unavailable
    }
    setIsFullPreview((f) => !f);
  }, []);

  const handleToggleLandscapeDrawer = useCallback(
    (drawer: 'media' | 'tools') => {
      setLandscapeDrawer((prev) => (prev === drawer ? 'none' : drawer));
    },
    []
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && landscapeDrawer !== 'none') {
        setLandscapeDrawer('none');
        return;
      }
      if (e.key === 'Escape' && isFullPreview) {
        setIsFullPreview(false);
        return;
      }

      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const targetEl = e.target as HTMLElement | null;
      if (targetEl) {
        const tag = targetEl.tagName;
        if (
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          targetEl.isContentEditable
        ) {
          return;
        }
        if (tag === 'INPUT') {
          const inputType = (targetEl as HTMLInputElement).type;
          if (
            inputType !== 'range' &&
            inputType !== 'checkbox' &&
            inputType !== 'button' &&
            inputType !== 'radio'
          ) {
            return;
          }
        }
      }

      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (key === 'y' && !e.shiftKey) {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullPreview, handleUndo, handleRedo]);

  const totalDuration = useMemo(
    () =>
      computeTotalTimelineDuration(
        videoClips,
        overlayLayers,
        audioClips,
        textOverlays,
        audioSettings.playbackSpeed,
        effectItems
      ),
    [
      videoClips,
      effectItems,
      overlayLayers,
      audioClips,
      textOverlays,
      audioSettings.playbackSpeed,
    ]
  );

  useEffect(() => {
    if (totalDuration === 0 && currentTime !== 0) {
      setCurrentTime(0);
      setIsPlaying(false);
    } else if (totalDuration > 0 && currentTime > totalDuration) {
      setCurrentTime(totalDuration);
    }
  }, [totalDuration, currentTime]);

  const selectedVideoClipId =
    selectedItem?.track === 'video' ? selectedItem.id : null;
  const selectedOverlayId =
    selectedItem?.track === 'overlay' ? selectedItem.id : null;
  const selectedTextId =
    selectedItem?.track === 'text' ? selectedItem.id : null;
  const selectedEffect = useMemo(
    () =>
      selectedItem?.track === 'effect'
        ? effectItems.find((e) => e.id === selectedItem.id) ?? null
        : null,
    [selectedItem, effectItems]
  );
  const selectedAudioClip = useMemo(
    () =>
      selectedItem?.track === 'audio'
        ? audioClips.find((c) => c.id === selectedItem.id) ?? null
        : null,
    [selectedItem, audioClips]
  );
  const selectedOverlay = useMemo(
    () =>
      selectedOverlayId
        ? overlayLayers.find((o) => o.id === selectedOverlayId) ?? null
        : null,
    [selectedOverlayId, overlayLayers]
  );
  const beatTimes = useMemo(() => beatSync?.beatTimes ?? [], [beatSync]);

  const handleTabChange = useCallback((tab: RightPanelTab) => {
    setActiveRightTab(tab);
    setMobileBottomTab(tab);
    setSelectedItem((prev) => (prev?.track === 'effect' ? null : prev));
  }, []);

  const handleCloseEffectInspector = useCallback(() => {
    setSelectedItem((prev) => (prev?.track === 'effect' ? null : prev));
  }, []);

  // Upload Videos & Images
  const handleUploadMediaFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList);
      if (incoming.length === 0) return;

      const validFiles = incoming.filter(
        (f) => isSupportedVideo(f) || isSupportedImage(f)
      );
      const rejected = incoming.length - validFiles.length;

      if (rejected > 0) {
        setUploadError(
          rejected === incoming.length
            ? 'Unsupported format. Upload MP4/WebM videos or PNG/JPG/WebP images.'
            : `${rejected} unsupported file(s) skipped.`
        );
      } else {
        setUploadError(null);
      }

      if (validFiles.length === 0) return;

      const newAssets: MediaAsset[] = await Promise.all(
        validFiles.map(async (file) => {
          const objectUrl = URL.createObjectURL(file);
          urlsRef.current.add(objectUrl);

          if (isSupportedImage(file)) {
            const imgMeta = await extractImageMetadata(objectUrl);
            return {
              id: makeId('asset'),
              kind: 'image',
              name: file.name,
              url: objectUrl,
              size: file.size,
              type: file.type,
              duration: 5,
              width: imgMeta.width,
              height: imgMeta.height,
              thumbnailUrl: imgMeta.thumbnailUrl,
            };
          }

          const vidMeta = await extractVideoMetadata(objectUrl);
          return {
            id: makeId('asset'),
            kind: 'video',
            name: file.name,
            url: objectUrl,
            size: file.size,
            type: file.type,
            duration: Math.max(0.5, vidMeta.duration),
            width: vidMeta.width,
            height: vidMeta.height,
            thumbnailUrl: vidMeta.thumbnailUrl,
          };
        })
      );

      setMediaAssets((prev) => [...prev, ...newAssets]);

      const videoAssets = newAssets.filter((a) => a.kind === 'video');
      const imageAssets = newAssets.filter((a) => a.kind === 'image');

      if (videoAssets.length > 0) {
        setVideoClips((prev) => {
          if (prev.length > 0) return prev;
          const appended: TimelineVideoClip[] = videoAssets.map((a) => ({
            id: makeId('vclip'),
            kind: 'video',
            assetId: a.id,
            name: a.name,
            url: a.url,
            thumbnailUrl: a.thumbnailUrl,
            sourceDuration: a.duration,
            trimStart: 0,
            trimEnd: a.duration,
            transitionIn: {...DEFAULT_TRANSITION},
          }));
          if (appended[0]) {
            setSelectedItem({track: 'video', id: appended[0].id});
          }
          return appended;
        });
      } else if (
        imageAssets.length > 0 &&
        videoClips.length === 0 &&
        overlayLayers.length === 0
      ) {
        let cursor = 0;
        const createdOverlays: OverlayLayerItem[] = imageAssets.map((a) => {
          const naturalAspect =
            a.width > 0 && a.height > 0 ? a.width / a.height : 1;
          const layer: OverlayLayerItem = {
            id: makeId('overlay'),
            assetId: a.id,
            kind: 'image',
            name: a.name,
            url: a.url,
            thumbnailUrl: a.thumbnailUrl,
            sourceDuration: 0,
            sourceTrimStart: 0,
            startTime: cursor,
            endTime: cursor + 5,
            x: 0.5,
            y: 0.5,
            width: 0.65,
            aspectRatio: naturalAspect,
            opacity: 1,
            bgRemoval: {...DEFAULT_BG_REMOVAL, replacementType: 'transparent'},
          };
          cursor += 5;
          return layer;
        });
        setOverlayLayers(createdOverlays);
        if (createdOverlays[0]) {
          setSelectedItem({track: 'overlay', id: createdOverlays[0].id});
          setBgTargetKey(createdOverlays[0].id);
        }
      }
    },
    [videoClips.length, overlayLayers.length]
  );

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files.length > 0) {
        void handleUploadMediaFiles(event.target.files);
        event.target.value = '';
      }
    },
    [handleUploadMediaFiles]
  );

  const handleAddVideoToTimeline = useCallback((asset: MediaAsset) => {
    if (asset.kind !== 'video') return;
    const newClip: TimelineVideoClip = {
      id: makeId('vclip'),
      kind: 'video',
      assetId: asset.id,
      name: asset.name,
      url: asset.url,
      thumbnailUrl: asset.thumbnailUrl,
      sourceDuration: asset.duration,
      trimStart: 0,
      trimEnd: asset.duration,
      transitionIn: {...DEFAULT_TRANSITION},
    };
    setVideoClips((prev) => [...prev, newClip]);
    setSelectedItem({track: 'video', id: newClip.id});
  }, []);

  const handleAddOverlayToTimeline = useCallback(
    (asset: MediaAsset) => {
      const start = Math.max(0, Number(currentTime.toFixed(2)));
      const dur = asset.kind === 'video' ? Math.max(1, asset.duration) : 4;
      const naturalAspect =
        asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 1;

      const newLayer: OverlayLayerItem = {
        id: makeId('overlay'),
        assetId: asset.id,
        kind: asset.kind,
        name: asset.name,
        url: asset.url,
        thumbnailUrl: asset.thumbnailUrl,
        sourceDuration: asset.kind === 'video' ? asset.duration : 0,
        sourceTrimStart: 0,
        startTime: start,
        endTime: start + dur,
        x: 0.72,
        y: 0.7,
        width: 0.34,
        aspectRatio: naturalAspect,
        opacity: 1,
        bgRemoval: {...DEFAULT_BG_REMOVAL, replacementType: 'transparent'},
      };

      setOverlayLayers((prev) => [...prev, newLayer]);
      setSelectedItem({track: 'overlay', id: newLayer.id});
      setBgTargetKey(newLayer.id);
    },
    [currentTime]
  );

  const handleRemoveAsset = useCallback(
    (assetId: string) => {
      if (historyDebounceRef.current !== null) {
        window.clearTimeout(historyDebounceRef.current);
        historyDebounceRef.current = null;
      }
      pendingBaseRef.current = null;
      pendingLatestRef.current = null;
      historyRef.current = {past: [], future: []};
      syncHistoryFlags();

      setMediaAssets((prev) => {
        const target = prev.find((a) => a.id === assetId);
        if (target) {
          URL.revokeObjectURL(target.url);
          urlsRef.current.delete(target.url);
        }
        return prev.filter((a) => a.id !== assetId);
      });
      setVideoClips((prev) => prev.filter((c) => c.assetId !== assetId));
      setOverlayLayers((prev) => prev.filter((o) => o.assetId !== assetId));
      setSelectedItem(null);
      if (mainBgRemoval.replacementAssetId === assetId) {
        setMainBgRemoval((prev) => ({
          ...prev,
          replacementAssetId: null,
          replacementAssetUrl: null,
          replacementAssetKind: null,
          replacementAssetName: null,
        }));
      }
    },
    [mainBgRemoval.replacementAssetId, syncHistoryFlags]
  );

  // Freeze Frame Insertion (3-second still image segment at playhead)
  const handleFreezeFrame = useCallback(() => {
    const captureFn = captureRawFrameRef.current;
    if (!captureFn) return;
    const dataUrl = captureFn();
    if (!dataUrl) return;

    const segments = computeVideoTimelineSegments(
      videoClips,
      audioSettings.playbackSpeed,
      effectItems
    );
    const activeState = resolveVideoStateAtTime(segments, currentTime);
    const seg = activeState.primary;
    if (!seg) return;

    const freezeClip: TimelineVideoClip = {
      id: makeId('freeze'),
      kind: 'freeze',
      assetId: seg.clip.assetId,
      name: `Freeze · ${seg.clip.name}`,
      url: dataUrl,
      thumbnailUrl: dataUrl,
      sourceDuration: 30,
      trimStart: 0,
      trimEnd: 3,
      transitionIn: {...DEFAULT_TRANSITION},
    };

    const elapsedInSeg = currentTime - seg.timelineStart;
    const isNearStart = elapsedInSeg <= 0.15;
    const isNearEnd = seg.timelineEnd - currentTime <= 0.15;

    setVideoClips((prev) => {
      const idx = prev.findIndex((c) => c.id === seg.clip.id);
      if (idx === -1) return prev;
      const copy = [...prev];

      if (isNearStart) {
        copy.splice(idx, 0, freezeClip);
      } else if (isNearEnd) {
        copy.splice(idx + 1, 0, freezeClip);
      } else {
        const splitSource = resolveSegmentSourceTime(
          seg,
          currentTime,
          audioSettings.playbackSpeed,
          effectItems
        );
        const firstHalf: TimelineVideoClip = {
          ...seg.clip,
          trimEnd: splitSource,
        };
        const secondHalf: TimelineVideoClip = {
          ...seg.clip,
          id: makeId('vclip'),
          trimStart: splitSource,
          transitionIn: {...DEFAULT_TRANSITION},
        };
        copy.splice(idx, 1, firstHalf, freezeClip, secondHalf);
      }
      return copy;
    });

    setIsPlaying(false);
    setSelectedItem({track: 'video', id: freezeClip.id});
  }, [videoClips, effectItems, audioSettings.playbackSpeed, currentTime]);

  const handleUpdateClipTransition = useCallback(
    (clipId: string, transition: ClipTransition) => {
      setVideoClips((prev) =>
        prev.map((c) => (c.id === clipId ? {...c, transitionIn: transition} : c))
      );
    },
    []
  );

  // Overlay PIP Management
  const handleSelectOverlay = useCallback((id: string) => {
    setSelectedItem({track: 'overlay', id});
    setBgTargetKey(id);
  }, []);

  const handleUpdateOverlay = useCallback(
    (id: string, patch: Partial<OverlayLayerItem>) => {
      setOverlayLayers((prev) =>
        prev.map((layer) => (layer.id === id ? {...layer, ...patch} : layer))
      );
    },
    []
  );

  const handleDeleteOverlay = useCallback(
    (id: string) => {
      clearMaskCache(`overlay-${id}`);
      setOverlayLayers((prev) => prev.filter((layer) => layer.id !== id));
      if (selectedItem?.track === 'overlay' && selectedItem.id === id) {
        setSelectedItem(null);
      }
      if (bgTargetKey === id) {
        setBgTargetKey('main');
      }
    },
    [selectedItem, bgTargetKey]
  );

  const handleOpenBgRemoveForOverlay = useCallback(
    (id: string) => {
      setBgTargetKey(id);
      setActiveRightTab('bg-remove');
      setRightCollapsed(false);
      if (layoutMode === 'mobile-portrait') {
        setMobileBottomTab('bg-remove');
      } else if (layoutMode === 'mobile-landscape') {
        setLandscapeDrawer('tools');
      }
    },
    [layoutMode]
  );

  // Background Removal Updates
  const handleUpdateMainBgRemoval = useCallback(
    (patch: Partial<BackgroundRemovalConfig>) => {
      setMainBgRemoval((prev) => ({...prev, ...patch}));
    },
    []
  );

  const handleUpdateOverlayBgRemoval = useCallback(
    (overlayId: string, patch: Partial<BackgroundRemovalConfig>) => {
      setOverlayLayers((prev) =>
        prev.map((layer) =>
          layer.id === overlayId
            ? {...layer, bgRemoval: {...layer.bgRemoval, ...patch}}
            : layer
        )
      );
    },
    []
  );

  const handleUploadBackgroundReplacement = useCallback(async (file: File) => {
    const isImg = isSupportedImage(file);
    const isVid = isSupportedVideo(file);
    if (!isImg && !isVid) return;

    const objectUrl = URL.createObjectURL(file);
    urlsRef.current.add(objectUrl);

    const kind: 'image' | 'video' = isImg ? 'image' : 'video';
    setMainBgRemoval((prev) => ({
      ...prev,
      replacementType: kind,
      replacementAssetId: makeId('bg'),
      replacementAssetUrl: objectUrl,
      replacementAssetKind: kind,
      replacementAssetName: file.name,
    }));
  }, []);

  // Audio Upload & Track Addition
  const handleUploadAudioFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList).filter(isSupportedAudio);
      if (incoming.length === 0) return;

      const created: AudioAsset[] = await Promise.all(
        incoming.map(async (file) => {
          const objectUrl = URL.createObjectURL(file);
          urlsRef.current.add(objectUrl);
          const dur = await extractAudioDuration(objectUrl);
          return {
            id: makeId('audio'),
            name: file.name,
            url: objectUrl,
            size: file.size,
            duration: Math.max(1, dur),
          };
        })
      );

      setAudioAssets((prev) => [...prev, ...created]);

      setAudioClips((prev) => {
        const lastEnd = prev.reduce(
          (max, c) => Math.max(max, c.startTime + (c.trimEnd - c.trimStart)),
          0
        );
        let cursor = prev.length === 0 ? 0 : lastEnd;
        const nextClips: TimelineAudioClip[] = created.map((asset) => {
          const clip: TimelineAudioClip = {
            id: makeId('aclip'),
            assetId: asset.id,
            name: asset.name,
            url: asset.url,
            sourceDuration: asset.duration,
            startTime: cursor,
            trimStart: 0,
            trimEnd: asset.duration,
          };
          cursor += asset.duration;
          return clip;
        });
        if (nextClips[0]) {
          setSelectedItem({track: 'audio', id: nextClips[0].id});
        }
        return [...prev, ...nextClips];
      });
    },
    []
  );

  const handleAddAudioToTimeline = useCallback(
    (asset: AudioAsset) => {
      const clip: TimelineAudioClip = {
        id: makeId('aclip'),
        assetId: asset.id,
        name: asset.name,
        url: asset.url,
        sourceDuration: asset.duration,
        startTime: currentTime,
        trimStart: 0,
        trimEnd: asset.duration,
        volume: 1,
      };
      setAudioClips((prev) => [...prev, clip]);
      setSelectedItem({track: 'audio', id: clip.id});
    },
    [currentTime]
  );

  const handleAnalyzeBeats = useCallback(
    async (clipId: string) => {
      const targetClip = audioClips.find((c) => c.id === clipId);
      if (!targetClip) return;
      setBeatAnalyzing(true);
      setBeatError(null);
      try {
        const analysis = await analyzeAudioClipBeats(targetClip);
        setBeatSync(analysis);
      } catch (err) {
        setBeatError(
          err instanceof Error ? err.message : 'Unable to analyze audio beats.'
        );
      } finally {
        setBeatAnalyzing(false);
      }
    },
    [audioClips]
  );

  const handleClearBeats = useCallback(() => {
    setBeatSync(null);
    setBeatError(null);
  }, []);

  // Effects Track (Weather, Animated Motion, Studio/Cinema VFX, Color Filters)
  const handleAddTimelineEffect = useCallback(
    (type: TimelineEffectType) => {
      const entry = getEffectCatalogEntry(type);
      const start = Math.max(0, Number(currentTime.toFixed(2)));
      const end = Number((start + 4).toFixed(2));
      const isZoom = type === 'zoom-in' || type === 'zoom-out';
      const item: TimelineEffectItem = {
        id: makeId('effect'),
        type,
        category: entry.category,
        name: entry.name,
        icon: entry.icon,
        intensity: entry.defaultIntensity,
        opacity: entry.defaultOpacity,
        startTime: start,
        endTime: end,
        ...(isZoom
          ? {
              targetZoom: 165,
              zoomCenterX: 50,
              zoomCenterY: 50,
            }
          : {}),
        ...(type === 'speed-ramp' ? {speedRampMode: 'slow-mo' as const} : {}),
      };
      setEffectItems((prev) => [...prev, item]);
      setSelectedItem({track: 'effect', id: item.id});
    },
    [currentTime]
  );

  const handleSelectEffectItem = useCallback(
    (id: string) => {
      setSelectedItem({track: 'effect', id});
      if (layoutMode === 'mobile-portrait') {
        setMobileBottomTab((prev) => (prev === 'filters' ? prev : 'motion'));
      }
    },
    [layoutMode]
  );

  const handleUpdateEffectItem = useCallback(
    (id: string, patch: Partial<TimelineEffectItem>) => {
      setEffectItems((prev) =>
        prev.map((item) => (item.id === id ? {...item, ...patch} : item))
      );
    },
    []
  );

  const handleDeleteEffectItem = useCallback(
    (id: string) => {
      setEffectItems((prev) => prev.filter((item) => item.id !== id));
      if (selectedItem?.track === 'effect' && selectedItem.id === id) {
        setSelectedItem(null);
      }
    },
    [selectedItem]
  );

  // Stickers & Masks + Official JIT Logo Watermark on Overlay Track
  const handleAddStickerOverlay = useCallback(
    (stickerKind: StickerKind) => {
      const def = getStickerDefinition(stickerKind);
      const start = Math.max(0, Number(currentTime.toFixed(2)));
      const end =
        totalDuration > start + 0.5
          ? Math.min(totalDuration, start + 4)
          : start + 4;
      const newLayer: OverlayLayerItem = {
        id: makeId('sticker'),
        assetId: `sticker-${stickerKind}`,
        kind: 'sticker',
        stickerKind,
        name: def.label,
        url: def.dataUrl,
        thumbnailUrl: def.dataUrl,
        sourceDuration: 0,
        sourceTrimStart: 0,
        startTime: start,
        endTime: Math.max(start + 0.5, end),
        x: 0.5,
        y: 0.42,
        width: 0.26,
        aspectRatio: def.aspectRatio,
        opacity: 1,
        bgRemoval: {...DEFAULT_BG_REMOVAL, replacementType: 'transparent'},
      };
      setOverlayLayers((prev) => [...prev, newLayer]);
      setSelectedItem({track: 'overlay', id: newLayer.id});
    },
    [currentTime, totalDuration]
  );

  const handleAddJitLogoWatermark = useCallback(
    async (corner: WatermarkCorner) => {
      let aspectRatio = 0.95;
      try {
        const meta = await extractImageMetadata(JIT_LOGO_URL);
        if (meta.width > 0 && meta.height > 0) {
          aspectRatio = meta.width / meta.height;
        }
      } catch {
        aspectRatio = 0.95;
      }
      const {x, y} = WATERMARK_CORNER_POSITIONS[corner];
      const newLayer: OverlayLayerItem = {
        id: makeId('watermark'),
        assetId: 'jit-watermark',
        kind: 'image',
        name: 'JIT Logo Watermark',
        url: JIT_LOGO_URL,
        thumbnailUrl: JIT_LOGO_URL,
        sourceDuration: 0,
        sourceTrimStart: 0,
        startTime: 0,
        endTime: Math.max(4, totalDuration > 0 ? Number(totalDuration.toFixed(2)) : 5),
        x,
        y,
        width: 0.14,
        aspectRatio,
        opacity: 0.92,
        bgRemoval: {...DEFAULT_BG_REMOVAL, replacementType: 'transparent'},
      };
      setOverlayLayers((prev) => [...prev, newLayer]);
      setSelectedItem({track: 'overlay', id: newLayer.id});
    },
    [totalDuration]
  );

  // Built-in Synthesized SFX Insertion at Playhead
  const handleAddBuiltInSfx = useCallback(
    async (kind: BuiltInSfxKind) => {
      const def =
        BUILT_IN_SFX_LIST.find((s) => s.kind === kind) ?? BUILT_IN_SFX_LIST[0];
      const asset = await generateBuiltInSfxAsset(kind);
      const start = Math.max(0, Number(currentTime.toFixed(2)));
      const clip: TimelineAudioClip = {
        id: makeId('sfx'),
        assetId: `sfx-${kind}`,
        name: `SFX · ${def.name}`,
        url: asset.url,
        sourceDuration: asset.duration,
        startTime: start,
        trimStart: 0,
        trimEnd: asset.duration,
        volume: 1,
        isSfx: true,
      };
      setAudioClips((prev) => [...prev, clip]);
      setSelectedItem({track: 'audio', id: clip.id});
    },
    [currentTime]
  );

  // Text Overlays
  const handleAddTextOverlay = useCallback(() => {
    const start = Math.max(0, Number(currentTime.toFixed(2)));
    const defaultDur = 3;
    const end =
      totalDuration > start + 0.5
        ? Math.min(totalDuration, start + defaultDur)
        : start + defaultDur;

    const item: TextOverlayItem = {
      id: makeId('text'),
      text: 'Your Title Here',
      x: 0.5,
      y: 0.5,
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 42,
      color: '#FFFFFF',
      backgroundColor: '#000000',
      hasBackground: true,
      startTime: start,
      endTime: Math.max(start + 0.5, end),
    };
    setTextOverlays((prev) => [...prev, item]);
    setSelectedItem({track: 'text', id: item.id});
    setActiveRightTab('text');
    if (layoutMode === 'mobile-portrait') {
      setMobileBottomTab('text');
    }
  }, [currentTime, totalDuration, layoutMode]);

  const handleSelectTextOverlay = useCallback(
    (id: string) => {
      setSelectedItem({track: 'text', id});
      setActiveRightTab('text');
      if (layoutMode === 'mobile-portrait') {
        setMobileBottomTab('text');
      }
    },
    [layoutMode]
  );

  const handleMoveTextOverlay = useCallback(
    (id: string, x: number, y: number) => {
      setTextOverlays((prev) =>
        prev.map((item) => (item.id === id ? {...item, x, y} : item))
      );
    },
    []
  );

  const handleUpdateTextOverlay = useCallback(
    (id: string, patch: Partial<TextOverlayItem>) => {
      setTextOverlays((prev) =>
        prev.map((item) => (item.id === id ? {...item, ...patch} : item))
      );
    },
    []
  );

  const handleDeleteTextOverlay = useCallback(
    (id: string) => {
      setTextOverlays((prev) => prev.filter((item) => item.id !== id));
      if (selectedItem?.track === 'text' && selectedItem.id === id) {
        setSelectedItem(null);
      }
    },
    [selectedItem]
  );

  // AI Studio Caption Insertion
  const handleAddAICaption = useCallback((caption: AIStudioCaption) => {
    const start = Math.max(0, Number(caption.startTime.toFixed(2)));
    const end = Math.max(start + 0.5, Number(caption.endTime.toFixed(2)));
    const newItem: TextOverlayItem = {
      id: makeId('text'),
      text: caption.text,
      x: 0.5,
      y: 0.82,
      fontFamily: 'Outfit',
      fontSize: 36,
      color: '#FFFFFF',
      backgroundColor: '#09090B',
      hasBackground: true,
      startTime: start,
      endTime: end,
    };
    setTextOverlays((prev) => [...prev, newItem]);
    setSelectedItem({track: 'text', id: newItem.id});
  }, []);

  const handleAddAllAICaptions = useCallback((captions: AIStudioCaption[]) => {
    const created: TextOverlayItem[] = captions.map((caption) => {
      const start = Math.max(0, Number(caption.startTime.toFixed(2)));
      const end = Math.max(start + 0.5, Number(caption.endTime.toFixed(2)));
      return {
        id: makeId('text'),
        text: caption.text,
        x: 0.5,
        y: 0.82,
        fontFamily: 'Outfit',
        fontSize: 36,
        color: '#FFFFFF',
        backgroundColor: '#09090B',
        hasBackground: true,
        startTime: start,
        endTime: end,
      };
    });
    setTextOverlays((prev) => [...prev, ...created]);
    if (created[0]) {
      setSelectedItem({track: 'text', id: created[0].id});
    }
  }, []);

  // Timeline Split & Delete & Trim
  const handleSplitSelected = useCallback(() => {
    if (!selectedItem) return;

    if (selectedItem.track === 'video') {
      const segments = computeVideoTimelineSegments(
        videoClips,
        audioSettings.playbackSpeed,
        effectItems
      );
      const seg = segments.find((s) => s.clip.id === selectedItem.id);
      if (!seg) return;
      if (
        currentTime <= seg.timelineStart + 0.15 ||
        currentTime >= seg.timelineEnd - 0.15
      ) {
        return;
      }

      const splitSourceTime =
        seg.clip.kind === 'freeze'
          ? seg.clip.trimStart + (currentTime - seg.timelineStart)
          : resolveSegmentSourceTime(
              seg,
              currentTime,
              audioSettings.playbackSpeed,
              effectItems
            );

      const firstHalf: TimelineVideoClip = {
        ...seg.clip,
        trimEnd: splitSourceTime,
      };
      const secondHalf: TimelineVideoClip = {
        ...seg.clip,
        id: makeId(seg.clip.kind === 'freeze' ? 'freeze' : 'vclip'),
        trimStart: splitSourceTime,
        transitionIn: {...DEFAULT_TRANSITION},
      };

      setVideoClips((prev) => {
        const idx = prev.findIndex((c) => c.id === seg.clip.id);
        if (idx === -1) return prev;
        const copy = [...prev];
        copy.splice(idx, 1, firstHalf, secondHalf);
        return copy;
      });
      setSelectedItem({track: 'video', id: secondHalf.id});
    } else if (selectedItem.track === 'overlay') {
      const ov = overlayLayers.find((o) => o.id === selectedItem.id);
      if (!ov) return;
      if (
        currentTime <= ov.startTime + 0.15 ||
        currentTime >= ov.endTime - 0.15
      ) {
        return;
      }
      const offset = currentTime - ov.startTime;
      const firstHalf: OverlayLayerItem = {
        ...ov,
        endTime: currentTime,
      };
      const secondHalf: OverlayLayerItem = {
        ...ov,
        id: makeId('overlay'),
        startTime: currentTime,
        sourceTrimStart:
          ov.kind === 'video' ? ov.sourceTrimStart + offset : ov.sourceTrimStart,
        bgRemoval: {...ov.bgRemoval},
      };
      setOverlayLayers((prev) => {
        const idx = prev.findIndex((o) => o.id === ov.id);
        if (idx === -1) return prev;
        const copy = [...prev];
        copy.splice(idx, 1, firstHalf, secondHalf);
        return copy;
      });
      setSelectedItem({track: 'overlay', id: secondHalf.id});
    } else if (selectedItem.track === 'audio') {
      const clip = audioClips.find((c) => c.id === selectedItem.id);
      if (!clip) return;
      const clipEnd = clip.startTime + (clip.trimEnd - clip.trimStart);
      if (
        currentTime <= clip.startTime + 0.15 ||
        currentTime >= clipEnd - 0.15
      ) {
        return;
      }
      const splitOffset = currentTime - clip.startTime;
      const splitSource = clip.trimStart + splitOffset;

      const firstHalf: TimelineAudioClip = {
        ...clip,
        trimEnd: splitSource,
      };
      const secondHalf: TimelineAudioClip = {
        ...clip,
        id: makeId('aclip'),
        startTime: currentTime,
        trimStart: splitSource,
      };

      setAudioClips((prev) => {
        const idx = prev.findIndex((c) => c.id === clip.id);
        if (idx === -1) return prev;
        const copy = [...prev];
        copy.splice(idx, 1, firstHalf, secondHalf);
        return copy;
      });
      setSelectedItem({track: 'audio', id: secondHalf.id});
    } else if (selectedItem.track === 'text') {
      const txt = textOverlays.find((t) => t.id === selectedItem.id);
      if (!txt) return;
      if (
        currentTime <= txt.startTime + 0.15 ||
        currentTime >= txt.endTime - 0.15
      ) {
        return;
      }

      const firstHalf: TextOverlayItem = {
        ...txt,
        endTime: currentTime,
      };
      const secondHalf: TextOverlayItem = {
        ...txt,
        id: makeId('text'),
        startTime: currentTime,
      };

      setTextOverlays((prev) => {
        const idx = prev.findIndex((t) => t.id === txt.id);
        if (idx === -1) return prev;
        const copy = [...prev];
        copy.splice(idx, 1, firstHalf, secondHalf);
        return copy;
      });
      setSelectedItem({track: 'text', id: secondHalf.id});
    } else if (selectedItem.track === 'effect') {
      const ef = effectItems.find((e) => e.id === selectedItem.id);
      if (!ef) return;
      if (
        currentTime <= ef.startTime + 0.15 ||
        currentTime >= ef.endTime - 0.15
      ) {
        return;
      }
      const firstHalf: TimelineEffectItem = {
        ...ef,
        endTime: currentTime,
      };
      const secondHalf: TimelineEffectItem = {
        ...ef,
        id: makeId('effect'),
        startTime: currentTime,
      };
      setEffectItems((prev) => {
        const idx = prev.findIndex((e) => e.id === ef.id);
        if (idx === -1) return prev;
        const copy = [...prev];
        copy.splice(idx, 1, firstHalf, secondHalf);
        return copy;
      });
      setSelectedItem({track: 'effect', id: secondHalf.id});
    }
  }, [
    selectedItem,
    videoClips,
    effectItems,
    overlayLayers,
    audioClips,
    textOverlays,
    audioSettings.playbackSpeed,
    currentTime,
  ]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedItem) return;
    if (selectedItem.track === 'video') {
      setVideoClips((prev) => {
        const filtered = prev.filter((c) => c.id !== selectedItem.id);
        // Ensure first clip has no incoming transition
        if (filtered.length > 0 && filtered[0].transitionIn.type !== 'none') {
          filtered[0] = {...filtered[0], transitionIn: {...DEFAULT_TRANSITION}};
        }
        return filtered;
      });
    } else if (selectedItem.track === 'effect') {
      setEffectItems((prev) => prev.filter((e) => e.id !== selectedItem.id));
    } else if (selectedItem.track === 'overlay') {
      clearMaskCache(`overlay-${selectedItem.id}`);
      setOverlayLayers((prev) => prev.filter((o) => o.id !== selectedItem.id));
      if (bgTargetKey === selectedItem.id) {
        setBgTargetKey('main');
      }
    } else if (selectedItem.track === 'audio') {
      setAudioClips((prev) => prev.filter((c) => c.id !== selectedItem.id));
      if (beatSync?.clipId === selectedItem.id) {
        setBeatSync(null);
      }
    } else if (selectedItem.track === 'text') {
      setTextOverlays((prev) => prev.filter((t) => t.id !== selectedItem.id));
    }
    setSelectedItem(null);
  }, [selectedItem, bgTargetKey, beatSync]);

  const handleTrimVideoClip = useCallback(
    (id: string, trimStart: number, trimEnd: number) => {
      setVideoClips((prev) =>
        prev.map((c) => (c.id === id ? {...c, trimStart, trimEnd} : c))
      );
    },
    []
  );

  const handleUpdateAudioClip = useCallback(
    (id: string, patch: Partial<TimelineAudioClip>) => {
      setAudioClips((prev) =>
        prev.map((c) => (c.id === id ? {...c, ...patch} : c))
      );
    },
    []
  );

  // Filters & Motion
  const handleUpdateFilters = useCallback((patch: Partial<VideoFilters>) => {
    setFilters((prev) => ({...prev, ...patch}));
  }, []);

  const handleApplyFilterPreset = useCallback((preset: FilterPreset) => {
    const presetValues = FILTER_PRESET_VALUES[preset];
    setFilters((prev) => ({
      preset,
      ...presetValues,
      faceGlow: prev.faceGlow,
    }));
  }, []);

  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const handleUpdateMotionTransform = useCallback(
    (patch: Partial<MotionTransform>) => {
      setMotionTransform((prev) => ({...prev, ...patch}));
    },
    []
  );

  const handleResetMotionTransform = useCallback(() => {
    setMotionTransform(DEFAULT_MOTION_TRANSFORM);
  }, []);

  const handleCaptureFrameDataUrl = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || (videoClips.length === 0 && overlayLayers.length === 0)) {
      return null;
    }
    try {
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch {
      return null;
    }
  }, [videoClips.length, overlayLayers.length]);

  // Export Video
  const handleStartExport = useCallback(async () => {
    if (
      (videoClips.length === 0 && overlayLayers.length === 0) ||
      isExporting
    ) {
      return;
    }

    setIsPlaying(false);
    setExportError(null);
    setExportProgress(0);
    setExportPhase('Starting render...');
    if (exportDownloadUrl) {
      URL.revokeObjectURL(exportDownloadUrl);
      urlsRef.current.delete(exportDownloadUrl);
      setExportDownloadUrl(null);
    }

    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExportModalOpen(true);
    setIsExporting(true);

    try {
      const result = await exportEditedVideo({
        videoClips,
        effectItems,
        overlayLayers,
        audioClips,
        textOverlays,
        aspectRatio,
        fitMode,
        filters,
        motionTransform,
        mainBgRemoval,
        audioSettings,
        beatTimes,
        onProgress: (pct, phase) => {
          setExportProgress(pct);
          setExportPhase(phase);
        },
        signal: controller.signal,
      });

      const filename = `jit-video-export-${Date.now()}.${result.extension}`;
      const blobUrl = URL.createObjectURL(result.blob);
      urlsRef.current.add(blobUrl);

      setExportFilename(filename);
      setExportDownloadUrl(blobUrl);
      setIsExporting(false);

      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (err) {
      setIsExporting(false);
      const message =
        err instanceof Error ? err.message : 'Failed to export video.';
      if (message === 'Export cancelled.') {
        setExportModalOpen(false);
      } else {
        setExportError(message);
      }
    } finally {
      exportAbortRef.current = null;
    }
  }, [
    videoClips,
    effectItems,
    overlayLayers,
    audioClips,
    textOverlays,
    aspectRatio,
    fitMode,
    filters,
    motionTransform,
    mainBgRemoval,
    audioSettings,
    beatTimes,
    isExporting,
    exportDownloadUrl,
  ]);

  const handleCancelExport = useCallback(() => {
    exportAbortRef.current?.abort();
  }, []);

  const clipNames = useMemo(
    () => videoClips.map((c) => c.name),
    [videoClips]
  );

  const mobileNavItems: Array<{
    id: 'media' | RightPanelTab;
    label: string;
    icon: typeof Film;
  }> = [
    {id: 'media', label: 'Media', icon: Film},
    {id: 'motion', label: 'Effects', icon: Move},
    {id: 'filters', label: 'Color', icon: Sliders},
    {id: 'bg-remove', label: 'BG Cut', icon: Eraser},
    {id: 'stickers', label: 'Stickers', icon: Smile},
    {id: 'text', label: 'Text', icon: TypeIcon},
    {id: 'audio', label: 'Audio', icon: Music},
    {id: 'ai', label: 'AI', icon: Sparkles},
  ];

  const handleSelectTimelineItem = useCallback(
    (item: SelectedTimelineItem) => {
      setSelectedItem(item);
      if (item?.track === 'overlay') {
        const target = overlayLayers.find((o) => o.id === item.id);
        if (target && target.kind !== 'sticker') {
          setBgTargetKey(item.id);
        }
      } else if (item?.track === 'video') {
        setBgTargetKey('main');
      } else if (item?.track === 'effect') {
        setMobileBottomTab((prev) => (prev === 'filters' ? prev : 'motion'));
      } else if (item?.track === 'text') {
        setActiveRightTab('text');
        if (layoutMode === 'mobile-portrait') {
          setMobileBottomTab('text');
        }
      } else if (item?.track === 'audio') {
        setActiveRightTab('audio');
        if (layoutMode === 'mobile-portrait') {
          setMobileBottomTab('audio');
        }
      }
    },
    [overlayLayers, layoutMode]
  );

  const previewNode = (
    <PreviewCanvasPlayer
      videoClips={videoClips}
      effectItems={effectItems}
      overlayLayers={overlayLayers}
      audioClips={audioClips}
      textOverlays={textOverlays}
      selectedOverlayId={selectedOverlayId}
      selectedTextId={selectedTextId}
      aspectRatio={aspectRatio}
      fitMode={fitMode}
      filters={filters}
      motionTransform={motionTransform}
      mainBgRemoval={mainBgRemoval}
      audioSettings={audioSettings}
      beatTimes={beatTimes}
      currentTime={currentTime}
      totalDuration={totalDuration}
      isPlaying={isPlaying}
      isFullPreview={isFullPreview}
      layoutMode={layoutMode}
      onToggleFullPreview={() => setIsFullPreview((f) => !f)}
      onAspectRatioChange={setAspectRatio}
      onFitModeChange={setFitMode}
      onTimeChange={setCurrentTime}
      onPlayStateChange={setIsPlaying}
      onSelectOverlay={handleSelectOverlay}
      onUpdateOverlay={handleUpdateOverlay}
      onDeleteOverlay={handleDeleteOverlay}
      onOpenBgRemoveForOverlay={handleOpenBgRemoveForOverlay}
      onSelectTextOverlay={handleSelectTextOverlay}
      onMoveTextOverlay={handleMoveTextOverlay}
      onOpenUpload={() => fileInputRef.current?.click()}
      canvasRef={canvasRef}
      captureRawFrameRef={captureRawFrameRef}
    />
  );

  const timelineNode = (
    <TimelinePanel
      videoClips={videoClips}
      effectItems={effectItems}
      overlayLayers={overlayLayers}
      audioClips={audioClips}
      textOverlays={textOverlays}
      selectedItem={selectedItem}
      currentTime={currentTime}
      totalDuration={totalDuration}
      playbackSpeed={audioSettings.playbackSpeed}
      beatTimes={beatTimes}
      layoutMode={layoutMode}
      canUndo={historyCounts.canUndo}
      canRedo={historyCounts.canRedo}
      onUndo={handleUndo}
      onRedo={handleRedo}
      onSelectItem={handleSelectTimelineItem}
      onSeek={(time) => {
        setIsPlaying(false);
        setCurrentTime(time);
      }}
      onSplitSelected={handleSplitSelected}
      onFreezeFrame={handleFreezeFrame}
      onDeleteSelected={handleDeleteSelected}
      onTrimVideoClip={handleTrimVideoClip}
      onUpdateClipTransition={handleUpdateClipTransition}
      onUpdateEffectItem={handleUpdateEffectItem}
      onUpdateOverlay={handleUpdateOverlay}
      onUpdateAudioClip={handleUpdateAudioClip}
      onUpdateTextOverlay={handleUpdateTextOverlay}
    />
  );

  const renderMediaSidebar = (embedded: boolean) => (
    <MediaSidebar
      isCollapsed={leftCollapsed}
      onToggleCollapse={() => setLeftCollapsed((c) => !c)}
      embedded={embedded}
      assets={mediaAssets}
      errorMessage={uploadError}
      onUploadFiles={handleUploadMediaFiles}
      onTriggerUpload={() => fileInputRef.current?.click()}
      onAddVideoToTimeline={handleAddVideoToTimeline}
      onAddOverlayToTimeline={handleAddOverlayToTimeline}
      onRemoveAsset={handleRemoveAsset}
    />
  );

  const renderRightEditorPanel = (
    embedded: boolean,
    hideTabBar: boolean,
    tabOverride?: RightPanelTab
  ) => (
    <RightEditorPanel
      isCollapsed={rightCollapsed}
      onToggleCollapse={() => setRightCollapsed((c) => !c)}
      embedded={embedded}
      hideTabBar={hideTabBar}
      activeTab={tabOverride ?? activeRightTab}
      onTabChange={handleTabChange}
      onCloseEffectInspector={handleCloseEffectInspector}
      motionTransform={motionTransform}
      onUpdateMotionTransform={handleUpdateMotionTransform}
      onResetMotionTransform={handleResetMotionTransform}
      videoClips={videoClips}
      selectedVideoClipId={selectedVideoClipId}
      onSelectVideoClip={(id) => setSelectedItem({track: 'video', id})}
      onUpdateClipTransition={handleUpdateClipTransition}
      effectItems={effectItems}
      selectedEffect={selectedEffect}
      onSelectEffectItem={handleSelectEffectItem}
      onAddTimelineEffect={handleAddTimelineEffect}
      onUpdateEffectItem={handleUpdateEffectItem}
      onDeleteEffectItem={handleDeleteEffectItem}
      filters={filters}
      onUpdateFilters={handleUpdateFilters}
      onApplyFilterPreset={handleApplyFilterPreset}
      onResetFilters={handleResetFilters}
      bgTargetKey={bgTargetKey}
      onChangeBgTargetKey={setBgTargetKey}
      mainBgRemoval={mainBgRemoval}
      overlayLayers={overlayLayers}
      mediaAssets={mediaAssets}
      onUpdateMainBgRemoval={handleUpdateMainBgRemoval}
      onUpdateOverlayBgRemoval={handleUpdateOverlayBgRemoval}
      onUploadBackgroundReplacement={handleUploadBackgroundReplacement}
      selectedOverlay={selectedOverlay}
      onAddStickerOverlay={handleAddStickerOverlay}
      onAddJitLogoWatermark={(corner) => {
        void handleAddJitLogoWatermark(corner);
      }}
      onSelectOverlay={handleSelectOverlay}
      onUpdateOverlay={handleUpdateOverlay}
      onDeleteOverlay={handleDeleteOverlay}
      textOverlays={textOverlays}
      selectedTextId={selectedTextId}
      totalDuration={totalDuration}
      currentTime={currentTime}
      onAddTextOverlay={handleAddTextOverlay}
      onSelectTextOverlay={handleSelectTextOverlay}
      onUpdateTextOverlay={handleUpdateTextOverlay}
      onDeleteTextOverlay={handleDeleteTextOverlay}
      audioAssets={audioAssets}
      audioClips={audioClips}
      audioSettings={audioSettings}
      selectedAudioClip={selectedAudioClip}
      beatSync={beatSync}
      beatAnalyzing={beatAnalyzing}
      beatError={beatError}
      onAnalyzeBeats={(clipId) => {
        void handleAnalyzeBeats(clipId);
      }}
      onClearBeats={handleClearBeats}
      onSeek={(time) => {
        setIsPlaying(false);
        setCurrentTime(time);
      }}
      onUploadAudioFiles={handleUploadAudioFiles}
      onAddAudioToTimeline={handleAddAudioToTimeline}
      onUpdateAudioClip={handleUpdateAudioClip}
      onAddBuiltInSfx={(kind) => {
        void handleAddBuiltInSfx(kind);
      }}
      onUpdateAudioSettings={(patch) =>
        setAudioSettings((prev) => ({...prev, ...patch}))
      }
      clipNames={clipNames}
      aspectRatio={aspectRatio}
      onCaptureFrameDataUrl={handleCaptureFrameDataUrl}
      onAddAICaption={handleAddAICaption}
      onAddAllAICaptions={handleAddAllAICaptions}
    />
  );

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#0B0D10] text-zinc-100 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <Header
        canExport={videoClips.length > 0 || overlayLayers.length > 0}
        isExporting={isExporting}
        onExportClick={handleStartExport}
        layoutMode={layoutMode}
        isFullscreen={isDocFullscreen || isFullPreview}
        onToggleFullscreen={() => {
          void handleToggleFullscreen();
        }}
        landscapeDrawer={landscapeDrawer}
        onToggleLandscapeDrawer={handleToggleLandscapeDrawer}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,image/png,image/jpeg,image/webp,.mp4,.webm,.png,.jpg,.jpeg,.webp"
        multiple
        onChange={handleFileInputChange}
        className="sr-only"
        aria-label="Upload MP4, WebM, PNG, JPG, or WebP files"
      />

      {isFullPreview ? (
        <main className="flex-1 min-h-0 flex overflow-hidden">
          {previewNode}
        </main>
      ) : layoutMode === 'mobile-portrait' ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Upper Preview Area (~38% height) */}
          <div className="h-[38%] min-h-0 shrink-0 flex flex-col overflow-hidden">
            {previewNode}
          </div>

          {/* Middle Multi-Track Timeline (~30% height) */}
          <div className="h-[30%] min-h-0 shrink-0 flex flex-col overflow-hidden">
            {timelineNode}
          </div>

          {/* Bottom Tool Drawer + Scrollable Icon Bar (~32% height) */}
          <div className="h-[32%] min-h-0 shrink-0 flex flex-col border-t border-zinc-800/80 bg-[#12151B] overflow-hidden">
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {mobileBottomTab === 'media'
                ? renderMediaSidebar(true)
                : renderRightEditorPanel(true, true, mobileBottomTab)}
            </div>

            <nav
              aria-label="Mobile editor tools"
              className="h-11 shrink-0 border-t border-zinc-800/80 bg-[#0E1116] flex items-center overflow-x-auto no-scrollbar px-1 gap-0.5"
            >
              {mobileNavItems.map(({id, label, icon: Icon}) => {
                const isActive = mobileBottomTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setMobileBottomTab(id);
                      if (id !== 'media') {
                        handleTabChange(id);
                      }
                    }}
                    aria-pressed={isActive}
                    className={`min-w-[54px] shrink-0 h-full px-1.5 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors rounded-md ${
                      isActive
                        ? 'text-blue-400 bg-blue-500/10'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      ) : layoutMode === 'mobile-landscape' ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
          <div className="flex-[55] min-h-0 flex flex-col overflow-hidden">
            {previewNode}
          </div>
          <div className="flex-[45] min-h-0 flex flex-col overflow-hidden">
            {timelineNode}
          </div>

          {landscapeDrawer !== 'none' && (
            <>
              <div
                onClick={() => setLandscapeDrawer('none')}
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[1px]"
                aria-hidden="true"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label={
                  landscapeDrawer === 'media'
                    ? 'Media Library Drawer'
                    : 'Editor Tools Drawer'
                }
                className={`fixed top-10 bottom-0 z-50 w-[min(320px,82vw)] bg-[#12151B] border-zinc-800 shadow-2xl flex flex-col overflow-hidden ${
                  landscapeDrawer === 'media'
                    ? 'left-0 border-r'
                    : 'right-0 border-l'
                }`}
              >
                <div className="h-9 shrink-0 px-3 border-b border-zinc-800/80 bg-[#0F1218] flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
                    {landscapeDrawer === 'media'
                      ? 'Media Upload'
                      : 'Editor Tools'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLandscapeDrawer('none')}
                    aria-label="Close drawer"
                    className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  {landscapeDrawer === 'media'
                    ? renderMediaSidebar(true)
                    : renderRightEditorPanel(true, false)}
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <main className="flex-1 min-h-0 flex overflow-hidden">
            {renderMediaSidebar(false)}
            {previewNode}
            {renderRightEditorPanel(false, false)}
          </main>
          {timelineNode}
        </>
      )}

      <ExportModal
        isOpen={exportModalOpen}
        isExporting={isExporting}
        progress={exportProgress}
        phase={exportPhase}
        error={exportError}
        downloadUrl={exportDownloadUrl}
        downloadFilename={exportFilename}
        onCancel={handleCancelExport}
        onClose={() => setExportModalOpen(false)}
      />
    </div>
  );
}
