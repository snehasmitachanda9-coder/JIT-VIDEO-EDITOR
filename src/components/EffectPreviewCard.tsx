import {useEffect, useRef, useState} from 'react';
import {Plus} from 'lucide-react';
import type {Effect34Meta} from '../utils/effectCatalog';
import {drawFx34PreviewScene} from '../utils/fx34Renderer';

interface EffectPreviewCardProps {
  effect: Effect34Meta;
  isSelected: boolean;
  onAdd: (type: Effect34Meta['type']) => void;
}

export function EffectPreviewCard({
  effect,
  isSelected,
  onAdd,
}: EffectPreviewCardProps) {
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setIsVisible(entry.isIntersecting);
        }
      },
      {threshold: 0.05}
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    if (!isVisible) {
      drawFx34PreviewScene(ctx, w, h, effect.type, 1.1);
      return;
    }

    let rafId = 0;
    let lastDraw = 0;
    const startMs = performance.now();

    const tick = (now: number) => {
      if (now - lastDraw >= 40) {
        lastDraw = now;
        const tSec = 0.25 + ((now - startMs) / 1000) % 3.0;
        drawFx34PreviewScene(ctx, w, h, effect.type, tSec);
      }
      rafId = requestAnimationFrame(tick);
    };

    drawFx34PreviewScene(ctx, w, h, effect.type, 0.75);
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [effect.type, isVisible]);

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={() => onAdd(effect.type)}
      title={`${effect.name} — ${effect.description}`}
      className={`group rounded-xl border overflow-hidden text-left transition-all flex flex-col bg-[#0D1015] ${
        isSelected
          ? 'border-emerald-400 ring-1 ring-emerald-400/70 bg-emerald-500/10'
          : 'border-zinc-800 hover:border-emerald-500/60 hover:bg-zinc-900/90'
      }`}
    >
      <div className="relative w-full aspect-video bg-[#080A0E] overflow-hidden border-b border-zinc-800/70">
        <canvas
          ref={canvasRef}
          width={144}
          height={81}
          className="w-full h-full block"
        />
        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/65 backdrop-blur-[2px] text-[10px] leading-none">
          {effect.icon}
        </span>
        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-emerald-600/90 text-[9px] font-semibold text-white inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
          <Plus className="w-2.5 h-2.5" aria-hidden="true" />
          Add
        </span>
      </div>
      <div className="px-2 py-1.5 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-semibold text-zinc-100 truncate">
            {effect.name}
          </span>
        </div>
        <p className="text-[9px] text-zinc-400 truncate mt-0.5">
          {effect.description}
        </p>
      </div>
    </button>
  );
}
