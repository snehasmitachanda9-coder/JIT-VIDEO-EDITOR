import {useEffect, useState} from 'react';

export type ViewportLayoutMode =
  | 'mobile-portrait'
  | 'mobile-landscape'
  | 'desktop';

function computeViewportMode(): ViewportLayoutMode {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (h < 500) return 'mobile-landscape';
  if (w < 768) return 'mobile-portrait';
  return 'desktop';
}

export function useViewportMode(): ViewportLayoutMode {
  const [mode, setMode] = useState<ViewportLayoutMode>(computeViewportMode);

  useEffect(() => {
    const update = () => {
      const next = computeViewportMode();
      setMode((prev) => (prev === next ? prev : next));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return mode;
}
