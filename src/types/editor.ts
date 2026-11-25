export type AspectRatioPreset = '16:9' | '9:16' | '1:1';
export type VideoFitMode = 'contain' | 'cover';
export type FilterPreset =
  | 'none'
  | 'bw'
  | 'vintage'
  | 'warm'
  | 'cinematic'
  | 'teal-orange'
  | 'cyberpunk'
  | 'noir'
  | 'warm-sunset'
  | 'glitch';

export type RightPanelTab =
  | 'motion'
  | 'filters'
  | 'bg-remove'
  | 'stickers'
  | 'text'
  | 'audio'
  | 'ai';

export type WeatherEffectType = 'rain' | 'snow' | 'smoke';

export type MotionEffectType =
  | 'zoom-in'
  | 'zoom-out'
  | 'camera-shake'
  | 'heartbeat-zoom'
  | 'speed-ramp';

export type StudioVfxType =
  | 'disco'
  | 'halation'
  | 'neon-edge'
  | 'golden-hour'
  | 'bokeh-particles'
  | 'focus-pull';

export type CinemaVfxType =
  | 'letterbox'
  | 'film-grain'
  | 'lens-flare'
  | 'light-leak'
  | 'ai-portrait';

export type TimelineEffectType =
  | WeatherEffectType
  | MotionEffectType
  | 'glitch'
  | 'teal-orange'
  | 'cyberpunk'
  | 'noir'
  | 'warm-sunset'
  | 'cinematic'
  | 'vintage'
  | 'bw'
  | 'warm'
  | StudioVfxType
  | CinemaVfxType;

export type TimelineEffectCategory =
  | 'weather'
  | 'motion'
  | 'filter'
  | 'studio'
  | 'cinema';

export type SpeedRampMode = 'slow-mo' | 'speed-up';

export interface TimelineEffectItem {
  id: string;
  type: TimelineEffectType;
  category: TimelineEffectCategory;
  name: string;
  icon: string;
  intensity: number; // 0..1.0
  opacity: number; // 0..1.0
  startTime: number;
  endTime: number;
  // Precision timed zoom keyframe controls (used by zoom-in / zoom-out)
  targetZoom?: number; // 110..300 (%)
  zoomCenterX?: number; // 0..100 (%)
  zoomCenterY?: number; // 0..100 (%)
  // Speed Ramp / Slow-Mo pulse direction
  speedRampMode?: SpeedRampMode;
}

export type StickerKind =
  | 'sunglasses'
  | 'crown'
  | 'fire'
  | 'heart'
  | 'laugh'
  | 'thumbs-up'
  | 'star'
  | 'party-hat'
  | 'speech-bubble';

export type OverlayAnimationPreset =
  | 'none'
  | 'pop'
  | 'fade'
  | 'typewriter'
  | 'slide-up'
  | 'bounce'
  | '3d-extrude';

export type FaceAnchorPreset =
  | 'custom'
  | 'face-head'
  | 'face-eyes'
  | 'face-mouth'
  | 'center'
  | 'lower-third';

export type BuiltInSfxKind = 'whoosh' | 'pop' | 'clap' | 'laugh';

export type MotionPreset =
  | 'none'
  | 'zoom-in'
  | 'zoom-out'
  | 'camera-shake';

export interface MotionTransform {
  zoom: number; // 50..300 (%)
  panX: number; // -100..100 (%)
  panY: number; // -100..100 (%)
  rotate: number; // -180..180 (deg)
  flipH: boolean;
  flipV: boolean;
  preset: MotionPreset;
}

export const DEFAULT_MOTION_TRANSFORM: MotionTransform = {
  zoom: 100,
  panX: 0,
  panY: 0,
  rotate: 0,
  flipH: false,
  flipV: false,
  preset: 'none',
};

export type TransitionType =
  | 'none'
  | 'crossfade'
  | 'slide-left'
  | 'slide-right'
  | 'wipe'
  | 'zoom'
  | 'glitch'
  | 'flash-white'
  | 'flash-black'
  | 'spin'
  | 'blur'
  | 'cube-3d';

export interface ClipTransition {
  type: TransitionType;
  duration: number; // 0.3..2.5 seconds
}

export type BackgroundRemovalMode = 'none' | 'ai-person' | 'chroma-key';
export type BackgroundReplacementType =
  | 'transparent'
  | 'solid'
  | 'blur'
  | 'image'
  | 'video';

export interface BackgroundRemovalConfig {
  mode: BackgroundRemovalMode;
  keyColor: string;
  similarity: number; // 0.05..0.6
  smoothness: number; // 0.01..0.3
  maskBlur: number; // 0..4 px feathering
  replacementType: BackgroundReplacementType;
  replacementColor: string;
  replacementBlur: number; // 4..24 px
  replacementAssetId: string | null;
  replacementAssetUrl: string | null;
  replacementAssetKind: 'image' | 'video' | null;
  replacementAssetName: string | null;
}

