import {useRef, useState, type ChangeEvent} from 'react';
import {
  Check,
  CloudRain,
  CloudSnow,
  Copy,
  Eraser,
  Film,
  FlipHorizontal,
  FlipVertical,
  Move,
  Music,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RotateCcw,
  Sliders,
  Smile,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Upload,
  Volume2,
  VolumeX,
  Wind,
  X,
} from 'lucide-react';
import type {
  AIStudioCaption,
  AIStudioResult,
  AspectRatioPreset,
  AudioAsset,
  AudioEffectsConfig,
  AudioSettings,
  BackgroundRemovalConfig,
  BackgroundRemovalMode,
  BackgroundReplacementType,
  BeatSyncAnalysis,
  BuiltInSfxKind,
  ClipTransition,
  FaceAnchorPreset,
  FilterPreset,
  MediaAsset,
  MotionTransform,
  OverlayAnimationPreset,
  OverlayLayerItem,
  RightPanelTab,
  SpeedRampMode,
  StickerKind,
  TextOverlayItem,
  TimelineAudioClip,
  TimelineEffectItem,
  TimelineEffectType,
  TimelineVideoClip,
  VideoFilters,
  VoiceChangerPreset,
  WeatherEffectType,
} from '../types/editor';
import {warmUpSelfieSegmentation} from '../utils/backgroundRemover';
import {
  EFFECT_CATALOG,
  FACE_ANCHOR_POSITIONS,
  getEffectCatalogEntry,
  getEffectIntensityLabel,
  JIT_LOGO_URL,
  OVERLAY_ANIMATION_OPTIONS,
  TRANSITION_OPTIONS,
  WATERMARK_CORNER_POSITIONS,
  type WatermarkCorner,
} from '../utils/effectCatalog';
import {formatFileSize, formatTime} from '../utils/formatTime';
import {BUILT_IN_SFX_LIST, playSfxPreview} from '../utils/soundEffects';
import {STICKER_CATALOG} from '../utils/stickerRenderer';

interface RightEditorPanelProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  embedded?: boolean;
  hideTabBar?: boolean;
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  onCloseEffectInspector: () => void;
  // Motion & Transform + Timeline Effects tab
  motionTransform: MotionTransform;
  onUpdateMotionTransform: (patch: Partial<MotionTransform>) => void;
  onResetMotionTransform: () => void;
  videoClips: TimelineVideoClip[];
  selectedVideoClipId: string | null;
  onSelectVideoClip: (id: string) => void;
  onUpdateClipTransition: (clipId: string, transition: ClipTransition) => void;
  effectItems: TimelineEffectItem[];
  selectedEffect: TimelineEffectItem | null;
  onSelectEffectItem: (id: string) => void;
  onAddTimelineEffect: (type: TimelineEffectType) => void;
  onUpdateEffectItem: (id: string, patch: Partial<TimelineEffectItem>) => void;
  onDeleteEffectItem: (id: string) => void;
  // Filters & Color tab
  filters: VideoFilters;
  onUpdateFilters: (patch: Partial<VideoFilters>) => void;
  onApplyFilterPreset: (preset: FilterPreset) => void;
  onResetFilters: () => void;
  // BG Remove tab
  bgTargetKey: string;
  onChangeBgTargetKey: (key: string) => void;
  mainBgRemoval: BackgroundRemovalConfig;
  overlayLayers: OverlayLayerItem[];
  mediaAssets: MediaAsset[];
  onUpdateMainBgRemoval: (patch: Partial<BackgroundRemovalConfig>) => void;
  onUpdateOverlayBgRemoval: (
    overlayId: string,
    patch: Partial<BackgroundRemovalConfig>
  ) => void;
  onUploadBackgroundReplacement: (file: File) => void;
  // Stickers & Face + JIT Watermark tab
  selectedOverlay: OverlayLayerItem | null;
  onAddStickerOverlay: (kind: StickerKind) => void;
  onAddJitLogoWatermark: (corner: WatermarkCorner) => void;
  onSelectOverlay: (id: string) => void;
  onUpdateOverlay: (id: string, patch: Partial<OverlayLayerItem>) => void;
  onDeleteOverlay: (id: string) => void;
  // Text tab
  textOverlays: TextOverlayItem[];
  selectedTextId: string | null;
  totalDuration: number;
  currentTime: number;
  onAddTextOverlay: () => void;
  onSelectTextOverlay: (id: string) => void;
  onUpdateTextOverlay: (id: string, patch: Partial<TextOverlayItem>) => void;
  onDeleteTextOverlay: (id: string) => void;
  // Audio & Speed + SFX + Beat Sync tab
  audioAssets: AudioAsset[];
  audioClips: TimelineAudioClip[];
  audioSettings: AudioSettings;
  selectedAudioClip: TimelineAudioClip | null;
  beatSync: BeatSyncAnalysis | null;
  beatAnalyzing: boolean;
  beatError: string | null;
  onAnalyzeBeats: (clipId: string) => void;
  onClearBeats: () => void;
  onSeek: (time: number) => void;
  onUploadAudioFiles: (files: FileList | File[]) => void;
  onAddAudioToTimeline: (asset: AudioAsset) => void;
  onUpdateAudioClip: (id: string, patch: Partial<TimelineAudioClip>) => void;
  onAddBuiltInSfx: (kind: BuiltInSfxKind) => void;
  onUpdateAudioSettings: (patch: Partial<AudioSettings>) => void;
  // AI Studio tab
  clipNames: string[];
  aspectRatio: AspectRatioPreset;
  onCaptureFrameDataUrl: () => string | null;
  onAddAICaption: (caption: AIStudioCaption) => void;
  onAddAllAICaptions: (captions: AIStudioCaption[]) => void;
}

const FONT_OPTIONS = [
  {label: 'Plus Jakarta Sans', value: 'Plus Jakarta Sans'},
  {label: 'Outfit', value: 'Outfit'},
  {label: 'JetBrains Mono', value: 'JetBrains Mono'},
  {label: 'Georgia Serif', value: 'Georgia'},
  {label: 'Impact Display', value: 'Impact'},
];

const TEXT_COLOR_SWATCHES = [
  '#FFFFFF',
  '#FACC15',
  '#38BDF8',
  '#F87171',
  '#4ADE80',
  '#09090B',
];

const FILTER_PRESETS: Array<{id: FilterPreset; label: string}> = [
  {id: 'none', label: 'Original'},
  {id: 'teal-orange', label: 'Teal & Orange'},
  {id: 'cyberpunk', label: 'Cyberpunk Neon'},
  {id: 'noir', label: 'Noir B&W'},
  {id: 'warm-sunset', label: 'Warm Sunset'},
  {id: 'glitch', label: 'Glitch'},
  {id: 'cinematic', label: 'Cinematic'},
  {id: 'vintage', label: 'Vintage'},
  {id: 'bw', label: 'B&W'},
  {id: 'warm', label: 'Warm'},
];

const CHROMA_SWATCHES = [
  {label: 'Green Screen', hex: '#00FF00'},
  {label: 'Studio Green', hex: '#00B140'},
  {label: 'Blue Screen', hex: '#0047BB'},
];

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const WEATHER_OPTIONS: Array<{
  type: WeatherEffectType;
  label: string;
  icon: typeof CloudRain;
}> = [
  {type: 'rain', label: 'Rain', icon: CloudRain},
  {type: 'snow', label: 'Snow', icon: CloudSnow},
  {type: 'smoke', label: 'Smoke / Fog', icon: Wind},
];

