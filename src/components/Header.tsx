import {Download} from 'lucide-react';

interface HeaderProps {
  canExport: boolean;
  isExporting: boolean;
  onExportClick: () => void;
}

export function Header({
  canExport,
  isExporting,
  onExportClick,
}: HeaderProps) {
  const disabled = !canExport || isExporting;

  return (
    <header className="h-14 shrink-0 border-b border-zinc-800/80 bg-[#12151B] px-5 flex items-center justify-between gap-8">
      <h1 className="text-base font-semibold tracking-tight text-zinc-100 whitespace-nowrap shrink-0">
        JIT Video Editor
      </h1>

      <button
        type="button"
        disabled={disabled}
        onClick={onExportClick}
        title={
          canExport
            ? 'Render and download edited video'
            : 'Add a video clip to the timeline to export'
        }
        className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          disabled
            ? 'bg-zinc-800/70 text-zinc-500 border border-zinc-700/50 cursor-not-allowed select-none'
            : 'bg-blue-600 hover:bg-blue-500 text-white border border-blue-500/60 cursor-pointer'
        }`}
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{isExporting ? 'Exporting...' : 'Export Video'}</span>
      </button>
    </header>
  );
}