export const DEFAULT_BG_REMOVAL: BackgroundRemovalConfig = {
  mode: 'none',
  keyColor: '#00FF00',
  similarity: 0.28,
  smoothness: 0.08,
  maskBlur: 1.5,
  replacementType: 'solid',
  replacementColor: '#111827',
  replacementBlur: 14,
  replacementAssetId: null,
  replacementAssetUrl: null,
  replacementAssetKind: null,
  replacementAssetName: null,
};

export interface MediaAsset {
  id: string;
  kind: 'video' | 'image';
  name: string;
  url: string;
  size: number;
  type: string;
  duration: number;
  width: number;
  height: number;
  thumbnailUrl: string | null;
}

export interface AudioAsset {
  id: string;
  name: string;
  url: string;
  size: number;
  duration: number;
}

export interface TimelineVideoClip {
  id: string;
  kind: 'video' | 'freeze';
  assetId: string;
  name: string;
  url: string;
  thumbnailUrl: string | null;
  sourceDuration: number;
  trimStart: number;
  trimEnd: number;
  transitionIn: ClipTransition;
}

export interface OverlayLayerItem {
  id: string;
  assetId: string;
  kind: 'image' | 'video' | 'sticker';
  stickerKind?: StickerKind;
  name: string;
  url: string;
  thumbnailUrl: string | null;
  sourceDuration: number;
  sourceTrimStart: number;
  startTime: number;
  endTime: number;
  x: number; // Normalized 0..1 center X on canvas
  y: number; // Normalized 0..1 center Y on canvas
  width: number; // Normalized 0..1 fraction of canvas width
  aspectRatio: number; // Natural width / height
  opacity: number; // 0..1
  animation?: OverlayAnimationPreset;
  anchorPreset?: FaceAnchorPreset;
  followMotion?: boolean;
  bgRemoval: BackgroundRemovalConfig;
}

export interface TimelineAudioClip {
  id: string;
  assetId: string;
  name: string;
  url: string;
  sourceDuration: number;
  startTime: number;
  trimStart: number;
  trimEnd: number;
  volume?: number; // 0..1.5 (defaults to 1)
  fadeIn?: number; // 0..5 seconds
  fadeOut?: number; // 0..5 seconds
  isSfx?: boolean;
}

export interface TextOverlayItem {
  id: string;
  text: string;
  x: number; // Normalized 0..1 center X on canvas
  y: number; // Normalized 0..1 center Y on canvas
  fontFamily: string;
  fontSize: number;
  color: string;
  backgroundColor: string;
  hasBackground: boolean;
  startTime: number;
  endTime: number;
  animation?: OverlayAnimationPreset;
  anchorPreset?: FaceAnchorPreset;
  followMotion?: boolean;
}

export interface VideoFilters {
  brightness: number; // 0..200 (100 = normal)
  contrast: number; // 0..200 (100 = normal)
  saturation: number; // 0..200 (100 = normal)
  blur: number; // 0..12 px
  hueRotate: number; // -180..180 deg
  vignette: number; // 0..100 %
  sharpen: number; // 0..100 %
  faceGlow: number; // 0..100 % Face Glow / Beauty Smooth
  preset: FilterPreset;
}

export type VoiceChangerPreset =
  | 'normal'
  | 'deep'
  | 'chipmunk'
  | 'robot'
  | 'radio';

export interface AudioEffectsConfig {
  echoEnabled: boolean;
  echoAmount: number; // 0..100 %
  reverbEnabled: boolean;
  reverbAmount: number; // 0..100 %
  noiseReductionEnabled: boolean;
  noiseReductionAmount: number; // 0..100 %
  voiceEnhanceEnabled: boolean;
  voiceEnhanceAmount: number; // 0..100 %
  voicePreset: VoiceChangerPreset;
  pitchSemitones: number; // -12..+12
  autoVolumeEnabled: boolean;
  target: 'both' | 'video' | 'music';
}

export const DEFAULT_AUDIO_EFFECTS: AudioEffectsConfig = {
  echoEnabled: false,
  echoAmount: 45,
  reverbEnabled: false,
  reverbAmount: 50,
  noiseReductionEnabled: false,
  noiseReductionAmount: 55,
  voiceEnhanceEnabled: false,
  voiceEnhanceAmount: 65,
  voicePreset: 'normal',
  pitchSemitones: 0,
  autoVolumeEnabled: false,
  target: 'both',
};

export interface AudioSettings {
  videoVolume: number; // 0..1
  videoMuted: boolean;
  musicVolume: number; // 0..1
  musicMuted: boolean;
  playbackSpeed: number; // 0.5..2.0
  effects: AudioEffectsConfig;
}

export interface BeatSyncAnalysis {
  clipId: string;
  clipName: string;
  bpm: number;
  beatTimes: number[]; // Timeline timestamps in seconds
}

export type SelectedTimelineItem =
  | {track: 'video'; id: string}
  | {track: 'effect'; id: string}
  | {track: 'overlay'; id: string}
  | {track: 'audio'; id: string}
  | {track: 'text'; id: string}
  | null;

export interface AIStudioCaption {
  startTime: number;
  endTime: number;
  text: string;
}

export interface AIStudioResult {
  titles: string[];
  description: string;
  hashtags: string[];
  captions: AIStudioCaption[];
}
