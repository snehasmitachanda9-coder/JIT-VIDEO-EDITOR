import {
  Download,
  Film,
  Maximize,
  Minimize,
  SlidersHorizontal,
} from 'lucide-react';
import type {ViewportLayoutMode} from '../hooks/useViewportMode';
import {JIT_LOGO_URL} from '../utils/effectCatalog';
import {PWAInstallButton} from './PWAInstallButton';

interface HeaderProps {
  canExport: boolean;
  isExporting: boolean;
  onExportClick: () => void;
  layoutMode: ViewportLayoutMode;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  landscapeDrawer?: 'none' | 'media' | 'tools';
  onToggleLandscapeDrawer?: (drawer: 'media' | 'tools') => void;
}

export function Header({
  canExport,
  isExporting,
  onExportClick,
  layoutMode,
  isFullscreen,
  onToggleFullscreen,
  landscapeDrawer = 'none',
  onToggleLandscapeDrawer,
}: HeaderProps) {
  const disabled = !canExport || isExporting;
  const isPortrait = layoutMode === 'mobile-portrait';
  const isLandscape = layoutMode === 'mobile-landscape';

  return (
    <header
      className={`shrink-0 border-b border-zinc-800/80 bg-[#12151B] flex items-center justify-between gap-2 ${
        isPortrait
          ? 'h-[44px] px-2.5'
          : isLandscape
            ? 'h-10 px-3'
            : 'h-14 px-5 gap-6'
      }`}
    >
      {/* Left: Official JIT Logo + Title */}
      <div className="flex items-center gap-2 min-w-0 shrink">
        <div
          className={`rounded-lg bg-white p-0.5 border border-zinc-700/70 shadow-sm overflow-hidden flex items-center justify-center shrink-0 ${
            isPortrait || isLandscape ? 'w-7 h-7' : 'w-8 h-8'
          }`}
        >
          <img
            src={JIT_LOGO_URL}
            alt="JIT - Jharna Institute of Technology"
            className="w-full h-full object-contain"
          />
        </div>
        <h1
          className={`font-semibold tracking-tight text-zinc-100 truncate ${
            isPortrait
              ? 'text-xs sm:text-sm'
              : isLandscape
                ? 'text-xs'
                : 'text-base whitespace-nowrap'
          }`}
        >
          JIT Video Editor
        </h1>
      </div>

      {/* Right: Landscape Drawers + PWA Install + Full Screen + Export */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {isLandscape && onToggleLandscapeDrawer && (
          <>
            <button
              type="button"
              onClick={() => onToggleLandscapeDrawer('media')}
              aria-pressed={landscapeDrawer === 'media'}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors whitespace-nowrap ${
                landscapeDrawer === 'media'
                  ? 'border-blue-500 bg-blue-600/20 text-blue-200'
                  : 'border-zinc-700/80 bg-[#0D1015] text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <Film className="w-3 h-3" aria-hidden="true" />
              <span>Media</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleLandscapeDrawer('tools')}
              aria-pressed={landscapeDrawer === 'tools'}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors whitespace-nowrap ${
                landscapeDrawer === 'tools'
                  ? 'border-blue-500 bg-blue-600/20 text-blue-200'
                  : 'border-zinc-700/80 bg-[#0D1015] text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <SlidersHorizontal className="w-3 h-3" aria-hidden="true" />
              <span>Tools</span>
            </button>
          </>
        )}

        <PWAInstallButton />

        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-pressed={isFullscreen}
          title={
            isFullscreen
              ? 'Exit Full Screen'
              : 'Enter Full Screen App Mode'
          }
          className={`inline-flex items-center gap-1.5 rounded-lg border font-medium transition-colors whitespace-nowrap shrink-0 ${
            isPortrait || isLandscape
              ? 'px-2 py-1 text-[11px]'
              : 'px-3 py-1.5 text-xs'
          } ${
            isFullscreen
              ? 'border-blue-500/60 bg-blue-600/20 text-blue-200'
              : 'border-zinc-700/80 bg-[#0D1015] text-zinc-200 hover:text-white hover:border-zinc-600 hover:bg-zinc-800/70'
          }`}
        >
          {isFullscreen ? (
            <>
              <Minimize className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isPortrait ? 'Exit' : 'Exit Full'}</span>
            </>
          ) : (
            <>
              <Maximize className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Full Screen</span>
            </>
          )}
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={onExportClick}
          title={
            canExport
              ? 'Render and download edited video'
              : 'Add a video clip to the timeline to export'
          }
          className={`inline-flex items-center gap-1.5 font-medium rounded-lg transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            isPortrait || isLandscape
              ? 'px-2.5 py-1 text-[11px]'
              : 'px-4 py-2 text-xs'
          } ${
            disabled
              ? 'bg-zinc-800/70 text-zinc-500 border border-zinc-700/50 cursor-not-allowed select-none'
              : 'bg-blue-600 hover:bg-blue-500 text-white border border-blue-500/60 cursor-pointer'
          }`}
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          <span>
            {isExporting
              ? 'Exporting...'
              : isPortrait || isLandscape
                ? 'Export'
                : 'Export Video'}
          </span>
        </button>
      </div>
    </header>
  );
}