export function RightEditorPanel({
  isCollapsed,
  onToggleCollapse,
  embedded = false,
  hideTabBar = false,
  activeTab,
  onTabChange,
  onCloseEffectInspector,
  motionTransform,
  onUpdateMotionTransform,
  onResetMotionTransform,
  videoClips,
  selectedVideoClipId,
  onSelectVideoClip,
  onUpdateClipTransition,
  effectItems,
  selectedEffect,
  onSelectEffectItem,
  onAddTimelineEffect,
  onUpdateEffectItem,
  onDeleteEffectItem,
  filters,
  onUpdateFilters,
  onApplyFilterPreset,
  onResetFilters,
  bgTargetKey,
  onChangeBgTargetKey,
  mainBgRemoval,
  overlayLayers,
  mediaAssets,
  onUpdateMainBgRemoval,
  onUpdateOverlayBgRemoval,
  onUploadBackgroundReplacement,
  selectedOverlay,
  onAddStickerOverlay,
  onAddJitLogoWatermark,
  onSelectOverlay,
  onUpdateOverlay,
  onDeleteOverlay,
  textOverlays,
  selectedTextId,
  totalDuration,
  currentTime,
  onAddTextOverlay,
  onSelectTextOverlay,
  onUpdateTextOverlay,
  onDeleteTextOverlay,
  audioAssets,
  audioClips,
  audioSettings,
  selectedAudioClip,
  beatSync,
  beatAnalyzing,
  beatError,
  onAnalyzeBeats,
  onClearBeats,
  onSeek,
  onUploadAudioFiles,
  onAddAudioToTimeline,
  onUpdateAudioClip,
  onAddBuiltInSfx,
  onUpdateAudioSettings,
  clipNames,
  aspectRatio,
  onCaptureFrameDataUrl,
  onAddAICaption,
  onAddAllAICaptions,
}: RightEditorPanelProps) {
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);

  const [watermarkCorner, setWatermarkCorner] =
    useState<WatermarkCorner>('top-right');
  const [previewingSfx, setPreviewingSfx] = useState<BuiltInSfxKind | null>(
    null
  );

  const [aiTopic, setAiTopic] = useState('');
  const [aiTone, setAiTone] = useState('Engaging');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AIStudioResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [addedCaptionKeys, setAddedCaptionKeys] = useState<Set<number>>(
    new Set()
  );

  const selectedText =
    textOverlays.find((item) => item.id === selectedTextId) ?? null;

  const transitionableClips = videoClips.slice(1);
  const activeTransitionClip =
    transitionableClips.find((c) => c.id === selectedVideoClipId) ??
    transitionableClips[0] ??
    null;

  const targetOverlay =
    bgTargetKey !== 'main'
      ? overlayLayers.find((l) => l.id === bgTargetKey) ?? null
      : null;
  const activeBgConfig = targetOverlay ? targetOverlay.bgRemoval : mainBgRemoval;

  const updateTargetBgRemoval = (patch: Partial<BackgroundRemovalConfig>) => {
    if (patch.mode === 'ai-person') {
      void warmUpSelfieSegmentation();
    }
    if (targetOverlay) {
      onUpdateOverlayBgRemoval(targetOverlay.id, patch);
    } else {
      onUpdateMainBgRemoval(patch);
    }
  };

  const handleAudioFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      onUploadAudioFiles(event.target.files);
      event.target.value = '';
    }
  };

  const handleBgReplacementFileChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (file) {
      onUploadBackgroundReplacement(file);
      event.target.value = '';
    }
  };

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleGenerateAI = async () => {
    setAiLoading(true);
    setAiError(null);
    setAddedCaptionKeys(new Set());

    try {
      const frameDataUrl = onCaptureFrameDataUrl();
      const response = await fetch('/api/gemini/studio', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          topic: aiTopic,
          clipNames,
          durationSeconds: Math.max(5, totalDuration || 15),
          aspectRatio,
          tone: aiTone,
          frameDataUrl: frameDataUrl ?? undefined,
        }),
      });

      const rawText = await response.text();
      let data: Partial<AIStudioResult> & {error?: string} = {};
      try {
        data = JSON.parse(rawText) as Partial<AIStudioResult> & {
          error?: string;
        };
      } catch {
        throw new Error(
          response.ok
            ? 'Received an invalid response from AI Studio.'
            : `AI Studio service unavailable (${response.status}). Check your Gemini API key configuration.`
        );
      }
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate AI suggestions.');
      }
      setAiResult({
        titles: Array.isArray(data.titles) ? data.titles : [],
        description:
          typeof data.description === 'string' ? data.description : '',
        hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
        captions: Array.isArray(data.captions) ? data.captions : [],
      });
    } catch (err) {
      setAiError(
        err instanceof Error
          ? err.message
          : 'Unable to reach AI Studio service.'
      );
    } finally {
      setAiLoading(false);
    }
  };

  const updateAudioEffects = (patch: Partial<AudioEffectsConfig>) => {
    onUpdateAudioSettings({
      effects: {
        ...audioSettings.effects,
        ...patch,
      },
    });
  };

  const tabs: Array<{
    id: RightPanelTab;
    label: string;
    shortLabel: string;
    icon: typeof TypeIcon;
  }> = [
    {id: 'motion', label: 'Motion & Effects', shortLabel: 'Effects', icon: Move},
    {id: 'filters', label: 'Filters & Color', shortLabel: 'Color', icon: Sliders},
    {id: 'bg-remove', label: 'BG Remove', shortLabel: 'BG Cut', icon: Eraser},
    {id: 'stickers', label: 'Stickers & Face', shortLabel: 'Stickers', icon: Smile},
    {id: 'text', label: 'Text', shortLabel: 'Text', icon: TypeIcon},
    {id: 'audio', label: 'Audio & SFX', shortLabel: 'Audio', icon: Music},
    {id: 'ai', label: 'AI Studio', shortLabel: 'AI', icon: Sparkles},
  ];

  if (!embedded && isCollapsed) {
    return (
      <aside
        aria-label="Editing Inspector (collapsed)"
        className="w-10 shrink-0 border-l border-zinc-800/80 bg-[#12151B] flex flex-col items-center py-2.5 gap-2"
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand Editing Panel"
          aria-label="Expand Editing Panel"
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <PanelRightOpen className="w-4 h-4" aria-hidden="true" />
        </button>

        <div className="w-5 h-px bg-zinc-800" />

        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                onTabChange(tab.id);
                onToggleCollapse();
              }}
              title={tab.label}
              aria-label={tab.label}
              className={`p-1.5 rounded-md transition-colors ${
                active
                  ? 'bg-blue-600/20 text-blue-300'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
            </button>
          );
        })}
      </aside>
    );
  }

  return (
    <aside
      aria-label="Editing Inspector"
      className={
        embedded
          ? 'w-full flex-1 min-h-0 bg-[#12151B] flex flex-col'
          : 'w-72 shrink-0 border-l border-zinc-800/80 bg-[#12151B] flex flex-col min-h-0'
      }
    >
      {/* Inspector Header */}
      {!embedded && (
        <div className="px-3 py-2 border-b border-zinc-800/70 flex items-center justify-between gap-2 bg-[#101319]">
          <span className="text-xs font-semibold text-zinc-200 whitespace-nowrap">
            {tabs.find((t) => t.id === activeTab)?.label ?? 'Tools'}
          </span>
          <button
            type="button"
            onClick={onToggleCollapse}
            title="Collapse Editing Panel"
            aria-label="Collapse Editing Panel"
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <PanelRightClose className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 7-Tab Bar */}
      {!hideTabBar && (
        <div
          role="tablist"
          aria-label="Editing Tools"
          className="shrink-0 grid grid-cols-7 border-b border-zinc-800/80 bg-[#0E1116]"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                title={tab.label}
                aria-selected={active}
                onClick={() => onTabChange(tab.id)}
                className={`py-2 px-0.5 flex flex-col items-center justify-center gap-1 text-[10px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-blue-500 text-zinc-100 bg-[#12151B]'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="truncate max-w-full">{tab.shortLabel}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Tab Body */}
      <div
        className={`flex-1 overflow-y-auto space-y-4 ${
          embedded ? 'p-3' : 'p-3.5'
        }`}
      >
        {/* Dedicated Active Effect Inspector Box (shown whenever an Effect block is added or selected) */}
        {selectedEffect && (
          <div className="rounded-xl border border-violet-500/50 bg-[#151923] p-3 space-y-3 shadow-lg">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-800">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm leading-none" aria-hidden="true">
                    {selectedEffect.icon}
                  </span>
                  <h3 className="text-xs font-semibold text-white truncate">
                    {selectedEffect.name}
                  </h3>
                </div>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  Selected Effect on Timeline
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="px-2 py-0.5 rounded bg-violet-500/20 border border-violet-500/40 text-[10px] font-mono tabular-nums text-violet-200">
                  {(selectedEffect.endTime - selectedEffect.startTime).toFixed(1)}s
                </span>
                <button
                  type="button"
                  onClick={onCloseEffectInspector}
                  title="Close Effect Inspector"
                  aria-label="Close Effect Inspector"
                  className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* (a) Exact Start Time & End Time (sec) */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="effect-start-sec"
                  className="block text-[10px] font-medium text-zinc-300 mb-1"
                >
                  Start Time (sec)
                </label>
                <input
                  id="effect-start-sec"
                  type="number"
                  min={0}
                  max={Math.max(0, Number((selectedEffect.endTime - 0.2).toFixed(2)))}
                  step={0.1}
                  value={Number(selectedEffect.startTime.toFixed(2))}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (!Number.isFinite(val)) return;
                    const clamped = Math.max(
                      0,
                      Math.min(selectedEffect.endTime - 0.2, val)
                    );
                    onUpdateEffectItem(selectedEffect.id, {startTime: clamped});
                  }}
                  className="w-full rounded-lg border border-zinc-700 bg-[#0B0D10] px-2 py-1 text-xs font-mono tabular-nums text-zinc-100 focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label
                  htmlFor="effect-end-sec"
                  className="block text-[10px] font-medium text-zinc-300 mb-1"
                >
                  End Time (sec)
                </label>
                <input
                  id="effect-end-sec"
                  type="number"
                  min={Number((selectedEffect.startTime + 0.2).toFixed(2))}
                  step={0.1}
                  value={Number(selectedEffect.endTime.toFixed(2))}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (!Number.isFinite(val)) return;
                    const clamped = Math.max(selectedEffect.startTime + 0.2, val);
                    onUpdateEffectItem(selectedEffect.id, {endTime: clamped});
                  }}
                  className="w-full rounded-lg border border-zinc-700 bg-[#0B0D10] px-2 py-1 text-xs font-mono tabular-nums text-zinc-100 focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>

            {/* (b) Effect Intensity / Amount + Low / Medium / High presets */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <label
                  htmlFor="selected-effect-intensity"
                  className="font-medium text-zinc-200"
                >
                  Effect Intensity / Amount
                </label>
                <span className="font-mono tabular-nums text-violet-300 font-semibold">
                  {Math.round(selectedEffect.intensity * 100)}%
                </span>
              </div>
              <input
                id="selected-effect-intensity"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selectedEffect.intensity}
                onChange={(e) =>
                  onUpdateEffectItem(selectedEffect.id, {
                    intensity: Number(e.target.value),
                  })
                }
                className="w-full accent-violet-500 cursor-pointer"
              />
              <div className="flex items-center justify-between gap-1 pt-0.5">
                {[
                  {label: 'Low', val: 0.25},
                  {label: 'Medium', val: 0.6},
                  {label: 'High', val: 0.95},
                ].map((preset) => {
                  const isCurrent =
                    Math.abs(selectedEffect.intensity - preset.val) < 0.08;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() =>
                        onUpdateEffectItem(selectedEffect.id, {
                          intensity: preset.val,
                        })
                      }
                      className={`flex-1 py-1 rounded border text-[10px] font-medium transition-colors ${
                        isCurrent
                          ? 'border-violet-400 bg-violet-500/25 text-violet-100'
                          : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-zinc-400">
                Level:{' '}
                <span className="text-zinc-200 font-medium">
                  {getEffectIntensityLabel(
                    selectedEffect.type,
                    selectedEffect.intensity
                  )}
                </span>
              </p>
            </div>

            {(selectedEffect.type === 'zoom-in' ||
              selectedEffect.type === 'zoom-out') && (
              <div className="pt-2 border-t border-zinc-800/80 space-y-2.5">
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <label
                      htmlFor="selected-zoom-target"
                      className="font-medium text-cyan-200"
                    >
                      Target Zoom %
                    </label>
                    <span className="font-mono tabular-nums text-cyan-300 font-semibold">
                      {Math.round(selectedEffect.targetZoom ?? 165)}%
                    </span>
                  </div>
                  <input
                    id="selected-zoom-target"
                    type="range"
                    min={110}
                    max={300}
                    step={1}
                    value={selectedEffect.targetZoom ?? 165}
                    onChange={(e) =>
                      onUpdateEffectItem(selectedEffect.id, {
                        targetZoom: Number(e.target.value),
                      })
                    }
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex items-center justify-between text-[10px] mb-0.5">
                      <label htmlFor="zoom-focus-x" className="text-zinc-300">
                        Center X
                      </label>
                      <span className="font-mono tabular-nums text-zinc-400">
                        {Math.round(selectedEffect.zoomCenterX ?? 50)}%
                      </span>
                    </div>
                    <input
                      id="zoom-focus-x"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={selectedEffect.zoomCenterX ?? 50}
                      onChange={(e) =>
                        onUpdateEffectItem(selectedEffect.id, {
                          zoomCenterX: Number(e.target.value),
                        })
                      }
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[10px] mb-0.5">
                      <label htmlFor="zoom-focus-y" className="text-zinc-300">
                        Center Y
                      </label>
                      <span className="font-mono tabular-nums text-zinc-400">
                        {Math.round(selectedEffect.zoomCenterY ?? 50)}%
                      </span>
                    </div>
                    <input
                      id="zoom-focus-y"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={selectedEffect.zoomCenterY ?? 50}
                      onChange={(e) =>
                        onUpdateEffectItem(selectedEffect.id, {
                          zoomCenterY: Number(e.target.value),
                        })
                      }
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onUpdateEffectItem(selectedEffect.id, {
                      zoomCenterX: 50,
                      zoomCenterY: 50,
                    })
                  }
                  className="w-full py-1 rounded border border-zinc-800 bg-[#0D1015] hover:border-zinc-700 text-[10px] text-zinc-300 transition-colors"
                >
                  Reset Focus (50%, 50%)
                </button>
              </div>
            )}

            {selectedEffect.type === 'speed-ramp' && (
              <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
                <span className="block text-[11px] font-medium text-cyan-200">
                  Speed Ramp Curve
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    {id: 'slow-mo', label: 'Slow-Mo Pulse'},
                    {id: 'speed-up', label: 'Speed Boost'},
                  ].map((modeOpt) => {
                    const currentMode = selectedEffect.speedRampMode ?? 'slow-mo';
                    const isModeActive = currentMode === modeOpt.id;
                    return (
                      <button
                        key={modeOpt.id}
                        type="button"
                        onClick={() =>
                          onUpdateEffectItem(selectedEffect.id, {
                            speedRampMode: modeOpt.id as SpeedRampMode,
                          })
                        }
                        className={`py-1.5 px-2 rounded-lg border text-[10px] font-medium transition-colors ${
                          isModeActive
                            ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                            : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                        }`}
                      >
                        {modeOpt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Opacity Slider (0% - 100%) */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <label
                  htmlFor="selected-effect-opacity"
                  className="font-medium text-zinc-200"
                >
                  Opacity
                </label>
                <span className="font-mono tabular-nums text-zinc-300">
                  {Math.round(selectedEffect.opacity * 100)}%
                </span>
              </div>
              <input
                id="selected-effect-opacity"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selectedEffect.opacity}
                onChange={(e) =>
                  onUpdateEffectItem(selectedEffect.id, {
                    opacity: Number(e.target.value),
                  })
                }
                className="w-full accent-blue-500 cursor-pointer"
              />
            </div>

            {/* (c) Prominent Red Remove Effect Button */}
            <button
              type="button"
              onClick={() => onDeleteEffectItem(selectedEffect.id)}
              className="w-full py-1.5 px-3 rounded-lg bg-red-600/90 hover:bg-red-500 text-[11px] font-semibold text-white inline-flex items-center justify-center gap-1.5 transition-colors shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Remove Effect</span>
            </button>
          </div>
        )}

        {activeTab === 'motion' && (
          <div className="space-y-4">
            {/* Weather / Atmosphere — Instant 1-Click Timeline Insertion */}
            <div className="space-y-2">
              <div>
                <h2 className="text-xs font-semibold text-zinc-100">
                  Weather &amp; Atmosphere
                </h2>
                <p className="text-[10px] text-zinc-400">
                  Click any effect to add a 4s block at playhead
                </p>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {WEATHER_OPTIONS.map((w) => {
                  const Icon = w.icon;
                  const active = selectedEffect?.type === w.type;
                  const meta = getEffectCatalogEntry(w.type);
                  return (
                    <button
                      key={w.type}
                      type="button"
                      onClick={() => onAddTimelineEffect(w.type)}
                      title={`Add 4s ${meta.name} block at playhead`}
                      className={`py-2 px-1.5 rounded-lg border flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${
                        active
                          ? 'border-violet-400 bg-violet-500/20 text-violet-100'
                          : 'border-zinc-800 bg-[#0D1015] text-zinc-200 hover:border-violet-500/60 hover:bg-violet-500/10'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 text-violet-300" aria-hidden="true" />
                      <span>+ {w.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Animated Camera & Speed Motion — Instant 1-Click Timeline Insertion */}
            <div className="pt-3 border-t border-zinc-800/80 space-y-2">
              <div>
                <h3 className="text-xs font-semibold text-zinc-100">
                  Camera &amp; Time Motion
                </h3>
                <p className="text-[10px] text-zinc-400">
                  Timed Zoom, Shake, Heartbeat &amp; Speed Ramp blocks
                </p>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {EFFECT_CATALOG.filter((e) => e.category === 'motion').map(
                  (opt) => {
                    const active = selectedEffect?.type === opt.type;
                    return (
                      <button
                        key={opt.type}
                        type="button"
                        onClick={() => onAddTimelineEffect(opt.type)}
                        className={`px-2 py-2 rounded-lg border text-[11px] font-medium inline-flex items-center justify-center gap-1 transition-colors truncate ${
                          active
                            ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                            : 'border-zinc-800 bg-[#0D1015] text-zinc-200 hover:border-cyan-500/60 hover:bg-cyan-500/10'
                        }`}
                      >
                        <span aria-hidden="true">{opt.icon}</span>
                        <span className="truncate">+ {opt.name}</span>
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {/* Curated Studio VFX Suite */}
            <div className="pt-3 border-t border-zinc-800/80 space-y-2">
              <div>
                <h3 className="text-xs font-semibold text-zinc-100">
                  Curated Studio VFX
                </h3>
                <p className="text-[10px] text-zinc-400">
                  One-click 4s block on Effects track with 0–100% intensity &amp; opacity
                </p>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {EFFECT_CATALOG.filter((e) => e.category === 'studio').map(
                  (ef) => {
                    const active = selectedEffect?.type === ef.type;
                    return (
                      <button
                        key={ef.type}
                        type="button"
                        onClick={() => onAddTimelineEffect(ef.type)}
                        className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors truncate ${
                          active
                            ? 'border-pink-400 bg-pink-500/20 text-pink-100'
                            : 'border-zinc-800 bg-[#0D1015] text-zinc-200 hover:border-pink-500/60 hover:bg-pink-500/10'
                        }`}
                      >
                        <span aria-hidden="true">{ef.icon}</span>
                        <span className="truncate">{ef.name}</span>
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {/* Global Static Transform & Framing */}
            <div className="pt-3 border-t border-zinc-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-zinc-100">
                  Static Transform &amp; Framing
                </h3>
                <button
                  type="button"
                  onClick={onResetMotionTransform}
                  className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-100"
                >
                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                  <span>Reset</span>
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="motion-zoom" className="text-zinc-300">
                    Zoom
                  </label>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {motionTransform.zoom}%
                  </span>
                </div>
                <input
                  id="motion-zoom"
                  type="range"
                  min={50}
                  max={300}
                  step={1}
                  value={motionTransform.zoom}
                  onChange={(e) =>
                    onUpdateMotionTransform({zoom: Number(e.target.value)})
                  }
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="motion-pan-x" className="text-zinc-300">
                    X Pan
                  </label>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {motionTransform.panX > 0
                      ? `+${motionTransform.panX}%`
                      : `${motionTransform.panX}%`}
                  </span>
                </div>
                <input
                  id="motion-pan-x"
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={motionTransform.panX}
                  onChange={(e) =>
                    onUpdateMotionTransform({panX: Number(e.target.value)})
                  }
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="motion-pan-y" className="text-zinc-300">
                    Y Pan
                  </label>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {motionTransform.panY > 0
                      ? `+${motionTransform.panY}%`
                      : `${motionTransform.panY}%`}
                  </span>
                </div>
                <input
                  id="motion-pan-y"
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={motionTransform.panY}
                  onChange={(e) =>
                    onUpdateMotionTransform({panY: Number(e.target.value)})
                  }
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="motion-rotate" className="text-zinc-300">
                    Rotate
                  </label>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {motionTransform.rotate}°
                  </span>
                </div>
                <input
                  id="motion-rotate"
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={motionTransform.rotate}
                  onChange={(e) =>
                    onUpdateMotionTransform({rotate: Number(e.target.value)})
                  }
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div className="pt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateMotionTransform({flipH: !motionTransform.flipH})
                  }
                  aria-pressed={motionTransform.flipH}
                  className={`py-2 px-2.5 rounded-lg border text-[11px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                    motionTransform.flipH
                      ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                      : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                  }`}
                >
                  <FlipHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Flip H</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateMotionTransform({flipV: !motionTransform.flipV})
                  }
                  aria-pressed={motionTransform.flipV}
                  className={`py-2 px-2.5 rounded-lg border text-[11px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                    motionTransform.flipV
                      ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                      : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                  }`}
                >
                  <FlipVertical className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Flip V</span>
                </button>
              </div>
            </div>

            {/* Clip Transitions between Video Segments */}
            <div className="pt-3 border-t border-zinc-800/80 space-y-2">
              <div>
                <h3 className="text-xs font-semibold text-zinc-100">
                  Clip Transitions
                </h3>
                <p className="text-[10px] text-zinc-400">
                  Smooth join between consecutive video clips
                </p>
              </div>

              {activeTransitionClip ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-zinc-400 shrink-0">
                      Incoming on:
                    </span>
                    {transitionableClips.length > 1 ? (
                      <select
                        aria-label="Target clip for incoming transition"
                        value={activeTransitionClip.id}
                        onChange={(e) => onSelectVideoClip(e.target.value)}
                        className="min-w-0 flex-1 rounded border border-zinc-700 bg-[#0B0D10] px-1.5 py-0.5 text-[10px] text-zinc-100"
                      >
                        {transitionableClips.map((c, idx) => (
                          <option key={c.id} value={c.id}>
                            #{idx + 2} {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[10px] text-zinc-200 font-medium truncate">
                        {activeTransitionClip.name}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {TRANSITION_OPTIONS.map((tr) => {
                      const active =
                        activeTransitionClip.transitionIn.type === tr.id;
                      return (
                        <button
                          key={tr.id}
                          type="button"
                          onClick={() =>
                            onUpdateClipTransition(activeTransitionClip.id, {
                              ...activeTransitionClip.transitionIn,
                              type: tr.id,
                            })
                          }
                          className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium transition-colors truncate ${
                            active
                              ? 'border-blue-500 bg-blue-500/20 text-blue-100'
                              : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                          }`}
                        >
                          {tr.label}
                        </button>
                      );
                    })}
                  </div>
                  {activeTransitionClip.transitionIn.type !== 'none' && (
                    <div>
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <label
                          htmlFor="panel-transition-dur"
                          className="text-zinc-300"
                        >
                          Transition Duration
                        </label>
                        <span className="font-mono tabular-nums text-zinc-400">
                          {activeTransitionClip.transitionIn.duration.toFixed(
                            1
                          )}
                          s
                        </span>
                      </div>
                      <input
                        id="panel-transition-dur"
                        type="range"
                        min={0.3}
                        max={2.5}
                        step={0.1}
                        value={activeTransitionClip.transitionIn.duration}
                        onChange={(e) =>
                          onUpdateClipTransition(activeTransitionClip.id, {
                            ...activeTransitionClip.transitionIn,
                            duration: Number(e.target.value),
                          })
                        }
                        className="w-full accent-blue-500 cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[10px] text-zinc-500 rounded-lg border border-dashed border-zinc-800 bg-[#0D1015] p-2">
                  Add 2+ clips (or Split a clip) to configure transitions.
                </p>
              )}
            </div>

            {effectItems.length > 0 && (
              <div className="pt-3 border-t border-zinc-800/80 space-y-1.5">
                <span className="block text-[10px] font-medium text-zinc-400">
                  Timeline Effects ({effectItems.length})
                </span>
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {effectItems.map((ef) => (
                    <div
                      key={ef.id}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1 text-[11px] ${
                        selectedEffect?.id === ef.id
                          ? 'border-violet-500 bg-violet-500/15 text-violet-100'
                          : 'border-zinc-800 bg-[#0D1015] text-zinc-300'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectEffectItem(ef.id)}
                        className="flex-1 text-left truncate"
                      >
                        {ef.icon} {ef.name} · {Math.round(ef.intensity * 100)}%
                      </button>
                      <span className="text-[10px] font-mono tabular-nums text-zinc-400 shrink-0">
                        {formatTime(ef.startTime)}–{formatTime(ef.endTime)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDeleteEffectItem(ef.id)}
                        aria-label={`Remove ${ef.name}`}
                        className="p-0.5 rounded text-zinc-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'filters' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold text-zinc-100">
                  Filters &amp; Color Grading
                </h2>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  Click any look to insert a 4s block on Effects track
                </p>
              </div>
              <button
                type="button"
                onClick={onResetFilters}
                className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-100 shrink-0"
              >
                <RotateCcw className="w-3 h-3" aria-hidden="true" />
                <span>Reset</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {FILTER_PRESETS.map((preset) => {
                const isOriginal = preset.id === 'none';
                const active = isOriginal
                  ? filters.preset === 'none'
                  : selectedEffect?.type === preset.id;
                const entry = !isOriginal
                  ? getEffectCatalogEntry(preset.id as TimelineEffectType)
                  : null;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      if (isOriginal) {
                        onApplyFilterPreset('none');
                      } else {
                        onAddTimelineEffect(preset.id as TimelineEffectType);
                      }
                    }}
                    className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors truncate ${
                      active
                        ? 'border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100'
                        : 'border-zinc-800 bg-[#0D1015] text-zinc-200 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/10'
                    }`}
                  >
                    {entry ? `${entry.icon} ${preset.label}` : preset.label}
                  </button>
                );
              })}
            </div>

            {/* Cinema & Film VFX Suite */}
            <div className="pt-3 border-t border-zinc-800/80 space-y-2">
              <div>
                <h3 className="text-xs font-semibold text-zinc-100">
                  Cinema &amp; Film VFX
                </h3>
                <p className="text-[10px] text-zinc-400">
                  Film bars, grain, flares, light leaks &amp; AI portrait
                </p>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {EFFECT_CATALOG.filter((e) => e.category === 'cinema').map(
                  (ef) => {
                    const active = selectedEffect?.type === ef.type;
                    return (
                      <button
                        key={ef.type}
                        type="button"
                        onClick={() => onAddTimelineEffect(ef.type)}
                        className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors truncate ${
                          active
                            ? 'border-amber-400 bg-amber-500/20 text-amber-100'
                            : 'border-zinc-800 bg-[#0D1015] text-zinc-200 hover:border-amber-500/60 hover:bg-amber-500/10'
                        }`}
                      >
                        <span aria-hidden="true">{ef.icon}</span>
                        <span className="truncate">{ef.name}</span>
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-zinc-800/80">
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="filter-brightness" className="text-zinc-300">
                    Brightness
                  </label>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {filters.brightness}%
                  </span>
                </div>
                <input
                  id="filter-brightness"
                  type="range"
                  min={20}
                  max={200}
                  value={filters.brightness}
                  onChange={(e) =>
                    onUpdateFilters({brightness: Number(e.target.value)})
                  }
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="filter-contrast" className="text-zinc-300">
                    Contrast
                  </label>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {filters.contrast}%
                  </span>
                </div>
                <input
                  id="filter-contrast"
                  type="range"
                  min={20}
                  max={200}
                  value={filters.contrast}
                  onChange={(e) =>
                    onUpdateFilters({contrast: Number(e.target.value)})
                  }
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="filter-saturation" className="text-zinc-300">
                    Saturation
                  </label>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {filters.saturation}%
                  </span>
                </div>
                <input
                  id="filter-saturation"
                  type="range"
                  min={0}
                  max={200}
                  value={filters.saturation}
                  onChange={(e) =>
                    onUpdateFilters({saturation: Number(e.target.value)})
                  }
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="filter-hue" className="text-zinc-300">
                    Hue Rotate
                  </label>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {filters.hueRotate}°
                  </span>
                </div>
                <input
                  id="filter-hue"
                  type="range"
                  min={-180}
                  max={180}
                  value={filters.hueRotate}
                  onChange={(e) =>
                    onUpdateFilters({hueRotate: Number(e.target.value)})
                  }
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="filter-vignette" className="text-zinc-300">
                    Vignette
                  </label>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {filters.vignette}%
                  </span>
                </div>
                <input
                  id="filter-vignette"
                  type="range"
                  min={0}
                  max={100}
                  value={filters.vignette}
                  onChange={(e) =>
                    onUpdateFilters({vignette: Number(e.target.value)})
                  }
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="filter-sharpen" className="text-zinc-300">
                    Sharpen
                  </label>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {filters.sharpen}%
                  </span>
                </div>
                <input
                  id="filter-sharpen"
                  type="range"
                  min={0}
                  max={100}
                  value={filters.sharpen}
                  onChange={(e) =>
                    onUpdateFilters({sharpen: Number(e.target.value)})
                  }
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="filter-blur" className="text-zinc-300">
                    Blur
                  </label>
                  <span className="font-mono tabular-nums text-zinc-400">
                    {filters.blur}px
                  </span>
                </div>
                <input
                  id="filter-blur"
                  type="range"
                  min={0}
                  max={12}
                  step={0.5}
                  value={filters.blur}
                  onChange={(e) =>
                    onUpdateFilters({blur: Number(e.target.value)})
                  }
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'bg-remove' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-zinc-100">
                Background Remover
              </h2>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                AI person cutout or green/color screen keying
              </p>
            </div>

            <div>
              <label
                htmlFor="bg-target-select"
                className="block text-[11px] font-medium text-zinc-400 mb-1"
              >
                Target Layer
              </label>
              <select
                id="bg-target-select"
                value={targetOverlay ? targetOverlay.id : 'main'}
                onChange={(e) => onChangeBgTargetKey(e.target.value)}
                className="w-full rounded-lg border border-zinc-700/80 bg-[#0B0D10] px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
              >
                <option value="main">Main Video Track</option>
                {overlayLayers
                  .filter((l) => l.kind !== 'sticker')
                  .map((layer) => (
                    <option key={layer.id} value={layer.id}>
                      Overlay: {layer.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-medium text-zinc-400">
                Removal Mode
              </span>
              <div className="grid grid-cols-1 gap-1.5">
                {(
                  [
                    {id: 'none', label: 'Off (Original Background)'},
                    {id: 'ai-person', label: 'AI Auto Person Remove'},
                    {
                      id: 'chroma-key',
                      label: 'Chroma Key (Green / Color Screen)',
                    },
                  ] as Array<{id: BackgroundRemovalMode; label: string}>
                ).map((m) => {
                  const active = activeBgConfig.mode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => updateTargetBgRemoval({mode: m.id})}
                      className={`px-3 py-2 rounded-lg border text-left text-[11px] font-medium transition-colors ${
                        active
                          ? 'border-blue-500 bg-blue-500/15 text-blue-100'
                          : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {activeBgConfig.mode === 'ai-person' && (
              <div className="pt-2 border-t border-zinc-800/80 space-y-2.5">
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <label htmlFor="ai-mask-blur" className="text-zinc-300">
                      Edge Feathering
                    </label>
                    <span className="font-mono tabular-nums text-zinc-400">
                      {activeBgConfig.maskBlur.toFixed(1)}px
                    </span>
                  </div>
                  <input
                    id="ai-mask-blur"
                    type="range"
                    min={0}
                    max={4}
                    step={0.5}
                    value={activeBgConfig.maskBlur}
                    onChange={(e) =>
                      updateTargetBgRemoval({maskBlur: Number(e.target.value)})
                    }
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                </div>
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  Powered by MediaPipe Selfie Segmentation running locally in
                  your browser.
                </p>
              </div>
            )}

            {activeBgConfig.mode === 'chroma-key' && (
              <div className="pt-2 border-t border-zinc-800/80 space-y-3">
                <div>
                  <span className="block text-[11px] font-medium text-zinc-400 mb-1.5">
                    Key Color
                  </span>
                  <div className="flex items-center gap-2">
                    {CHROMA_SWATCHES.map((sw) => (
                      <button
                        key={sw.hex}
                        type="button"
                        title={sw.label}
                        onClick={() =>
                          updateTargetBgRemoval({keyColor: sw.hex})
                        }
                        className={`w-6 h-6 rounded border ${
                          activeBgConfig.keyColor.toLowerCase() ===
                          sw.hex.toLowerCase()
                            ? 'border-white scale-110'
                            : 'border-zinc-700'
                        }`}
                        style={{backgroundColor: sw.hex}}
                      />
                    ))}
                    <input
                      type="color"
                      value={activeBgConfig.keyColor}
                      onChange={(e) =>
                        updateTargetBgRemoval({keyColor: e.target.value})
                      }
                      aria-label="Chroma key color picker"
                      className="w-8 h-6 rounded border border-zinc-700 bg-transparent cursor-pointer"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <label htmlFor="chroma-similarity" className="text-zinc-300">
                      Similarity Threshold
                    </label>
                    <span className="font-mono tabular-nums text-zinc-400">
                      {Math.round(activeBgConfig.similarity * 100)}%
                    </span>
                  </div>
                  <input
                    id="chroma-similarity"
                    type="range"
                    min={0.05}
                    max={0.6}
                    step={0.01}
                    value={activeBgConfig.similarity}
                    onChange={(e) =>
                      updateTargetBgRemoval({
                        similarity: Number(e.target.value),
                      })
                    }
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <label htmlFor="chroma-smoothness" className="text-zinc-300">
                      Edge Smoothness
                    </label>
                    <span className="font-mono tabular-nums text-zinc-400">
                      {Math.round(activeBgConfig.smoothness * 100)}%
                    </span>
                  </div>
                  <input
                    id="chroma-smoothness"
                    type="range"
                    min={0.01}
                    max={0.35}
                    step={0.01}
                    value={activeBgConfig.smoothness}
                    onChange={(e) =>
                      updateTargetBgRemoval({
                        smoothness: Number(e.target.value),
                      })
                    }
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                </div>
              </div>
            )}

            {!targetOverlay && activeBgConfig.mode !== 'none' && (
              <div className="pt-3 border-t border-zinc-800/80 space-y-3">
                <span className="block text-[11px] font-medium text-zinc-300">
                  Replace Removed Background
                </span>

                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      {id: 'solid', label: 'Solid Color'},
                      {id: 'blur', label: 'Blurred Video'},
                      {id: 'transparent', label: 'Black / Clear'},
                      {id: 'image', label: 'Custom Media'},
                    ] as Array<{id: BackgroundReplacementType; label: string}>
                  ).map((rep) => {
                    const active =
                      activeBgConfig.replacementType === rep.id ||
                      (rep.id === 'image' &&
                        activeBgConfig.replacementType === 'video');
                    return (
                      <button
                        key={rep.id}
                        type="button"
                        onClick={() =>
                          updateTargetBgRemoval({replacementType: rep.id})
                        }
                        className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
                          active
                            ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                            : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                        }`}
                      >
                        {rep.label}
                      </button>
                    );
                  })}
                </div>

                {activeBgConfig.replacementType === 'solid' && (
                  <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-[#0D1015] px-2.5 py-2">
                    <span className="text-[11px] text-zinc-300">
                      Background Color
                    </span>
                    <input
                      type="color"
                      value={activeBgConfig.replacementColor}
                      onChange={(e) =>
                        updateTargetBgRemoval({
                          replacementColor: e.target.value,
                        })
                      }
                      aria-label="Replacement background color"
                      className="w-7 h-5 rounded border border-zinc-700 bg-transparent cursor-pointer"
                    />
                  </div>
                )}

                {activeBgConfig.replacementType === 'blur' && (
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <label htmlFor="bg-rep-blur" className="text-zinc-300">
                        Background Blur
                      </label>
                      <span className="font-mono tabular-nums text-zinc-400">
                        {activeBgConfig.replacementBlur}px
                      </span>
                    </div>
                    <input
                      id="bg-rep-blur"
                      type="range"
                      min={4}
                      max={28}
                      step={1}
                      value={activeBgConfig.replacementBlur}
                      onChange={(e) =>
                        updateTargetBgRemoval({
                          replacementBlur: Number(e.target.value),
                        })
                      }
                      className="w-full accent-blue-500 cursor-pointer"
                    />
                  </div>
                )}

                {(activeBgConfig.replacementType === 'image' ||
                  activeBgConfig.replacementType === 'video') && (
                  <div className="space-y-2">
                    <input
                      ref={bgFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,.png,.jpg,.jpeg,.webp,.mp4,.webm"
                      onChange={handleBgReplacementFileChange}
                      className="sr-only"
                      aria-label="Upload custom background image or video"
                    />
                    <button
                      type="button"
                      onClick={() => bgFileInputRef.current?.click()}
                      className="w-full py-2 px-3 rounded-lg border border-dashed border-zinc-700 bg-[#0D1015] hover:border-zinc-500 text-[11px] font-medium text-zinc-200 inline-flex items-center justify-center gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Upload BG Image or Video</span>
                    </button>

                    {activeBgConfig.replacementAssetName && (
                      <p className="text-[11px] text-emerald-300 truncate">
                        Active BG: {activeBgConfig.replacementAssetName}
                      </p>
                    )}

                    {mediaAssets.length > 0 && (
                      <div className="max-h-24 overflow-y-auto space-y-1">
                        {mediaAssets.map((asset) => (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() =>
                              updateTargetBgRemoval({
                                replacementType: asset.kind,
                                replacementAssetId: asset.id,
                                replacementAssetUrl: asset.url,
                                replacementAssetKind: asset.kind,
                                replacementAssetName: asset.name,
                              })
                            }
                            className={`w-full px-2 py-1 rounded border text-left text-[11px] truncate transition-colors ${
                              activeBgConfig.replacementAssetId === asset.id
                                ? 'border-blue-500 bg-blue-500/10 text-blue-200'
                                : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                            }`}
                          >
                            {asset.kind === 'image' ? 'Image' : 'Video'}:{' '}
                            {asset.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'stickers' && (
          <div className="space-y-4">
            {/* Face Glow / Beauty Smooth */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-semibold text-zinc-100">
                    Face Glow / Beauty Smooth
                  </h2>
                  <p className="text-[10px] text-zinc-400">
                    Softens &amp; brightens skin tones naturally
                  </p>
                </div>
                {filters.faceGlow > 0 && (
                  <button
                    type="button"
                    onClick={() => onUpdateFilters({faceGlow: 0})}
                    className="text-[10px] text-zinc-400 hover:text-zinc-100"
                  >
                    Reset
                  </button>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="face-glow-slider" className="text-zinc-300">
                    Beauty Intensity
                  </label>
                  <span className="font-mono tabular-nums text-pink-300">
                    {filters.faceGlow}%
                  </span>
                </div>
                <input
                  id="face-glow-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={filters.faceGlow}
                  onChange={(e) =>
                    onUpdateFilters({faceGlow: Number(e.target.value)})
                  }
                  className="w-full accent-pink-500 cursor-pointer"
                />
              </div>
            </div>

            {/* Official JIT Logo Watermark */}
            <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-white p-0.5 border border-zinc-700 shrink-0 flex items-center justify-center">
                  <img
                    src={JIT_LOGO_URL}
                    alt="JIT Logo"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-zinc-100">
                    JIT Brand Watermark
                  </h3>
                  <p className="text-[10px] text-zinc-400 truncate">
                    Place on any corner or drag freely
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1">
                {(
                  Object.keys(WATERMARK_CORNER_POSITIONS) as WatermarkCorner[]
                ).map((corner) => (
                  <button
                    key={corner}
                    type="button"
                    onClick={() => setWatermarkCorner(corner)}
                    className={`py-1 px-2 rounded border text-[10px] font-medium transition-colors ${
                      watermarkCorner === corner
                        ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                        : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                    }`}
                  >
                    {WATERMARK_CORNER_POSITIONS[corner].label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => onAddJitLogoWatermark(watermarkCorner)}
                className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-[11px] font-semibold text-white inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Add JIT Logo Watermark</span>
              </button>
            </div>

            {/* Stickers & Masks */}
            <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
              <div>
                <h3 className="text-xs font-semibold text-zinc-100">
                  Fun Stickers &amp; Masks
                </h3>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  Click to add, then drag/resize onto faces on canvas
                </p>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {STICKER_CATALOG.map((sticker) => (
                  <button
                    key={sticker.kind}
                    type="button"
                    onClick={() => onAddStickerOverlay(sticker.kind)}
                    className="rounded-lg border border-zinc-800 bg-[#0D1015] hover:border-sky-500/60 hover:bg-sky-500/5 p-2 flex flex-col items-center gap-1 transition-colors"
                  >
                    <img
                      src={sticker.dataUrl}
                      alt={sticker.label}
                      className="w-9 h-9 object-contain pointer-events-none"
                    />
                    <span className="text-[10px] text-zinc-300 truncate max-w-full">
                      {sticker.label}
                    </span>
                  </button>
                ))}
              </div>

              {overlayLayers.some(
                (l) => l.kind === 'sticker' || l.assetId === 'jit-watermark'
              ) && (
                <div className="space-y-1 pt-2 border-t border-zinc-800/70 max-h-32 overflow-y-auto">
                  <span className="block text-[10px] font-medium text-zinc-400">
                    Placed Stickers &amp; Watermarks
                  </span>
                  {overlayLayers
                    .filter(
                      (l) => l.kind === 'sticker' || l.assetId === 'jit-watermark'
                    )
                    .map((st) => (
                      <div
                        key={st.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-[#0D1015] px-2 py-1 text-[11px]"
                      >
                        <button
                          type="button"
                          onClick={() => onSelectOverlay(st.id)}
                          className="flex-1 text-left text-zinc-200 truncate"
                        >
                          {st.name}
                        </button>
                        <span className="text-[10px] font-mono tabular-nums text-zinc-500 shrink-0">
                          {formatTime(st.startTime)}–{formatTime(st.endTime)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onDeleteOverlay(st.id)}
                          aria-label={`Remove ${st.name}`}
                          className="p-0.5 rounded text-zinc-500 hover:text-red-400"
                        >
                          <Trash2 className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                </div>
              )}

              {selectedOverlay && (
                <div className="pt-3 border-t border-zinc-800/80 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-sky-300 truncate">
                      Selected: {selectedOverlay.name}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                      {Math.round(selectedOverlay.opacity * 100)}%
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <span className="block text-[10px] font-medium text-zinc-400">
                      Entrance / Motion Animation
                    </span>
                    <div className="grid grid-cols-3 gap-1">
                      {OVERLAY_ANIMATION_OPTIONS.map((anim) => {
                        const active =
                          (selectedOverlay.animation ?? 'none') === anim.id;
                        return (
                          <button
                            key={anim.id}
                            type="button"
                            onClick={() =>
                              onUpdateOverlay(selectedOverlay.id, {
                                animation: anim.id as OverlayAnimationPreset,
                              })
                            }
                            className={`py-1 px-1.5 rounded border text-[10px] font-medium transition-colors truncate ${
                              active
                                ? 'border-sky-400 bg-sky-500/20 text-sky-100'
                                : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                            }`}
                          >
                            {anim.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="block text-[10px] font-medium text-zinc-400">
                      Face &amp; Frame Anchor Presets
                    </span>
                    <div className="grid grid-cols-2 gap-1">
                      {FACE_ANCHOR_POSITIONS.map((pos) => {
                        const active = selectedOverlay.anchorPreset === pos.id;
                        return (
                          <button
                            key={pos.id}
                            type="button"
                            onClick={() =>
                              onUpdateOverlay(selectedOverlay.id, {
                                anchorPreset: pos.id as FaceAnchorPreset,
                                x: pos.x,
                                y: pos.y,
                              })
                            }
                            className={`py-1 px-2 rounded border text-[10px] font-medium transition-colors truncate ${
                              active
                                ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
                                : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                            }`}
                          >
                            {pos.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-zinc-400">
                      Fine Nudge
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateOverlay(selectedOverlay.id, {
                            x: Math.max(0.04, selectedOverlay.x - 0.02),
                          })
                        }
                        aria-label="Nudge overlay left"
                        className="px-2 py-0.5 rounded border border-zinc-800 bg-[#0D1015] hover:border-zinc-600 text-[11px] text-zinc-200"
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateOverlay(selectedOverlay.id, {
                            y: Math.max(0.04, selectedOverlay.y - 0.02),
                          })
                        }
                        aria-label="Nudge overlay up"
                        className="px-2 py-0.5 rounded border border-zinc-800 bg-[#0D1015] hover:border-zinc-600 text-[11px] text-zinc-200"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateOverlay(selectedOverlay.id, {
                            y: Math.min(0.96, selectedOverlay.y + 0.02),
                          })
                        }
                        aria-label="Nudge overlay down"
                        className="px-2 py-0.5 rounded border border-zinc-800 bg-[#0D1015] hover:border-zinc-600 text-[11px] text-zinc-200"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateOverlay(selectedOverlay.id, {
                            x: Math.min(0.96, selectedOverlay.x + 0.02),
                          })
                        }
                        aria-label="Nudge overlay right"
                        className="px-2 py-0.5 rounded border border-zinc-800 bg-[#0D1015] hover:border-zinc-600 text-[11px] text-zinc-200"
                      >
                        →
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-[#0D1015] px-2.5 py-1.5 cursor-pointer">
                    <span className="text-[11px] text-zinc-200">
                      Motion Sway Sync
                    </span>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedOverlay.followMotion)}
                      onChange={(e) =>
                        onUpdateOverlay(selectedOverlay.id, {
                          followMotion: e.target.checked,
                        })
                      }
                      className="w-3.5 h-3.5 accent-sky-500 cursor-pointer"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'text' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold text-zinc-100">
                  Text Overlays
                </h2>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  Drag text directly on canvas
                </p>
              </div>
              <button
                type="button"
                onClick={onAddTextOverlay}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-[11px] font-medium text-white transition-colors shrink-0"
              >
                <Plus className="w-3 h-3" aria-hidden="true" />
                <span>Add Text</span>
              </button>
            </div>

            {textOverlays.length > 0 && (
              <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                {textOverlays.map((item) => {
                  const isSelected = item.id === selectedTextId;
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                        isSelected
                          ? 'border-blue-500 bg-blue-500/10 text-zinc-100'
                          : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectTextOverlay(item.id)}
                        className="flex-1 text-left truncate text-[11px]"
                      >
                        {item.text || 'Untitled text'}
                      </button>
                      <span className="text-[10px] font-mono tabular-nums text-zinc-400 shrink-0">
                        {formatTime(item.startTime)}–{formatTime(item.endTime)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDeleteTextOverlay(item.id)}
                        aria-label="Delete text overlay"
                        className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800"
                      >
                        <Trash2 className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {selectedText ? (
              <div className="space-y-3 pt-3 border-t border-zinc-800/80">
                <div>
                  <label
                    htmlFor="text-overlay-content"
                    className="block text-[11px] font-medium text-zinc-400 mb-1"
                  >
                    Content
                  </label>
                  <textarea
                    id="text-overlay-content"
                    rows={2}
                    value={selectedText.text}
                    onChange={(e) =>
                      onUpdateTextOverlay(selectedText.id, {
                        text: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-700/80 bg-[#0B0D10] px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label
                      htmlFor="text-overlay-font"
                      className="block text-[11px] font-medium text-zinc-400 mb-1"
                    >
                      Font
                    </label>
                    <select
                      id="text-overlay-font"
                      value={selectedText.fontFamily}
                      onChange={(e) =>
                        onUpdateTextOverlay(selectedText.id, {
                          fontFamily: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-zinc-700/80 bg-[#0B0D10] px-2 py-1.5 text-[11px] text-zinc-100 focus:outline-none focus:border-blue-500"
                    >
                      {FONT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label
                        htmlFor="text-overlay-size"
                        className="text-[11px] font-medium text-zinc-400"
                      >
                        Size
                      </label>
                      <span className="text-[11px] font-mono tabular-nums text-zinc-300">
                        {selectedText.fontSize}px
                      </span>
                    </div>
                    <input
                      id="text-overlay-size"
                      type="range"
                      min={18}
                      max={84}
                      value={selectedText.fontSize}
                      onChange={(e) =>
                        onUpdateTextOverlay(selectedText.id, {
                          fontSize: Number(e.target.value),
                        })
                      }
                      className="w-full accent-blue-500 cursor-pointer"
                    />
                  </div>
                </div>

                <div>
                  <span className="block text-[11px] font-medium text-zinc-400 mb-1.5">
                    Color
                  </span>
                  <div className="flex items-center gap-1.5">
                    {TEXT_COLOR_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() =>
                          onUpdateTextOverlay(selectedText.id, {color: hex})
                        }
                        aria-label={`Set text color ${hex}`}
                        className={`w-5 h-5 rounded border ${
                          selectedText.color.toLowerCase() === hex.toLowerCase()
                            ? 'border-blue-500 scale-110'
                            : 'border-zinc-700'
                        }`}
                        style={{backgroundColor: hex}}
                      />
                    ))}
                    <input
                      type="color"
                      value={selectedText.color}
                      onChange={(e) =>
                        onUpdateTextOverlay(selectedText.id, {
                          color: e.target.value,
                        })
                      }
                      aria-label="Custom text color"
                      className="w-6 h-5 rounded border border-zinc-700 bg-transparent cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-[#0D1015] px-2.5 py-2">
                  <label
                    htmlFor="text-bg-toggle"
                    className="text-[11px] text-zinc-200 cursor-pointer"
                  >
                    Background Box
                  </label>
                  <div className="flex items-center gap-2">
                    {selectedText.hasBackground && (
                      <input
                        type="color"
                        value={
                          selectedText.backgroundColor.startsWith('#')
                            ? selectedText.backgroundColor.slice(0, 7)
                            : '#000000'
                        }
                        onChange={(e) =>
                          onUpdateTextOverlay(selectedText.id, {
                            backgroundColor: e.target.value,
                          })
                        }
                        aria-label="Background box color"
                        className="w-6 h-5 rounded border border-zinc-700 bg-transparent cursor-pointer"
                      />
                    )}
                    <input
                      id="text-bg-toggle"
                      type="checkbox"
                      checked={selectedText.hasBackground}
                      onChange={(e) =>
                        onUpdateTextOverlay(selectedText.id, {
                          hasBackground: e.target.checked,
                        })
                      }
                      className="w-3.5 h-3.5 accent-blue-500 rounded cursor-pointer"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label
                      htmlFor="text-start-time"
                      className="block text-[11px] font-medium text-zinc-400 mb-1"
                    >
                      Start (sec)
                    </label>
                    <input
                      id="text-start-time"
                      type="number"
                      min={0}
                      max={Math.max(0, selectedText.endTime - 0.2)}
                      step={0.1}
                      value={Number(selectedText.startTime.toFixed(2))}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        if (!Number.isFinite(raw)) return;
                        const val = Math.max(0, raw);
                        onUpdateTextOverlay(selectedText.id, {
                          startTime: Math.min(val, selectedText.endTime - 0.2),
                        });
                      }}
                      className="w-full rounded-lg border border-zinc-700/80 bg-[#0B0D10] px-2 py-1 text-xs font-mono tabular-nums text-zinc-100"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="text-end-time"
                      className="block text-[11px] font-medium text-zinc-400 mb-1"
                    >
                      End (sec)
                    </label>
                    <input
                      id="text-end-time"
                      type="number"
                      min={selectedText.startTime + 0.2}
                      step={0.1}
                      value={Number(selectedText.endTime.toFixed(2))}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (!Number.isFinite(val)) return;
                        onUpdateTextOverlay(selectedText.id, {
                          endTime: Math.max(selectedText.startTime + 0.2, val),
                        });
                      }}
                      className="w-full rounded-lg border border-zinc-700/80 bg-[#0B0D10] px-2 py-1 text-xs font-mono tabular-nums text-zinc-100"
                    />
                  </div>
                </div>

                {/* Text Animation & Anchor Presets */}
                <div className="pt-2.5 border-t border-zinc-800/80 space-y-2.5">
                  <div className="space-y-1.5">
                    <span className="block text-[10px] font-medium text-zinc-400">
                      Text Animation Preset
                    </span>
                    <div className="grid grid-cols-3 gap-1">
                      {OVERLAY_ANIMATION_OPTIONS.map((anim) => {
                        const active =
                          (selectedText.animation ?? 'none') === anim.id;
                        return (
                          <button
                            key={anim.id}
                            type="button"
                            onClick={() =>
                              onUpdateTextOverlay(selectedText.id, {
                                animation: anim.id as OverlayAnimationPreset,
                              })
                            }
                            className={`py-1 px-1.5 rounded border text-[10px] font-medium transition-colors truncate ${
                              active
                                ? 'border-blue-400 bg-blue-500/20 text-blue-100'
                                : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                            }`}
                          >
                            {anim.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="block text-[10px] font-medium text-zinc-400">
                      Position / Face Anchor
                    </span>
                    <div className="grid grid-cols-2 gap-1">
                      {FACE_ANCHOR_POSITIONS.map((pos) => {
                        const active = selectedText.anchorPreset === pos.id;
                        return (
                          <button
                            key={pos.id}
                            type="button"
                            onClick={() =>
                              onUpdateTextOverlay(selectedText.id, {
                                anchorPreset: pos.id as FaceAnchorPreset,
                                x: pos.x,
                                y: pos.y,
                              })
                            }
                            className={`py-1 px-2 rounded border text-[10px] font-medium transition-colors truncate ${
                              active
                                ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
                                : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                            }`}
                          >
                            {pos.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-zinc-400">
                      Fine Nudge
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateTextOverlay(selectedText.id, {
                            x: Math.max(0.04, selectedText.x - 0.02),
                          })
                        }
                        aria-label="Nudge text left"
                        className="px-2 py-0.5 rounded border border-zinc-800 bg-[#0D1015] hover:border-zinc-600 text-[11px] text-zinc-200"
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateTextOverlay(selectedText.id, {
                            y: Math.max(0.04, selectedText.y - 0.02),
                          })
                        }
                        aria-label="Nudge text up"
                        className="px-2 py-0.5 rounded border border-zinc-800 bg-[#0D1015] hover:border-zinc-600 text-[11px] text-zinc-200"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateTextOverlay(selectedText.id, {
                            y: Math.min(0.96, selectedText.y + 0.02),
                          })
                        }
                        aria-label="Nudge text down"
                        className="px-2 py-0.5 rounded border border-zinc-800 bg-[#0D1015] hover:border-zinc-600 text-[11px] text-zinc-200"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateTextOverlay(selectedText.id, {
                            x: Math.min(0.96, selectedText.x + 0.02),
                          })
                        }
                        aria-label="Nudge text right"
                        className="px-2 py-0.5 rounded border border-zinc-800 bg-[#0D1015] hover:border-zinc-600 text-[11px] text-zinc-200"
                      >
                        →
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-[#0D1015] px-2.5 py-1.5 cursor-pointer">
                    <span className="text-[11px] text-zinc-200">
                      Motion Sway Sync
                    </span>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedText.followMotion)}
                      onChange={(e) =>
                        onUpdateTextOverlay(selectedText.id, {
                          followMotion: e.target.checked,
                        })
                      }
                      className="w-3.5 h-3.5 accent-blue-500 cursor-pointer"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-800 bg-[#0D1015] p-3.5 text-center">
                <p className="text-[11px] text-zinc-400">
                  Add a text overlay or select one from the Text Track.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'audio' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-zinc-100">
                  Playback Speed
                </h2>
                <span className="text-xs font-mono tabular-nums text-blue-400">
                  {audioSettings.playbackSpeed.toFixed(2).replace(/\.00$/, '')}x
                </span>
              </div>

              <div className="grid grid-cols-6 gap-1">
                {SPEED_OPTIONS.map((spd) => {
                  const active =
                    Math.abs(audioSettings.playbackSpeed - spd) < 0.01;
                  return (
                    <button
                      key={spd}
                      type="button"
                      onClick={() =>
                        onUpdateAudioSettings({playbackSpeed: spd})
                      }
                      className={`py-1 rounded text-[10px] font-mono tabular-nums border transition-colors ${
                        active
                          ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                          : 'border-zinc-800 bg-[#0D1015] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {spd}x
                    </button>
                  );
                })}
              </div>

              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={audioSettings.playbackSpeed}
                onChange={(e) =>
                  onUpdateAudioSettings({playbackSpeed: Number(e.target.value)})
                }
                aria-label="Playback speed multiplier"
                className="w-full accent-blue-500 cursor-pointer"
              />
            </div>

            <div className="pt-3 border-t border-zinc-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
                  <Film className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
                  <span>Video Audio</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateAudioSettings({
                      videoMuted: !audioSettings.videoMuted,
                    })
                  }
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border ${
                    audioSettings.videoMuted
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      : 'border-zinc-800 bg-[#0D1015] text-zinc-300'
                  }`}
                >
                  {audioSettings.videoMuted ? (
                    <>
                      <VolumeX className="w-3 h-3" aria-hidden="true" />
                      <span>Muted</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3 h-3" aria-hidden="true" />
                      <span className="font-mono tabular-nums">
                        {Math.round(audioSettings.videoVolume * 100)}%
                      </span>
                    </>
                  )}
                </button>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                disabled={audioSettings.videoMuted}
                value={audioSettings.videoVolume}
                onChange={(e) =>
                  onUpdateAudioSettings({videoVolume: Number(e.target.value)})
                }
                aria-label="Video track volume"
                className="w-full accent-blue-500 cursor-pointer disabled:opacity-40"
              />
            </div>

            <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
                  <Music className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  <span>Background Music</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateAudioSettings({
                      musicMuted: !audioSettings.musicMuted,
                    })
                  }
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border ${
                    audioSettings.musicMuted
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      : 'border-zinc-800 bg-[#0D1015] text-zinc-300'
                  }`}
                >
                  {audioSettings.musicMuted ? (
                    <>
                      <VolumeX className="w-3 h-3" aria-hidden="true" />
                      <span>Muted</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3 h-3" aria-hidden="true" />
                      <span className="font-mono tabular-nums">
                        {Math.round(audioSettings.musicVolume * 100)}%
                      </span>
                    </>
                  )}
                </button>
              </div>

              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                disabled={audioSettings.musicMuted}
                value={audioSettings.musicVolume}
                onChange={(e) =>
                  onUpdateAudioSettings({musicVolume: Number(e.target.value)})
                }
                aria-label="Background music volume"
                className="w-full accent-emerald-500 cursor-pointer disabled:opacity-40"
              />

              <input
                ref={audioInputRef}
                type="file"
                accept="audio/mpeg,audio/wav,audio/mp3,.mp3,.wav"
                multiple
                onChange={handleAudioFileChange}
                className="sr-only"
                aria-label="Upload MP3 or WAV audio files"
              />

              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                className="w-full py-2 px-3 rounded-lg border border-dashed border-zinc-700/80 bg-[#0D1015] hover:border-zinc-500 text-[11px] font-medium text-zinc-200 flex items-center justify-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Upload MP3 / WAV</span>
              </button>

              {audioAssets.length > 0 && (
                <div className="space-y-1.5">
                  {audioAssets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => onAddAudioToTimeline(asset)}
                      className="w-full rounded-lg border border-zinc-800 bg-[#0D1015] hover:border-emerald-500/60 px-2.5 py-1.5 flex items-center justify-between gap-2 text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-zinc-200 truncate">
                          {asset.name}
                        </p>
                        <p className="text-[10px] font-mono tabular-nums text-zinc-500">
                          {formatTime(asset.duration)} · {formatFileSize(asset.size)}
                        </p>
                      </div>
                      <Plus
                        className="w-3.5 h-3.5 text-emerald-400 shrink-0"
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedAudioClip && (
              <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-emerald-300 font-medium truncate max-w-[160px]">
                    Clip: {selectedAudioClip.name}
                  </span>
                  <span className="font-mono tabular-nums text-zinc-300">
                    {Math.round((selectedAudioClip.volume ?? 1) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={selectedAudioClip.volume ?? 1}
                  onChange={(e) =>
                    onUpdateAudioClip(selectedAudioClip.id, {
                      volume: Number(e.target.value),
                    })
                  }
                  aria-label="Selected audio clip volume"
                  className="w-full accent-emerald-500 cursor-pointer"
                />

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex items-center justify-between text-[10px] mb-0.5">
                      <label htmlFor="audio-fade-in" className="text-zinc-300">
                        Fade In
                      </label>
                      <span className="font-mono tabular-nums text-zinc-400">
                        {(selectedAudioClip.fadeIn ?? 0).toFixed(1)}s
                      </span>
                    </div>
                    <input
                      id="audio-fade-in"
                      type="range"
                      min={0}
                      max={5}
                      step={0.1}
                      value={selectedAudioClip.fadeIn ?? 0}
                      onChange={(e) =>
                        onUpdateAudioClip(selectedAudioClip.id, {
                          fadeIn: Number(e.target.value),
                        })
                      }
                      className="w-full accent-emerald-500 cursor-pointer"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[10px] mb-0.5">
                      <label htmlFor="audio-fade-out" className="text-zinc-300">
                        Fade Out
                      </label>
                      <span className="font-mono tabular-nums text-zinc-400">
                        {(selectedAudioClip.fadeOut ?? 0).toFixed(1)}s
                      </span>
                    </div>
                    <input
                      id="audio-fade-out"
                      type="range"
                      min={0}
                      max={5}
                      step={0.1}
                      value={selectedAudioClip.fadeOut ?? 0}
                      onChange={(e) =>
                        onUpdateAudioClip(selectedAudioClip.id, {
                          fadeOut: Number(e.target.value),
                        })
                      }
                      className="w-full accent-emerald-500 cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Built-in Sound Effects (SFX) Library */}
            <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
              <div>
                <h3 className="text-xs font-semibold text-zinc-100">
                  Sound Effects (SFX)
                </h3>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  Preview or insert at playhead on Audio track
                </p>
              </div>

              <div className="space-y-1.5">
                {BUILT_IN_SFX_LIST.map((sfx) => (
                  <div
                    key={sfx.kind}
                    className="rounded-lg border border-zinc-800 bg-[#0D1015] px-2.5 py-1.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-zinc-200 truncate">
                        {sfx.name}
                      </p>
                      <p className="text-[10px] text-zinc-500 truncate">
                        {sfx.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewingSfx(sfx.kind);
                          void playSfxPreview(sfx.kind).finally(() => {
                            window.setTimeout(() => {
                              setPreviewingSfx((curr) =>
                                curr === sfx.kind ? null : curr
                              );
                            }, Math.round(sfx.duration * 1000));
                          });
                        }}
                        title={`Preview ${sfx.name}`}
                        aria-label={`Preview ${sfx.name}`}
                        className={`p-1.5 rounded border transition-colors ${
                          previewingSfx === sfx.kind
                            ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                            : 'border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300'
                        }`}
                      >
                        <Play className="w-3 h-3 fill-current" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onAddBuiltInSfx(sfx.kind)}
                        className="px-2 py-1 rounded bg-emerald-600/90 hover:bg-emerald-500 text-[10px] font-medium text-white inline-flex items-center gap-0.5"
                      >
                        <Plus className="w-3 h-3" aria-hidden="true" />
                        <span>Add</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pro Studio Audio Effects (Web Audio API) */}
            <div className="pt-3 border-t border-zinc-800/80 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-zinc-100">
                  Studio Audio FX
                </h3>
                <select
                  aria-label="Audio effects target"
                  value={audioSettings.effects.target}
                  onChange={(e) =>
                    updateAudioEffects({
                      target: e.target.value as AudioEffectsConfig['target'],
                    })
                  }
                  className="rounded border border-zinc-700 bg-[#0B0D10] px-1.5 py-0.5 text-[10px] text-zinc-200"
                >
                  <option value="both">All Audio</option>
                  <option value="video">Video Only</option>
                  <option value="music">Audio Track</option>
                </select>
              </div>

              {/* Voice Changer & Pitch Shift */}
              <div className="rounded-lg border border-zinc-800 bg-[#0D1015] p-2.5 space-y-2">
                <span className="block text-[11px] font-medium text-zinc-200">
                  Voice Changer &amp; Pitch
                </span>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      {id: 'normal', label: 'Normal'},
                      {id: 'deep', label: 'Deep / Bass'},
                      {id: 'chipmunk', label: 'Chipmunk'},
                      {id: 'robot', label: 'Robot'},
                      {id: 'radio', label: 'Radio'},
                    ] as Array<{id: VoiceChangerPreset; label: string}>
                  ).map((preset) => {
                    const active = audioSettings.effects.voicePreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          const defaultPitch =
                            preset.id === 'deep'
                              ? -5
                              : preset.id === 'chipmunk'
                                ? 7
                                : preset.id === 'normal'
                                  ? 0
                                  : audioSettings.effects.pitchSemitones;
                          updateAudioEffects({
                            voicePreset: preset.id,
                            pitchSemitones: defaultPitch,
                          });
                        }}
                        className={`py-1 px-1.5 rounded border text-[10px] font-medium transition-colors truncate ${
                          active
                            ? 'border-blue-500 bg-blue-500/20 text-blue-100'
                            : 'border-zinc-800 bg-[#0B0D10] text-zinc-300 hover:border-zinc-700'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                <div>
                  <div className="flex items-center justify-between text-[10px] mb-0.5">
                    <label htmlFor="audio-pitch-slider" className="text-zinc-300">
                      Pitch Shift (Semitones)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono tabular-nums text-blue-300">
                        {audioSettings.effects.pitchSemitones > 0
                          ? `+${audioSettings.effects.pitchSemitones}`
                          : audioSettings.effects.pitchSemitones}{' '}
                        st
                      </span>
                      {audioSettings.effects.pitchSemitones !== 0 && (
                        <button
                          type="button"
                          onClick={() => updateAudioEffects({pitchSemitones: 0})}
                          className="text-[9px] text-zinc-400 hover:text-zinc-100 underline"
                        >
                          0
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    id="audio-pitch-slider"
                    type="range"
                    min={-12}
                    max={12}
                    step={1}
                    value={audioSettings.effects.pitchSemitones}
                    onChange={(e) =>
                      updateAudioEffects({
                        pitchSemitones: Number(e.target.value),
                      })
                    }
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Noise Reduction */}
              <div className="rounded-lg border border-zinc-800 bg-[#0D1015] p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="toggle-noise-reduction"
                    className="text-[11px] font-medium text-zinc-200 cursor-pointer"
                  >
                    Noise Reduction
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono tabular-nums text-zinc-400">
                      {audioSettings.effects.noiseReductionAmount}%
                    </span>
                    <input
                      id="toggle-noise-reduction"
                      type="checkbox"
                      checked={audioSettings.effects.noiseReductionEnabled}
                      onChange={(e) =>
                        updateAudioEffects({
                          noiseReductionEnabled: e.target.checked,
                        })
                      }
                      className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
                    />
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  disabled={!audioSettings.effects.noiseReductionEnabled}
                  value={audioSettings.effects.noiseReductionAmount}
                  onChange={(e) =>
                    updateAudioEffects({
                      noiseReductionAmount: Number(e.target.value),
                    })
                  }
                  aria-label="Noise reduction intensity"
                  className="w-full accent-emerald-500 cursor-pointer disabled:opacity-40"
                />
              </div>

              {/* Voice Enhancement */}
              <div className="rounded-lg border border-zinc-800 bg-[#0D1015] p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="toggle-voice-enhance"
                    className="text-[11px] font-medium text-zinc-200 cursor-pointer"
                  >
                    Voice Enhancement
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono tabular-nums text-zinc-400">
                      {audioSettings.effects.voiceEnhanceAmount}%
                    </span>
                    <input
                      id="toggle-voice-enhance"
                      type="checkbox"
                      checked={audioSettings.effects.voiceEnhanceEnabled}
                      onChange={(e) =>
                        updateAudioEffects({
                          voiceEnhanceEnabled: e.target.checked,
                        })
                      }
                      className="w-3.5 h-3.5 accent-sky-500 cursor-pointer"
                    />
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  disabled={!audioSettings.effects.voiceEnhanceEnabled}
                  value={audioSettings.effects.voiceEnhanceAmount}
                  onChange={(e) =>
                    updateAudioEffects({
                      voiceEnhanceAmount: Number(e.target.value),
                    })
                  }
                  aria-label="Voice enhancement intensity"
                  className="w-full accent-sky-500 cursor-pointer disabled:opacity-40"
                />
              </div>

              {/* Auto Volume Control */}
              <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-[#0D1015] px-2.5 py-2 cursor-pointer">
                <span className="text-[11px] font-medium text-zinc-200">
                  Auto Volume Control (Normalizer)
                </span>
                <input
                  type="checkbox"
                  checked={audioSettings.effects.autoVolumeEnabled}
                  onChange={(e) =>
                    updateAudioEffects({autoVolumeEnabled: e.target.checked})
                  }
                  className="w-3.5 h-3.5 accent-blue-500 cursor-pointer"
                />
              </label>

              {/* Echo (Delay) */}
              <div className="rounded-lg border border-zinc-800 bg-[#0D1015] p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="toggle-echo"
                    className="text-[11px] font-medium text-zinc-200 cursor-pointer"
                  >
                    Echo (Delay)
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono tabular-nums text-zinc-400">
                      {audioSettings.effects.echoAmount}%
                    </span>
                    <input
                      id="toggle-echo"
                      type="checkbox"
                      checked={audioSettings.effects.echoEnabled}
                      onChange={(e) =>
                        updateAudioEffects({echoEnabled: e.target.checked})
                      }
                      className="w-3.5 h-3.5 accent-blue-500 cursor-pointer"
                    />
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  disabled={!audioSettings.effects.echoEnabled}
                  value={audioSettings.effects.echoAmount}
                  onChange={(e) =>
                    updateAudioEffects({echoAmount: Number(e.target.value)})
                  }
                  aria-label="Echo intensity"
                  className="w-full accent-blue-500 cursor-pointer disabled:opacity-40"
                />
              </div>

              {/* Reverb (Room) */}
              <div className="rounded-lg border border-zinc-800 bg-[#0D1015] p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="toggle-reverb"
                    className="text-[11px] font-medium text-zinc-200 cursor-pointer"
                  >
                    Reverb (Room)
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono tabular-nums text-zinc-400">
                      {audioSettings.effects.reverbAmount}%
                    </span>
                    <input
                      id="toggle-reverb"
                      type="checkbox"
                      checked={audioSettings.effects.reverbEnabled}
                      onChange={(e) =>
                        updateAudioEffects({reverbEnabled: e.target.checked})
                      }
                      className="w-3.5 h-3.5 accent-blue-500 cursor-pointer"
                    />
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  disabled={!audioSettings.effects.reverbEnabled}
                  value={audioSettings.effects.reverbAmount}
                  onChange={(e) =>
                    updateAudioEffects({reverbAmount: Number(e.target.value)})
                  }
                  aria-label="Reverb intensity"
                  className="w-full accent-blue-500 cursor-pointer disabled:opacity-40"
                />
              </div>
            </div>

            {/* Audio Beat Sync */}
            <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-zinc-100">
                    Audio Beat Sync
                  </h3>
                  <p className="text-[10px] text-zinc-400">
                    Detect beat markers &amp; sync Disco strobe lights
                  </p>
                </div>
                {beatSync && (
                  <button
                    type="button"
                    onClick={onClearBeats}
                    className="text-[10px] text-zinc-400 hover:text-zinc-100"
                  >
                    Clear
                  </button>
                )}
              </div>

              {audioClips.length > 0 ? (
                (() => {
                  const beatClip = selectedAudioClip ?? audioClips[0];
                  return (
                    <div className="space-y-2">
                      <button
                        type="button"
                        disabled={beatAnalyzing}
                        onClick={() => onAnalyzeBeats(beatClip.id)}
                        className="w-full py-1.5 px-3 rounded-lg bg-amber-500/90 hover:bg-amber-400 disabled:opacity-50 text-[11px] font-semibold text-zinc-950 transition-colors"
                      >
                        {beatAnalyzing
                          ? 'Analyzing Beats...'
                          : `Analyze Beats (${beatClip.name})`}
                      </button>

                      {beatError && (
                        <p className="text-[10px] text-red-400">{beatError}</p>
                      )}

                      {beatSync && (
                        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 space-y-2">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-mono font-semibold text-amber-200">
                              {beatSync.bpm} BPM
                            </span>
                            <span className="font-mono text-zinc-300">
                              {beatSync.beatTimes.length} beats detected
                            </span>
                          </div>
                          {beatSync.beatTimes.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                const nextBeat =
                                  beatSync.beatTimes.find(
                                    (t) => t > currentTime + 0.05
                                  ) ?? beatSync.beatTimes[0];
                                onSeek(nextBeat);
                              }}
                              className="w-full py-1 rounded border border-amber-500/40 bg-[#0D1015] hover:bg-amber-500/15 text-[10px] font-medium text-amber-200 transition-colors"
                            >
                              Jump to Next Beat
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                <p className="text-[10px] text-zinc-500 rounded-lg border border-dashed border-zinc-800 bg-[#0D1015] p-2">
                  Upload or add an audio track above to detect beat markers.
                </p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-zinc-100">
                AI Studio
              </h2>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                Auto-generate viral titles, descriptions, hashtags &amp; captions.
              </p>
            </div>

            <div className="space-y-2.5">
              <div>
                <label
                  htmlFor="ai-topic-input"
                  className="block text-[11px] font-medium text-zinc-400 mb-1"
                >
                  Topic / Context (optional)
                </label>
                <textarea
                  id="ai-topic-input"
                  rows={2}
                  value={aiTopic}
                  onChange={(e) => setAiTopic(e.target.value)}
                  placeholder="e.g., Travel vlog, product demo..."
                  className="w-full rounded-lg border border-zinc-700/80 bg-[#0B0D10] px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label
                  htmlFor="ai-tone-select"
                  className="block text-[11px] font-medium text-zinc-400 mb-1"
                >
                  Tone
                </label>
                <select
                  id="ai-tone-select"
                  value={aiTone}
                  onChange={(e) => setAiTone(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700/80 bg-[#0B0D10] px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                >
                  <option value="Engaging">Engaging &amp; Viral</option>
                  <option value="Educational">Clear &amp; Educational</option>
                  <option value="Cinematic">Minimal &amp; Cinematic</option>
                  <option value="Fast-Paced">High-Energy Shorts</option>
                </select>
              </div>

              <button
                type="button"
                disabled={aiLoading}
                onClick={handleGenerateAI}
                className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {aiLoading ? 'Generating...' : 'Generate Packaging & Captions'}
                </span>
              </button>
            </div>

            {aiError && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-[11px] text-red-300"
              >
                {aiError}
              </div>
            )}

            {aiResult && (
              <div className="space-y-3.5 pt-3 border-t border-zinc-800/80">
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-zinc-400">
                    Viral Titles
                  </span>
                  {aiResult.titles.map((title, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-zinc-800 bg-[#0D1015] px-2.5 py-1.5 flex items-start justify-between gap-2"
                    >
                      <p className="text-[11px] text-zinc-100 leading-snug">
                        {title}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleCopy(`title-${idx}`, title)}
                        aria-label="Copy title"
                        className="p-1 rounded text-zinc-400 hover:text-zinc-100 shrink-0"
                      >
                        {copiedKey === `title-${idx}` ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-zinc-400">
                      Description
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy('desc', aiResult.description)}
                      className="text-[10px] text-zinc-400 hover:text-zinc-100"
                    >
                      {copiedKey === 'desc' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="rounded-lg border border-zinc-800 bg-[#0D1015] p-2 text-[11px] text-zinc-300 leading-relaxed">
                    {aiResult.description}
                  </p>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-zinc-400">
                      Hashtags
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy('tags', aiResult.hashtags.join(' '))
                      }
                      className="text-[10px] text-zinc-400 hover:text-zinc-100"
                    >
                      {copiedKey === 'tags' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="rounded-lg border border-zinc-800 bg-[#0D1015] p-2 text-[11px] text-blue-300 leading-relaxed">
                    {aiResult.hashtags.join(' ')}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-zinc-400">
                      Timestamped Captions
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onAddAllAICaptions(aiResult.captions);
                        setAddedCaptionKeys(
                          new Set(aiResult.captions.map((_, i) => i))
                        );
                      }}
                      className="text-[10px] font-medium text-blue-400 hover:text-blue-300"
                    >
                      Add All
                    </button>
                  </div>

                  {aiResult.captions.map((cap, idx) => {
                    const added = addedCaptionKeys.has(idx);
                    return (
                      <div
                        key={idx}
                        className="rounded-lg border border-zinc-800 bg-[#0D1015] p-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <span className="block text-[10px] font-mono tabular-nums text-zinc-400">
                            {formatTime(cap.startTime)}–{formatTime(cap.endTime)}
                          </span>
                          <p className="text-[11px] text-zinc-100 mt-0.5">
                            {cap.text}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onAddAICaption(cap);
                            setAddedCaptionKeys((prev) => {
                              const next = new Set(prev);
                              next.add(idx);
                              return next;
                            });
                          }}
                          className={`px-2 py-1 rounded text-[10px] font-medium shrink-0 ${
                            added
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                          }`}
                        >
                          {added ? 'Added' : 'Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
