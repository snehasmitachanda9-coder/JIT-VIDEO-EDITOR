import type {
  FaceAnchorPreset,
  OverlayAnimationPreset,
  TimelineEffectCategory,
  TimelineEffectType,
  TransitionType,
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

export const TRANSITION_OPTIONS: Array<{id: TransitionType; label: string}> = [
  {id: 'none', label: 'None'},
  {id: 'crossfade', label: 'Cross Dissolve'},
  {id: 'slide-left', label: 'Slide Left'},
  {id: 'slide-right', label: 'Slide Right'},
  {id: 'wipe', label: 'Wipe'},
  {id: 'zoom', label: 'Zoom Transition'},
  {id: 'glitch', label: 'Glitch Transition'},
  {id: 'flash-white', label: 'Flash (White)'},
  {id: 'flash-black', label: 'Flash (Black)'},
  {id: 'spin', label: 'Spin Transition'},
  {id: 'blur', label: 'Blur Transition'},
  {id: 'cube-3d', label: '3D Cube'},
];

export const OVERLAY_ANIMATION_OPTIONS: Array<{
  id: OverlayAnimationPreset;
  label: string;
}> = [
  {id: 'none', label: 'None'},
  {id: 'pop', label: 'Pop'},
  {id: 'fade', label: 'Fade'},
  {id: 'typewriter', label: 'Typewriter'},
  {id: 'slide-up', label: 'Slide Up'},
  {id: 'bounce', label: 'Bounce'},
  {id: '3d-extrude', label: '3D Shadow'},
];

export const FACE_ANCHOR_POSITIONS: Array<{
  id: FaceAnchorPreset;
  label: string;
  x: number;
  y: number;
}> = [
  {id: 'face-head', label: 'Head / Crown', x: 0.5, y: 0.2},
  {id: 'face-eyes', label: 'Eyes / Glasses', x: 0.5, y: 0.36},
  {id: 'face-mouth', label: 'Mouth / Chin', x: 0.5, y: 0.52},
  {id: 'center', label: 'Center', x: 0.5, y: 0.5},
  {id: 'lower-third', label: 'Lower 3rd', x: 0.5, y: 0.82},
];

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
  // Party & Creative VFX
  {
    type: 'disco',
    name: 'Disco Lights',
    icon: '🪩',
    category: 'party',
    defaultIntensity: 0.65,
    defaultOpacity: 0.9,
    lowHint: 'Soft Club Pulse',
    medHint: 'Beat Disco Strobe',
    highHint: 'Rave Strobe',
  },
  {
    type: 'rgb-split',
    name: 'RGB Split',
    icon: '🌈',
    category: 'party',
    defaultIntensity: 0.6,
    defaultOpacity: 0.95,
    lowHint: 'Subtle Prism',
    medHint: 'Chromatic Shift',
    highHint: 'Extreme Aberration',
  },
  {
    type: 'vhs',
    name: 'VHS Retro',
    icon: '📼',
    category: 'party',
    defaultIntensity: 0.65,
    defaultOpacity: 0.95,
    lowHint: 'Soft Tape',
    medHint: 'Classic 90s VHS',
    highHint: 'Heavy Tracking',
  },
  {
    type: 'cartoon',
    name: 'Cartoon Cel',
    icon: '🎨',
    category: 'party',
    defaultIntensity: 0.7,
    defaultOpacity: 1,
    lowHint: 'Light Toon',
    medHint: 'Cel-Shaded Comic',
    highHint: 'Bold Ink Art',
  },
  {
    type: 'pencil-sketch',
    name: 'Pencil Sketch',
    icon: '✏️',
    category: 'party',
    defaultIntensity: 0.75,
    defaultOpacity: 1,
    lowHint: 'Faint Sketch',
    medHint: 'Graphite Drawing',
    highHint: 'Deep Charcoal',
  },
  {
    type: 'mirror',
    name: 'Mirror',
    icon: '🪞',
    category: 'party',
    defaultIntensity: 0.85,
    defaultOpacity: 1,
    lowHint: 'Subtle Blend',
    medHint: 'Symmetry Split',
    highHint: 'Pure Reflection',
  },
  {
    type: 'split-screen',
    name: 'Split Screen',
    icon: '🪟',
    category: 'party',
    defaultIntensity: 0.45,
    defaultOpacity: 1,
    lowHint: '2-Way Split',
    medHint: '2-Way Split',
    highHint: '4-Way Grid',
  },
  {
    type: 'double-exposure',
    name: 'Double Exposure',
    icon: '👥',
    category: 'party',
    defaultIntensity: 0.6,
    defaultOpacity: 0.95,
    lowHint: 'Faint Ghost',
    medHint: 'Dreamy Double',
    highHint: 'Deep Fusion',
  },
  {
    type: 'heart-star-burst',
    name: 'Hearts & Stars',
    icon: '💖',
    category: 'party',
    defaultIntensity: 0.65,
    defaultOpacity: 0.95,
    lowHint: 'Gentle Sparkle',
    medHint: 'Festive Burst',
    highHint: 'Supernova Party',
  },
  // Cinema & Film VFX
  {
    type: 'letterbox',
    name: 'Cinema Bars',
    icon: '🎥',
    category: 'cinema',
    defaultIntensity: 0.55,
    defaultOpacity: 1,
    lowHint: '1.85:1 Slim Bars',
    medHint: '2.39:1 Scope',
    highHint: 'Ultra Wide Frame',
  },
  {
    type: 'film-grain',
    name: 'Film Grain',
    icon: '🎞️',
    category: 'cinema',
    defaultIntensity: 0.55,
    defaultOpacity: 0.85,
    lowHint: '35mm Fine Grain',
    medHint: '16mm Organic',
    highHint: 'Raw 8mm Grit',
  },
  {
    type: 'lens-flare',
    name: 'Lens Flare',
    icon: '✨',
    category: 'cinema',
    defaultIntensity: 0.65,
    defaultOpacity: 0.9,
    lowHint: 'Soft Sun Kiss',
    medHint: 'Anamorphic Flare',
    highHint: 'Sci-Fi Streak',
  },
  {
    type: 'light-leak',
    name: 'Light Leak',
    icon: '🔆',
    category: 'cinema',
    defaultIntensity: 0.65,
    defaultOpacity: 0.9,
    lowHint: 'Warm Corner Bleed',
    medHint: 'Analog Leak',
    highHint: 'Rich Prism Burn',
  },
  {
    type: 'film-burn',
    name: 'Film Burn',
    icon: '🔥',
    category: 'cinema',
    defaultIntensity: 0.65,
    defaultOpacity: 0.95,
    lowHint: 'Amber Gate Glow',
    medHint: 'Classic Reel Burn',
    highHint: 'Intense Emulsion',
  },
  {
    type: 'motion-blur',
    name: 'Motion Blur',
    icon: '💨',
    category: 'cinema',
    defaultIntensity: 0.6,
    defaultOpacity: 0.95,
    lowHint: 'Soft Trail',
    medHint: 'Action Blur',
    highHint: 'Hyper Velocity',
  },
  {
    type: 'ai-portrait',
    name: 'AI Portrait',
    icon: '🪄',
    category: 'cinema',
    defaultIntensity: 0.65,
    defaultOpacity: 0.95,
    lowHint: 'Natural Polish',
    medHint: 'Skin Glow & Pop',
    highHint: 'Studio Retouch',
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
    icon: '🎦',
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
