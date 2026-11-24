import {useRef, useState, type ChangeEvent} from 'react';
import {
  Check,
  Copy,
  Eraser,
  Film,
  FlipHorizontal,
  FlipVertical,
  Move,
  Music,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Sliders,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  AIStudioCaption,
  AIStudioResult,
  AspectRatioPreset,
  AudioAsset,
  AudioSettings,
  BackgroundRemovalConfig,
  BackgroundRemovalMode,
  BackgroundReplacementType,
  FilterPreset,
  MediaAsset,
  MotionPreset,
  MotionTransform,
  OverlayLayerItem,
  RightPanelTab,
  TextOverlayItem,
  VideoFilters,
} from '../types/editor';
import {warmUpSelfieSegmentation} from '../utils/backgroundRemover';
import {formatFileSize, formatTime} from '../utils/formatTime';

interface RightEditorPanelProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  // Motion & Transform tab
  motionTransform: MotionTransform;
  onUpdateMotionTransform: (patch: Partial<MotionTransform>) => void;
  onResetMotionTransform: () => void;
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
  // Text tab
  textOverlays: TextOverlayItem[];
  selectedTextId: string | null;
  totalDuration: number;
  currentTime: number;
  onAddTextOverlay: () => void;
  onSelectTextOverlay: (id: string) => void;
  onUpdateTextOverlay: (id: string, patch: Partial<TextOverlayItem>) => void;
  onDeleteTextOverlay: (id: string) => void;
  // Audio & Speed tab
  audioAssets: AudioAsset[];
  audioSettings: AudioSettings;
  onUploadAudioFiles: (files: FileList | File[]) => void;
  onAddAudioToTimeline: (asset: AudioAsset) => void;
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

const MOTION_PRESETS: Array<{id: MotionPreset; label: string}> = [
  {id: 'none', label: 'Static'},
  {id: 'zoom-in', label: 'Slow Zoom In'},
  {id: 'zoom-out', label: 'Slow Zoom Out'},
  {id: 'camera-shake', label: 'Camera Shake'},
];

const CHROMA_SWATCHES = [
  {label: 'Green Screen', hex: '#00FF00'},
  {label: 'Studio Green', hex: '#00B140'},
  {label: 'Blue Screen', hex: '#0047BB'},
];

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function RightEditorPanel({
  isCollapsed,
  onToggleCollapse,
  activeTab,
  onTabChange,
  motionTransform,
  onUpdateMotionTransform,
  onResetMotionTransform,
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
  textOverlays,
  selectedTextId,
  totalDuration,
  onAddTextOverlay,
  onSelectTextOverlay,
  onUpdateTextOverlay,
  onDeleteTextOverlay,
  audioAssets,
  audioSettings,
  onUploadAudioFiles,
  onAddAudioToTimeline,
  onUpdateAudioSettings,
  clipNames,
  aspectRatio,
  onCaptureFrameDataUrl,
  onAddAICaption,
  onAddAllAICaptions,
}: RightEditorPanelProps) {
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);

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

  const tabs: Array<{
    id: RightPanelTab;
    label: string;
    shortLabel: string;
    icon: typeof TypeIcon;
  }> = [
    {id: 'motion', label: 'Motion & Transform', shortLabel: 'Motion', icon: Move},
    {id: 'filters', label: 'Filters & Color', shortLabel: 'Color', icon: Sliders},
    {id: 'bg-remove', label: 'BG Remove', shortLabel: 'BG Cut', icon: Eraser},
    {id: 'text', label: 'Text', shortLabel: 'Text', icon: TypeIcon},
    {id: 'audio', label: 'Audio & Speed', shortLabel: 'Audio', icon: Music},
    {id: 'ai', label: 'AI Studio', shortLabel: 'AI', icon: Sparkles},
  ];

  if (isCollapsed) {
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
      className="w-72 shrink-0 border-l border-zinc-800/80 bg-[#12151B] flex flex-col min-h-0"
    >
      {/* Inspector Header */}
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

      {/* 6-Tab Bar */}
      <div
        role="tablist"
        aria-label="Editing Tools"
        className="shrink-0 grid grid-cols-6 border-b border-zinc-800/80 bg-[#0E1116]"
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

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {activeTab === 'motion' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-zinc-100">
                Motion &amp; Transform
              </h2>
              <button
                type="button"
                onClick={onResetMotionTransform}
                className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-100"
              >
                <RotateCcw className="w-3 h-3" aria-hidden="true" />
                <span>Reset</span>
              </button>
            </div>

            {/* Animated Motion Presets */}
            <div className="space-y-1.5">
              <span className="block text-[11px] font-medium text-zinc-400">
                Animated Presets
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {MOTION_PRESETS.map((preset) => {
                  const active = motionTransform.preset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        onUpdateMotionTransform({preset: preset.id})
                      }
                      className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
                        active
                          ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                          : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-zinc-800/80">
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
          </div>
        )}

        {activeTab === 'filters' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-zinc-100">
                Filters &amp; Color Grading
              </h2>
              <button
                type="button"
                onClick={onResetFilters}
                className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-100"
              >
                <RotateCcw className="w-3 h-3" aria-hidden="true" />
                <span>Reset</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {FILTER_PRESETS.map((preset) => {
                const active = filters.preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onApplyFilterPreset(preset.id)}
                    className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors truncate ${
                      active
                        ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                        : 'border-zinc-800 bg-[#0D1015] text-zinc-300 hover:border-zinc-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
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
                {overlayLayers.map((layer) => (
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
                        const val = Math.max(0, Number(e.target.value));
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
                        onUpdateTextOverlay(selectedText.id, {
                          endTime: Math.max(selectedText.startTime + 0.2, val),
                        });
                      }}
                      className="w-full rounded-lg border border-zinc-700/80 bg-[#0B0D10] px-2 py-1 text-xs font-mono tabular-nums text-zinc-100"
                    />
                  </div>
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
