import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {ExportModal} from './components/ExportModal';
import {Header} from './components/Header';
import {MediaSidebar} from './components/MediaSidebar';
import {PreviewCanvasPlayer} from './components/PreviewCanvasPlayer';
import {RightEditorPanel} from './components/RightEditorPanel';
import {TimelinePanel} from './components/TimelinePanel';
import {
  DEFAULT_BG_REMOVAL,
  DEFAULT_MOTION_TRANSFORM,
  type AIStudioCaption,
  type AspectRatioPreset,
  type AudioAsset,
  type AudioSettings,
  type BackgroundRemovalConfig,
  type ClipTransition,
  type FilterPreset,
  type MediaAsset,
  type MotionTransform,
  type OverlayLayerItem,
  type RightPanelTab,
  type SelectedTimelineItem,
  type TextOverlayItem,
  type TimelineAudioClip,
  type TimelineVideoClip,
  type VideoFilters,
  type VideoFitMode,
} from './types/editor';
import {clearMaskCache} from './utils/backgroundRemover';
import {FILTER_PRESET_VALUES} from './utils/canvasRenderer';
import {exportEditedVideo} from './utils/exportVideo';
import {
  computeTotalTimelineDuration,
  computeVideoTimelineSegments,
  extractAudioDuration,
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
  preset: 'none',
};

const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  videoVolume: 1,
  videoMuted: false,
  musicVolume: 0.7,
  musicMuted: false,
  playbackSpeed: 1,
};

const DEFAULT_TRANSITION: ClipTransition = {
  type: 'none',
  duration: 0.8,
};

