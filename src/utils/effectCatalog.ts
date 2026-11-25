import type {
  TimelineEffectCategory,
  TimelineEffectType,
} from '../types/editor';

export const JIT_LOGO_URL = '/assets/aistudio/image_45049bf3.png';

export type WatermarkCorner =
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left';

export const WATERMARK_CORNER_POSITIONS: Record<
  WatermarkCorner,
  {label: string; x: number; y: number}
> = {
  'top-right': {label: 'Top Right', x: 0.89, y: 0.14},
  'top-left': {label: 'Top Left', x: 0.11, y: 0.14},
  'bottom-right': {label: 'Bottom Right', x: 0.89, y: 0.86},
  'bottom-left': {label: 'Bottom Left', x: 0.11, y: 0.86},
};

export interface EffectCatalogEntry {
  type: TimelineEffectType;
  name: string;
  icon: string;
  category: TimelineEffectCategory;
  defaultIntensity: number;
  defaultOpacity: number;
  lowHint: string;
  medHint: string;
  highHint: string;
}

export const EFFECT_CATALOG: EffectCatalogEntry[] = [
  // Weather / Atmosphere
  {
    type: 'rain',
    name: 'Rain',
    icon: '🌧️',
    category: 'weather',
    defaultIntensity: 0.55,
    defaultOpacity: 0.85,
    lowHint: 'Light Drizzle',
    medHint: 'Steady Rain',
    highHint: 'Heavy Storm',
  },
  {
    type: 'snow',
    name: 'Snow',
    icon: '❄️',
    category: 'weather',
    defaultIntensity: 0.55,
    defaultOpacity: 0.9,
    lowHint: 'Soft Flurries',
    medHint: 'Snowfall',
    highHint: 'Blizzard',
  },
  {
    type: 'smoke',
    name: 'Smoke / Fog',
    icon: '🌫️',
    category: 'weather',
    defaultIntensity: 0.55,
    defaultOpacity: 0.8,
    lowHint: 'Light Mist',
    medHint: 'Drifting Fog',
    highHint: 'Dense Smoke',
  },
  // Animated Camera Motion
  {
    type: 'zoom-in',
    name: 'Slow Zoom In',
    icon: '🔍',
    category: 'motion',
    defaultIntensity: 0.55,
    defaultOpacity: 1,
    lowHint: 'Subtle Push',
    medHint: 'Smooth Zoom In',
    highHint: 'Dramatic Zoom',
  },
  {
    type: 'zoom-out',
    name: 'Slow Zoom Out',
    icon: '🔎',
    category: 'motion',
    defaultIntensity: 0.55,
    defaultOpacity: 1,
    lowHint: 'Subtle Pull',
    medHint: 'Smooth Zoom Out',
    highHint: 'Wide Reveal',
  },
  {
    type: 'camera-shake',
    name: 'Camera Shake',
    icon: '📳',
    category: 'motion',
    defaultIntensity: 0.55,
    defaultOpacity: 1,
    lowHint: 'Handheld Tremor',
    medHint: 'Action Shake',
    highHint: 'Earthquake Shake',
  },
  // Color Filters & Glitch
  {
    type: 'glitch',
    name: 'Glitch',
    icon: '⚡',
    category: 'filter',
    defaultIntensity: 0.65,
    defaultOpacity: 0.95,
    lowHint: 'Subtle RGB Shift',
    medHint: 'Digital Glitch',
    highHint: 'Heavy Distortion',
  },
  {
    type: 'teal-orange',
    name: 'Teal & Orange',
    icon: '🎬',
    category: 'filter',
    defaultIntensity: 0.75,
    defaultOpacity: 0.95,
    lowHint: 'Soft Grade',
    medHint: 'Cinema Grade',
    highHint: 'Bold Blockbuster',
  },
  {
    type: 'cyberpunk',
    name: 'Cyberpunk Neon',
    icon: '🌆',
    category: 'filter',
    defaultIntensity: 0.75,
    defaultOpacity: 0.95,
    lowHint: 'Soft Neon',
    medHint: 'Neon Glow',
    highHint: 'Hyper Neon',
  },
  {
    type: 'noir',
    name: 'Noir B&W',
    icon: '🖤',
    category: 'filter',
    defaultIntensity: 0.8,
    defaultOpacity: 1,
    lowHint: 'Soft Noir',
    medHint: 'Classic Noir',
    highHint: 'High Contrast',
  },
  {
    type: 'warm-sunset',
    name: 'Warm Sunset',
    icon: '🌅',
    category: 'filter',
    defaultIntensity: 0.75,
    defaultOpacity: 0.95,
    lowHint: 'Golden Tint',
    medHint: 'Sunset Glow',
    highHint: 'Deep Amber',
  },
  {
    type: 'cinematic',
    name: 'Cinematic',
    icon: '🎞️',
    category: 'filter',
    defaultIntensity: 0.75,
    defaultOpacity: 0.95,
    lowHint: 'Light Film',
    medHint: 'Film Look',
    highHint: 'Rich Cinema',
  },
  {
    type: 'vintage',
    name: 'Vintage',
    icon: '📷',
    category: 'filter',
    defaultIntensity: 0.75,
    defaultOpacity: 0.95,
    lowHint: 'Faded Sepia',
    medHint: 'Retro Film',
    highHint: 'Deep Vintage',
  },
  {
    type: 'bw',
    name: 'B&W',
    icon: '⬜',
    category: 'filter',
    defaultIntensity: 0.85,
    defaultOpacity: 1,
    lowHint: 'Muted Mono',
    medHint: 'Monochrome',
    highHint: 'Crisp B&W',
  },
  {
    type: 'warm',
    name: 'Warm',
    icon: '☀️',
    category: 'filter',
    defaultIntensity: 0.7,
    defaultOpacity: 0.95,
    lowHint: 'Subtle Warmth',
    medHint: 'Warm Tone',
    highHint: 'Sunny Glow',
  },
];

export function getEffectCatalogEntry(
  type: TimelineEffectType
): EffectCatalogEntry {
  return (
    EFFECT_CATALOG.find((e) => e.type === type) ?? EFFECT_CATALOG[0]
  );
}

export function getEffectIntensityLabel(
  type: TimelineEffectType,
  intensity: number
): string {
  const entry = getEffectCatalogEntry(type);
  if (intensity < 0.4) return entry.lowHint;
  if (intensity < 0.75) return entry.medHint;
  return entry.highHint;
}
