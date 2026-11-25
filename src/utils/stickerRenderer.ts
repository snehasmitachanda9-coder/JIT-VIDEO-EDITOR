import type {StickerKind} from '../types/editor';

export interface StickerDefinition {
  kind: StickerKind;
  label: string;
  aspectRatio: number;
  svg: string;
  dataUrl: string;
}

function encodeSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const RAW_STICKERS: Array<{
  kind: StickerKind;
  label: string;
  aspectRatio: number;
  svg: string;
}> = [
  {
    kind: 'sunglasses',
    label: 'Sunglasses',
    aspectRatio: 2.2,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 100">
      <rect x="8" y="22" width="88" height="54" rx="16" fill="#09090B" stroke="#E4E4E7" stroke-width="5"/>
      <rect x="124" y="22" width="88" height="54" rx="16" fill="#09090B" stroke="#E4E4E7" stroke-width="5"/>
      <path d="M96 38 Q110 26 124 38" fill="none" stroke="#E4E4E7" stroke-width="7" stroke-linecap="round"/>
      <path d="M22 35 L46 35 L30 62 L18 62 Z" fill="rgba(255,255,255,0.22)"/>
      <path d="M138 35 L162 35 L146 62 L134 62 Z" fill="rgba(255,255,255,0.22)"/>
      <rect x="2" y="28" width="10" height="12" rx="3" fill="#FACC15"/>
      <rect x="208" y="28" width="10" height="12" rx="3" fill="#FACC15"/>
    </svg>`,
  },
  {
    kind: 'crown',
    label: 'Crown',
    aspectRatio: 1.45,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 110">
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#FDE047"/>
          <stop offset="100%" stop-color="#D97706"/>
        </linearGradient>
      </defs>
      <path d="M16 86 L10 30 L48 56 L80 18 L112 56 L150 30 L144 86 Z" fill="url(#cg)" stroke="#78350F" stroke-width="4" stroke-linejoin="round"/>
      <rect x="14" y="84" width="132" height="16" rx="6" fill="#B45309" stroke="#78350F" stroke-width="3"/>
      <circle cx="80" cy="16" r="7" fill="#38BDF8" stroke="#0C4A6E" stroke-width="2.5"/>
      <circle cx="10" cy="28" r="6" fill="#F43F5E" stroke="#881337" stroke-width="2.5"/>
      <circle cx="150" cy="28" r="6" fill="#F43F5E" stroke="#881337" stroke-width="2.5"/>
      <circle cx="80" cy="64" r="7" fill="#EF4444"/>
      <circle cx="48" cy="68" r="5" fill="#38BDF8"/>
      <circle cx="112" cy="68" r="5" fill="#38BDF8"/>
    </svg>`,
  },
  {
    kind: 'fire',
    label: 'Fire',
    aspectRatio: 0.85,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140">
      <path d="M62 8 C74 34 106 46 106 84 C106 112 85 132 60 132 C34 132 14 112 14 84 C14 58 30 42 36 30 C38 44 46 48 50 46 C44 26 52 14 62 8 Z" fill="#F97316" stroke="#7C2D12" stroke-width="4" stroke-linejoin="round"/>
      <path d="M60 44 C70 60 88 70 88 94 C88 112 75 124 60 124 C45 124 32 112 32 94 C32 76 44 64 50 56 C52 66 58 68 60 44 Z" fill="#FACC15"/>
      <path d="M60 76 C66 84 72 90 72 102 C72 112 67 118 60 118 C53 118 48 112 48 102 C48 92 54 84 60 76 Z" fill="#FEF9C3"/>
    </svg>`,
  },
  {
    kind: 'heart',
    label: 'Heart',
    aspectRatio: 1.1,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 120">
      <defs>
        <linearGradient id="hg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FB7185"/>
          <stop offset="100%" stop-color="#E11D48"/>
        </linearGradient>
      </defs>
      <path d="M66 110 C66 110 10 76 10 38 C10 20 24 8 40 8 C52 8 61 15 66 24 C71 15 80 8 92 8 C108 8 122 20 122 38 C122 76 66 110 66 110 Z" fill="url(#hg)" stroke="#881337" stroke-width="4" stroke-linejoin="round"/>
      <path d="M28 32 C28 24 35 19 42 21" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="6" stroke-linecap="round"/>
    </svg>`,
  },
  {
    kind: 'laugh',
    label: 'Laugh Emoji',
    aspectRatio: 1,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <circle cx="64" cy="64" r="56" fill="#FACC15" stroke="#854D0E" stroke-width="4"/>
      <path d="M32 50 L48 44 L36 38" fill="none" stroke="#18181B" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M96 50 L80 44 L92 38" fill="none" stroke="#18181B" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M34 68 Q64 74 94 68 Q92 104 64 104 Q36 104 34 68 Z" fill="#7F1D1D" stroke="#18181B" stroke-width="4" stroke-linejoin="round"/>
      <path d="M39 70 Q64 75 89 70 L87 79 Q64 83 41 79 Z" fill="#FFFFFF"/>
      <path d="M18 56 C10 64 8 76 16 82 C24 88 31 78 24 66 Z" fill="#38BDF8" stroke="#0369A1" stroke-width="2.5"/>
      <path d="M110 56 C118 64 120 76 112 82 C104 88 97 78 104 66 Z" fill="#38BDF8" stroke="#0369A1" stroke-width="2.5"/>
    </svg>`,
  },
  {
    kind: 'thumbs-up',
    label: 'Thumbs Up',
    aspectRatio: 1,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <rect x="14" y="54" width="24" height="58" rx="6" fill="#2563EB" stroke="#1E3A8A" stroke-width="4"/>
      <path d="M40 58 L56 18 C61 10 74 14 72 28 L68 48 L104 48 C114 48 118 60 112 68 C116 74 114 84 108 88 C111 95 107 104 99 106 C100 113 94 118 84 118 L46 118 C41 118 38 114 38 109 L38 58 Z" fill="#FDE047" stroke="#854D0E" stroke-width="4" stroke-linejoin="round"/>
      <line x1="88" y1="68" x2="108" y2="68" stroke="#CA8A04" stroke-width="3.5" stroke-linecap="round"/>
      <line x1="88" y1="86" x2="106" y2="86" stroke="#CA8A04" stroke-width="3.5" stroke-linecap="round"/>
      <line x1="86" y1="103" x2="99" y2="103" stroke="#CA8A04" stroke-width="3.5" stroke-linecap="round"/>
    </svg>`,
  },
  {
    kind: 'star',
    label: 'Star',
    aspectRatio: 1.05,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 126">
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#FEF08A"/>
          <stop offset="100%" stop-color="#F59E0B"/>
        </linearGradient>
      </defs>
      <polygon points="66,8 83,44 123,49 93,77 101,117 66,97 31,117 39,77 9,49 49,44" fill="url(#sg)" stroke="#92400E" stroke-width="4" stroke-linejoin="round"/>
      <polygon points="66,24 76,47 101,50 83,68 88,93 66,81 44,93 49,68 31,50 56,47" fill="rgba(255,255,255,0.22)"/>
    </svg>`,
  },
  {
    kind: 'party-hat',
    label: 'Party Hat',
    aspectRatio: 0.85,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140">
      <circle cx="60" cy="18" r="12" fill="#FACC15" stroke="#854D0E" stroke-width="3.5"/>
      <path d="M60 22 L104 122 Q60 134 16 122 Z" fill="#EC4899" stroke="#831843" stroke-width="4" stroke-linejoin="round"/>
      <path d="M45 56 L86 80 L94 98 L36 76 Z" fill="#38BDF8"/>
      <path d="M29 92 L99 112 L104 122 Q60 132 20 120 Z" fill="#A855F7"/>
      <circle cx="62" cy="52" r="5" fill="#FACC15"/>
      <circle cx="48" cy="100" r="5" fill="#4ADE80"/>
      <circle cx="76" cy="108" r="5" fill="#FACC15"/>
    </svg>`,
  },
  {
    kind: 'speech-bubble',
    label: 'Speech Bubble',
    aspectRatio: 1.35,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 176 130">
      <path d="M24 14 H152 C161 14 168 21 168 30 V84 C168 93 161 100 152 100 H66 L36 120 L42 100 H24 C15 100 8 93 8 84 V30 C8 21 15 14 24 14 Z" fill="#FFFFFF" stroke="#18181B" stroke-width="5" stroke-linejoin="round"/>
      <text x="88" y="66" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-weight="800" font-size="34" fill="#EF4444">OMG!</text>
    </svg>`,
  },
];

export const STICKER_CATALOG: StickerDefinition[] = RAW_STICKERS.map((s) => ({
  ...s,
  dataUrl: encodeSvgDataUrl(s.svg),
}));

const stickerImageCache = new Map<StickerKind, HTMLImageElement>();

export function getStickerDefinition(kind: StickerKind): StickerDefinition {
  return (
    STICKER_CATALOG.find((s) => s.kind === kind) ?? STICKER_CATALOG[0]
  );
}

export function getStickerImageElement(
  kind: StickerKind,
  onLoaded?: () => void
): HTMLImageElement {
  const existing = stickerImageCache.get(kind);
  if (existing) {
    return existing;
  }
  const def = getStickerDefinition(kind);
  const img = new Image();
  if (onLoaded) {
    img.onload = onLoaded;
  }
  img.src = def.dataUrl;
  stickerImageCache.set(kind, img);
  return img;
}

export function preloadStickerImage(kind: StickerKind): Promise<HTMLImageElement> {
  const existing = stickerImageCache.get(kind);
  if (existing && existing.complete && existing.naturalWidth > 0) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve) => {
    const def = getStickerDefinition(kind);
    const img = existing ?? new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
    if (!img.src) img.src = def.dataUrl;
    stickerImageCache.set(kind, img);
  });
}
