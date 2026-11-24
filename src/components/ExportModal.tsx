import {CheckCircle2, Download, X, AlertCircle} from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  isExporting: boolean;
  progress: number;
  phase: string;
  error: string | null;
  downloadUrl: string | null;
  downloadFilename: string;
  onCancel: () => void;
  onClose: () => void;
}

export function ExportModal({
  isOpen,
  isExporting,
  progress,
  phase,
  error,
  downloadUrl,
  downloadFilename,
  onCancel,
  onClose,
}: ExportModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#141820] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="export-modal-title"
              className="text-base font-semibold text-zinc-100"
            >
              {error
                ? 'Export Failed'
                : isExporting
                  ? 'Exporting Video'
                  : 'Export Ready'}
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              {error
                ? error
                : phase}
            </p>
          </div>

          {!isExporting && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close export modal"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="mt-5">
          {error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 flex items-center gap-3 text-xs text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Render progress</span>
                <span className="font-mono tabular-nums font-medium text-zinc-100">
                  {progress}%
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full transition-[width] duration-150 ${
                    progress >= 100 ? 'bg-emerald-500' : 'bg-blue-500'
                  }`}
                  style={{width: `${progress}%`}}
                />
              </div>
            </div>
          )}

          {!isExporting && !error && downloadUrl && (
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center gap-2.5 text-xs text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" aria-hidden="true" />
              <span className="truncate">Saved as {downloadFilename}</span>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2.5">
          {isExporting ? (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors"
            >
              Cancel Export
            </button>
          ) : (
            <>
              {downloadUrl && !error && (
                <a
                  href={downloadUrl}
                  download={downloadFilename}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Download Again</span>
                </a>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