export default function App() {
  // Responsive Layout & Collapse State
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isFullPreview, setIsFullPreview] = useState(false);

  // Media Libraries
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [audioAssets, setAudioAssets] = useState<AudioAsset[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Multi-Track Timeline State
  const [videoClips, setVideoClips] = useState<TimelineVideoClip[]>([]);
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

  useEffect(() => {
    const activeUrls = urlsRef.current;
    return () => {
      activeUrls.forEach((url) => URL.revokeObjectURL(url));
      activeUrls.clear();
    };
  }, []);

  useEffect(() => {
    if (!isFullPreview) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullPreview(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullPreview]);

  const totalDuration = useMemo(
    () =>
      computeTotalTimelineDuration(
        videoClips,
        overlayLayers,
        audioClips,
        textOverlays,
        audioSettings.playbackSpeed
      ),
    [
      videoClips,
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

  const selectedOverlayId =
    selectedItem?.track === 'overlay' ? selectedItem.id : null;
  const selectedTextId =
    selectedItem?.track === 'text' ? selectedItem.id : null;

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
    [mainBgRemoval.replacementAssetId]
  );

  // Freeze Frame Insertion (3-second still image segment at playhead)
  const handleFreezeFrame = useCallback(() => {
    const captureFn = captureRawFrameRef.current;
    if (!captureFn) return;
    const dataUrl = captureFn();
    if (!dataUrl) return;

    const segments = computeVideoTimelineSegments(
      videoClips,
      audioSettings.playbackSpeed
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
        const mult = seg.clip.kind === 'freeze' ? 1 : audioSettings.playbackSpeed;
        const splitSource = seg.clip.trimStart + elapsedInSeg * mult;
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
  }, [videoClips, audioSettings.playbackSpeed, currentTime]);

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

  const handleOpenBgRemoveForOverlay = useCallback((id: string) => {
    setBgTargetKey(id);
    setActiveRightTab('bg-remove');
    setRightCollapsed(false);
  }, []);

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
  }, [currentTime, totalDuration]);

  const handleSelectTextOverlay = useCallback((id: string) => {
    setSelectedItem({track: 'text', id});
    setActiveRightTab('text');
  }, []);

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
        audioSettings.playbackSpeed
      );
      const seg = segments.find((s) => s.clip.id === selectedItem.id);
      if (!seg) return;
      if (
        currentTime <= seg.timelineStart + 0.15 ||
        currentTime >= seg.timelineEnd - 0.15
      ) {
        return;
      }

      const mult = seg.clip.kind === 'freeze' ? 1 : audioSettings.playbackSpeed;
      const splitSourceTime =
        seg.clip.trimStart + (currentTime - seg.timelineStart) * mult;

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
    }
  }, [
    selectedItem,
    videoClips,
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
    } else if (selectedItem.track === 'overlay') {
      clearMaskCache(`overlay-${selectedItem.id}`);
      setOverlayLayers((prev) => prev.filter((o) => o.id !== selectedItem.id));
      if (bgTargetKey === selectedItem.id) {
        setBgTargetKey('main');
      }
    } else if (selectedItem.track === 'audio') {
      setAudioClips((prev) => prev.filter((c) => c.id !== selectedItem.id));
    } else if (selectedItem.track === 'text') {
      setTextOverlays((prev) => prev.filter((t) => t.id !== selectedItem.id));
    }
    setSelectedItem(null);
  }, [selectedItem, bgTargetKey]);

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
    setFilters({preset, ...presetValues});
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
        overlayLayers,
        audioClips,
        textOverlays,
        aspectRatio,
        fitMode,
        filters,
        motionTransform,
        mainBgRemoval,
        audioSettings,
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
    overlayLayers,
    audioClips,
    textOverlays,
    aspectRatio,
    fitMode,
    filters,
    motionTransform,
    mainBgRemoval,
    audioSettings,
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

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0B0D10] text-zinc-100 flex flex-col">
      <Header
        canExport={videoClips.length > 0 || overlayLayers.length > 0}
        isExporting={isExporting}
        onExportClick={handleStartExport}
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

      <main className="flex-1 min-h-0 flex overflow-hidden">
        {!isFullPreview && (
          <MediaSidebar
            isCollapsed={leftCollapsed}
            onToggleCollapse={() => setLeftCollapsed((c) => !c)}
            assets={mediaAssets}
            errorMessage={uploadError}
            onUploadFiles={handleUploadMediaFiles}
            onTriggerUpload={() => fileInputRef.current?.click()}
            onAddVideoToTimeline={handleAddVideoToTimeline}
            onAddOverlayToTimeline={handleAddOverlayToTimeline}
            onRemoveAsset={handleRemoveAsset}
          />
        )}

        <PreviewCanvasPlayer
          videoClips={videoClips}
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
          currentTime={currentTime}
          totalDuration={totalDuration}
          isPlaying={isPlaying}
          isFullPreview={isFullPreview}
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

        {!isFullPreview && (
          <RightEditorPanel
            isCollapsed={rightCollapsed}
            onToggleCollapse={() => setRightCollapsed((c) => !c)}
            activeTab={activeRightTab}
            onTabChange={setActiveRightTab}
            motionTransform={motionTransform}
            onUpdateMotionTransform={handleUpdateMotionTransform}
            onResetMotionTransform={handleResetMotionTransform}
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
            textOverlays={textOverlays}
            selectedTextId={selectedTextId}
            totalDuration={totalDuration}
            currentTime={currentTime}
            onAddTextOverlay={handleAddTextOverlay}
            onSelectTextOverlay={handleSelectTextOverlay}
            onUpdateTextOverlay={handleUpdateTextOverlay}
            onDeleteTextOverlay={handleDeleteTextOverlay}
            audioAssets={audioAssets}
            audioSettings={audioSettings}
            onUploadAudioFiles={handleUploadAudioFiles}
            onAddAudioToTimeline={handleAddAudioToTimeline}
            onUpdateAudioSettings={(patch) =>
              setAudioSettings((prev) => ({...prev, ...patch}))
            }
            clipNames={clipNames}
            aspectRatio={aspectRatio}
            onCaptureFrameDataUrl={handleCaptureFrameDataUrl}
            onAddAICaption={handleAddAICaption}
            onAddAllAICaptions={handleAddAllAICaptions}
          />
        )}
      </main>

      {!isFullPreview && (
        <TimelinePanel
          videoClips={videoClips}
          overlayLayers={overlayLayers}
          audioClips={audioClips}
          textOverlays={textOverlays}
          selectedItem={selectedItem}
          currentTime={currentTime}
          totalDuration={totalDuration}
          playbackSpeed={audioSettings.playbackSpeed}
          onSelectItem={(item) => {
            setSelectedItem(item);
            if (item?.track === 'overlay') {
              setBgTargetKey(item.id);
            } else if (item?.track === 'video') {
              setBgTargetKey('main');
            }
          }}
          onSeek={(time) => {
            setIsPlaying(false);
            setCurrentTime(time);
          }}
          onSplitSelected={handleSplitSelected}
          onFreezeFrame={handleFreezeFrame}
          onDeleteSelected={handleDeleteSelected}
          onTrimVideoClip={handleTrimVideoClip}
          onUpdateClipTransition={handleUpdateClipTransition}
          onUpdateOverlay={handleUpdateOverlay}
          onUpdateAudioClip={handleUpdateAudioClip}
          onUpdateTextOverlay={handleUpdateTextOverlay}
        />
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
