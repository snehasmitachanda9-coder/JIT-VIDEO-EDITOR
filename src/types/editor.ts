export type AspectRatioPreset = '16:9' | '9:16' | '1:1';
export type VideoFitMode = 'contain' | 'cover';
export type FilterPreset = 'none' | 'bw' | 'vintage' | 'warm' | 'cinematic';
export type RightPanelTab = 'text' | 'filters' | 'bg-remove' | 'audio' | 'ai';

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
  assetId: string;
  name: string;
  url: string;
  thumbnailUrl: string | null;
  sourceDuration: number;
  trimStart: number;
  trimEnd: number;
}

export interface OverlayLayerItem {
  id: string;
  assetId: string;
  kind: 'image' | 'video';
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
}

export interface VideoFilters {
  brightness: number; // 0..200 (100 = normal)
  contrast: number; // 0..200 (100 = normal)
  saturation: number; // 0..200 (100 = normal)
  blur: number; // 0..12 px
  preset: FilterPreset;
}

export interface AudioSettings {
  videoVolume: number; // 0..1
  videoMuted: boolean;
  musicVolume: number; // 0..1
  musicMuted: boolean;
  playbackSpeed: number; // 0.5..2.0
}

export type SelectedTimelineItem =
  | {track: 'video'; id: string}
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
