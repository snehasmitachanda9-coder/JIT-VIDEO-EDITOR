import {useState} from 'react';
import {Download, Share, X} from 'lucide-react';
import {usePWAInstall} from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        title="Install JIT Video Editor as an app"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-500/50 bg-emerald-600/20 hover:bg-emerald-600/30 text-[11px] font-medium text-emerald-200 transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Install App</span>
        <span className="sm:hidden">Install</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          title="Install on iPhone / iPad"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-700/80 bg-[#0D1015] hover:bg-zinc-800 text-[11px] font-medium text-zinc-200 transition-colors whitespace-nowrap shrink-0"
        >
          <Share className="w-3 h-3" aria-hidden="true" />
          <span>Install</span>
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-pwa-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              className="w-full max-w-xs rounded-2xl border border-zinc-800 bg-[#141820] p-4 shadow-2xl space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <h3
                  id="ios-pwa-title"
                  className="text-sm font-semibold text-zinc-100"
                >
                  Install JIT Video Editor
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close install instructions"
                  className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <ol className="text-xs text-zinc-300 space-y-2 leading-relaxed">
                <li>
                  1. Tap the <strong className="text-white">Share</strong> icon
                  in your Safari toolbar.
                </li>
                <li>
                  2. Scroll down and tap{' '}
                  <strong className="text-white">Add to Home Screen</strong>.
                </li>
                <li>
                  3. Open from your Home Screen for full-screen editing without
                  browser bars.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
