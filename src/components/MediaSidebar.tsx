import {useRef, useState, type DragEvent} from 'react';
import {
  Film,
  Image as ImageIcon,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type {MediaAsset} from '../types/editor';
import {formatFileSize, formatTime} from '../utils/formatTime';

interface MediaSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  assets: MediaAsset[];
  errorMessage: string | null;
  onUploadFiles: (files: FileList | File[]) => void;
  onTriggerUpload: () => void;
  onAddVideoToTimeline: (asset: MediaAsset) => void;
  onAddOverlayToTimeline: (asset: MediaAsset) => void;
  onRemoveAsset: (id: string) => void;
}

export function MediaSidebar({
  isCollapsed,
  onToggleCollapse,
  assets,
  errorMessage,
  onUploadFiles,
  onTriggerUpload,
  onAddVideoToTimeline,
  onAddOverlayToTimeline,
  onRemoveAsset,
}: MediaSidebarProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      onUploadFiles(event.dataTransfer.files);
    }
  };

  if (isCollapsed) {
    return (
      <aside
        aria-label="Media Upload (collapsed)"
        className="w-10 shrink-0 border-r border-zinc-800/80 bg-[#12151B] flex flex-col items-center py-2.5 gap-3"
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand Media Upload panel"
          aria-label="Expand Media Upload panel"
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onTriggerUpload}
          title="Upload media"
          aria-label="Upload media"
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <Upload className="w-4 h-4" aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Media Upload"
      className="w-56 lg:w-60 shrink-0 border-r border-zinc-800/80 bg-[#12151B] flex flex-col min-h-0"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="px-3 py-2.5 border-b border-zinc-800/70 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-xs font-semibold text-zinc-100 whitespace-nowrap">
            Media Upload
          </h2>
          <span className="text-[11px] text-zinc-400 font-mono tabular-nums whitespace-nowrap">
            ({assets.length})
          </span>
        </div>

        <button
          type="button"
          onClick={onToggleCollapse}
          title="Collapse Media Upload panel"
          aria-label="Collapse Media Upload panel"
          className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors shrink-0"
        >
          <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="p-3 border-b border-zinc-800/70">
        <button
          type="button"
          onClick={onTriggerUpload}
          className={`w-full rounded-lg border border-dashed px-2.5 py-3 flex flex-col items-center justify-center gap-1.5 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            isDragging
              ? 'border-blue-500 bg-blue-500/10 text-blue-200'
              : 'border-zinc-700/80 bg-[#0E1015] text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800/40'
          }`}
        >
          <div className="w-7 h-7 rounded-md bg-zinc-800/90 border border-zinc-700/70 flex items-center justify-center text-zinc-200">
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
          </div>
          <div className="space-y-0.5">
            <p className="text-[11px] font-medium text-zinc-200">
              {isDragging ? 'Drop files here' : 'Upload Videos & Images'}
            </p>
            <p className="text-[10px] text-zinc-400">
              MP4, WebM, PNG, JPG, WebP
            </p>
          </div>
        </button>

        {errorMessage && (
          <p
            role="alert"
            className="mt-2 text-[11px] text-amber-400 leading-relaxed"
          >
            {errorMessage}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {assets.length === 0 ? (
          <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-center px-2 py-4">
            <Film className="w-5 h-5 text-zinc-600 mb-2" aria-hidden="true" />
            <p className="text-[11px] font-medium text-zinc-400">
              No media imported
            </p>
            <p className="mt-1 text-[10px] text-zinc-500 leading-relaxed">
              Add videos to the main track or images/videos as Overlay PIP layers.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5" role="list" aria-label="Uploaded media">
            {assets.map((asset) => {
              const isVideo = asset.kind === 'video';
              return (
                <div
                  key={asset.id}
                  role="listitem"
                  className="group rounded-lg border border-zinc-800/90 bg-[#171B22] hover:border-zinc-700 p-2 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        isVideo
                          ? onAddVideoToTimeline(asset)
                          : onAddOverlayToTimeline(asset)
                      }
                      title={
                        isVideo
                          ? `Add ${asset.name} to Main Video track`
                          : `Add ${asset.name} to Overlay / PIP track`
                      }
                      className="relative w-14 h-10 shrink-0 rounded overflow-hidden bg-[#090B0E] border border-zinc-800/80 flex items-center justify-center"
                    >
                      {asset.thumbnailUrl ? (
                        <img
                          src={asset.thumbnailUrl}
                          alt={asset.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : isVideo ? (
                        <Film
                          className="w-3.5 h-3.5 text-zinc-600"
                          aria-hidden="true"
                        />
                      ) : (
                        <ImageIcon
                          className="w-3.5 h-3.5 text-zinc-600"
                          aria-hidden="true"
                        />
                      )}
                      <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Plus className="w-3.5 h-3.5 text-white" aria-hidden="true" />
                      </div>
                    </button>

                    <div className="min-w-0 flex-1">
                      <p
                        title={asset.name}
                        className="text-[11px] font-medium text-zinc-200 truncate"
                      >
                        {asset.name}
                      </p>
                      <p className="text-[10px] text-zinc-400 font-mono tabular-nums truncate mt-0.5">
                        {isVideo ? formatTime(asset.duration) : 'Image'} ·{' '}
                        {formatFileSize(asset.size)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onRemoveAsset(asset.id)}
                      aria-label={`Remove ${asset.name}`}
                      className="p-1 rounded text-zinc-500 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-300 hover:bg-zinc-800 transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </div>

                  {/* Quick Track Actions */}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {isVideo && (
                      <button
                        type="button"
                        onClick={() => onAddVideoToTimeline(asset)}
                        className="flex-1 py-1 px-2 rounded bg-zinc-800/80 hover:bg-blue-600/25 hover:text-blue-200 text-[10px] font-medium text-zinc-300 transition-colors inline-flex items-center justify-center gap-1"
                      >
                        <Plus className="w-2.5 h-2.5" aria-hidden="true" />
                        <span>Video</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onAddOverlayToTimeline(asset)}
                      className="flex-1 py-1 px-2 rounded bg-zinc-800/80 hover:bg-sky-500/25 hover:text-sky-200 text-[10px] font-medium text-zinc-300 transition-colors inline-flex items-center justify-center gap-1"
                    >
                      <Layers className="w-2.5 h-2.5" aria-hidden="true" />
                      <span>Overlay PIP</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
