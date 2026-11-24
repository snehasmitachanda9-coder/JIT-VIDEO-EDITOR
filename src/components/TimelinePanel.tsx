import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Film,
  Layers,
  Music,
  Scissors,
  Trash2,
  Type as TypeIcon,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  OverlayLayerItem,
  SelectedTimelineItem,
  TextOverlayItem,
  TimelineAudioClip,
  TimelineVideoClip,
} from '../types/editor';
import {formatTime} from '../utils/formatTime';
import {
  computeVideoTimelineSegments,
  getAudioClipDuration,
} from '../utils/timelineMath';

interface TimelinePanelProps {
  videoClips: TimelineVideoClip[];
  overlayLayers: OverlayLayerItem[];
  audioClips: TimelineAudioClip[];
  textOverlays: TextOverlayItem[];
  selectedItem: SelectedTimelineItem;
  currentTime: number;
  totalDuration: number;
  playbackSpeed: number;
  onSelectItem: (item: SelectedTimelineItem) => void;
  onSeek: (time: number) => void;
  onSplitSelected: () => void;
  onDeleteSelected: () => void;
  onTrimVideoClip: (id: string, trimStart: number, trimEnd: number) => void;
  onUpdateOverlay: (id: string, patch: Partial<OverlayLayerItem>) => void;
  onUpdateAudioClip: (id: string, patch: Partial<TimelineAudioClip>) => void;
  onUpdateTextOverlay: (id: string, patch: Partial<TextOverlayItem>) => void;
}

type DragOperation =
  | {kind: 'playhead'}
  | {
      kind: 'video-trim-left';
      id: string;
      initialX: number;
      origTrimStart: number;
      origTrimEnd: number;
    }
  | {
      kind: 'video-trim-right';
      id: string;
      initialX: number;
      origTrimStart: number;
      origTrimEnd: number;
      sourceDuration: number;
    }
  | {
      kind: 'overlay-move';
      id: string;
      initialX: number;
      origStartTime: number;
      origEndTime: number;
    }
  | {
      kind: 'overlay-trim-left';
      id: string;
      initialX: number;
      origStartTime: number;
      origEndTime: number;
      origSourceTrimStart: number;
      layerKind: 'image' | 'video';
    }
  | {
      kind: 'overlay-trim-right';
      id: string;
      initialX: number;
      origStartTime: number;
      origEndTime: number;
    }
  | {
      kind: 'audio-move';
      id: string;
      initialX: number;
      origStartTime: number;
    }
  | {
      kind: 'audio-trim-left';
      id: string;
      initialX: number;
      origStartTime: number;
      origTrimStart: number;
      origTrimEnd: number;
    }
  | {
      kind: 'audio-trim-right';
      id: string;
      initialX: number;
      origTrimStart: number;
      origTrimEnd: number;
      sourceDuration: number;
    }
  | {
      kind: 'text-move';
      id: string;
      initialX: number;
      origStartTime: number;
      origEndTime: number;
    }
  | {
      kind: 'text-trim-left';
      id: string;
      initialX: number;
      origStartTime: number;
      origEndTime: number;
    }
  | {
      kind: 'text-trim-right';
      id: string;
      initialX: number;
      origStartTime: number;
      origEndTime: number;
    };

export function TimelinePanel({
  videoClips,
  overlayLayers,
  audioClips,
  textOverlays,
  selectedItem,
  currentTime,
  totalDuration,
  playbackSpeed,
  onSelectItem,
  onSeek,
  onSplitSelected,
  onDeleteSelected,
  onTrimVideoClip,
  onUpdateOverlay,
  onUpdateAudioClip,
  onUpdateTextOverlay,
}: TimelinePanelProps) {
  const [pxPerSecond, setPxPerSecond] = useState(42);
  const trackContainerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragOperation | null>(null);

  const videoSegments = useMemo(
    () => computeVideoTimelineSegments(videoClips, playbackSpeed),
    [videoClips, playbackSpeed]
  );

  const displaySeconds = Math.max(20, Math.ceil(totalDuration + 6));
  const trackWidthPx = Math.max(760, displaySeconds * pxPerSecond);

  const canSplit = useMemo(() => {
    if (!selectedItem) return false;
    if (selectedItem.track === 'video') {
      const seg = videoSegments.find((s) => s.clip.id === selectedItem.id);
      if (!seg) return false;
      return (
        currentTime > seg.timelineStart + 0.15 &&
        currentTime < seg.timelineEnd - 0.15
      );
    }
    if (selectedItem.track === 'overlay') {
      const ov = overlayLayers.find((o) => o.id === selectedItem.id);
      if (!ov) return false;
      return currentTime > ov.startTime + 0.15 && currentTime < ov.endTime - 0.15;
    }
    if (selectedItem.track === 'audio') {
      const ac = audioClips.find((c) => c.id === selectedItem.id);
      if (!ac) return false;
      const end = ac.startTime + getAudioClipDuration(ac);
      return currentTime > ac.startTime + 0.15 && currentTime < end - 0.15;
    }
    if (selectedItem.track === 'text') {
      const txt = textOverlays.find((t) => t.id === selectedItem.id);
      if (!txt) return false;
      return currentTime > txt.startTime + 0.15 && currentTime < txt.endTime - 0.15;
    }
    return false;
  }, [
    selectedItem,
    videoSegments,
    overlayLayers,
    audioClips,
    textOverlays,
    currentTime,
  ]);

  const timeFromClientX = (clientX: number): number => {
    const el = trackContainerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    return Math.max(0, Math.min(displaySeconds, offsetX / pxPerSecond));
  };

  const handleRulerPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = {kind: 'playhead'};
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(timeFromClientX(e.clientX));
  };

  const handleGlobalPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const op = dragRef.current;
    if (!op) return;

    if (op.kind === 'playhead') {
      onSeek(timeFromClientX(e.clientX));
      return;
    }

    const deltaSec = (e.clientX - op.initialX) / pxPerSecond;

    if (op.kind === 'video-trim-left') {
      const sourceDelta = deltaSec * playbackSpeed;
      const nextStart = Math.max(
        0,
        Math.min(op.origTrimEnd - 0.25, op.origTrimStart + sourceDelta)
      );
      onTrimVideoClip(op.id, nextStart, op.origTrimEnd);
    } else if (op.kind === 'video-trim-right') {
      const sourceDelta = deltaSec * playbackSpeed;
      const nextEnd = Math.min(
        op.sourceDuration,
        Math.max(op.origTrimStart + 0.25, op.origTrimEnd + sourceDelta)
      );
      onTrimVideoClip(op.id, op.origTrimStart, nextEnd);
    } else if (op.kind === 'overlay-move') {
      const dur = op.origEndTime - op.origStartTime;
      const nextStart = Math.max(0, op.origStartTime + deltaSec);
      onUpdateOverlay(op.id, {
        startTime: nextStart,
        endTime: nextStart + dur,
      });
    } else if (op.kind === 'overlay-trim-left') {
      const maxShift = op.origEndTime - op.origStartTime - 0.25;
      const clampedDelta = Math.max(
        -op.origStartTime,
        Math.min(maxShift, deltaSec)
      );
      const nextStart = Math.max(0, op.origStartTime + clampedDelta);
      const actualDelta = nextStart - op.origStartTime;
      onUpdateOverlay(op.id, {
        startTime: nextStart,
        sourceTrimStart:
          op.layerKind === 'video'
            ? Math.max(0, op.origSourceTrimStart + actualDelta)
            : op.origSourceTrimStart,
      });
    } else if (op.kind === 'overlay-trim-right') {
      const nextEnd = Math.max(
        op.origStartTime + 0.25,
        op.origEndTime + deltaSec
      );
      onUpdateOverlay(op.id, {endTime: nextEnd});
    } else if (op.kind === 'audio-move') {
      const nextStartTime = Math.max(0, op.origStartTime + deltaSec);
      onUpdateAudioClip(op.id, {startTime: nextStartTime});
    } else if (op.kind === 'audio-trim-left') {
      const maxTrimShift = op.origTrimEnd - op.origTrimStart - 0.25;
      const clampedDelta = Math.max(
        -op.origTrimStart,
        Math.min(maxTrimShift, deltaSec)
      );
      const nextStartTime = Math.max(0, op.origStartTime + clampedDelta);
      const actualShift = nextStartTime - op.origStartTime;
      onUpdateAudioClip(op.id, {
        startTime: nextStartTime,
        trimStart: op.origTrimStart + actualShift,
      });
    } else if (op.kind === 'audio-trim-right') {
      const nextEnd = Math.min(
        op.sourceDuration,
        Math.max(op.origTrimStart + 0.25, op.origTrimEnd + deltaSec)
      );
      onUpdateAudioClip(op.id, {trimEnd: nextEnd});
    } else if (op.kind === 'text-move') {
      const duration = op.origEndTime - op.origStartTime;
      const nextStart = Math.max(0, op.origStartTime + deltaSec);
      onUpdateTextOverlay(op.id, {
        startTime: nextStart,
        endTime: nextStart + duration,
      });
    } else if (op.kind === 'text-trim-left') {
      const nextStart = Math.max(
        0,
        Math.min(op.origEndTime - 0.25, op.origStartTime + deltaSec)
      );
      onUpdateTextOverlay(op.id, {startTime: nextStart});
    } else if (op.kind === 'text-trim-right') {
      const nextEnd = Math.max(
        op.origStartTime + 0.25,
        op.origEndTime + deltaSec
      );
      onUpdateTextOverlay(op.id, {endTime: nextEnd});
    }
  };

  const handleGlobalPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const tickInterval = pxPerSecond >= 64 ? 1 : pxPerSecond >= 32 ? 2 : 5;
  const ticks: number[] = [];
  for (let s = 0; s <= displaySeconds; s += tickInterval) {
    ticks.push(s);
  }

  const playheadLeftPx = currentTime * pxPerSecond;

  return (
    <section
      aria-label="Multi-Track Timeline"
      className="h-44 sm:h-48 shrink-0 border-t border-zinc-800/80 bg-[#12151B] flex flex-col select-none"
    >
      {/* Compact Timeline Toolbar */}
      <div className="h-8 shrink-0 border-b border-zinc-800/80 px-3 flex items-center justify-between gap-4 bg-[#101319]">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-zinc-200 mr-1.5">
            Timeline
          </span>

          <button
            type="button"
            disabled={!canSplit}
            onClick={onSplitSelected}
            title={
              canSplit
                ? 'Split selected clip at red playhead'
                : 'Select a clip and place playhead inside it to split'
            }
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
              canSplit
                ? 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-100'
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-600 cursor-not-allowed'
            }`}
          >
            <Scissors className="w-3 h-3" aria-hidden="true" />
            <span>Split</span>
          </button>

          <button
            type="button"
            disabled={!selectedItem}
            onClick={onDeleteSelected}
            title={
              selectedItem
                ? 'Delete selected timeline item'
                : 'Select a clip or layer to delete'
            }
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
              selectedItem
                ? 'border-zinc-700 bg-zinc-800 hover:border-red-500/50 hover:text-red-300 text-zinc-200'
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-600 cursor-not-allowed'
            }`}
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" />
            <span>Delete</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono tabular-nums text-zinc-300 whitespace-nowrap">
            {formatTime(currentTime)}{' '}
            <span className="text-zinc-500">/ {formatTime(totalDuration)}</span>
          </span>

          <div className="hidden sm:flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPxPerSecond((z) => Math.max(18, z - 8))}
              aria-label="Zoom out timeline"
              className="p-0.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            >
              <ZoomOut className="w-3 h-3" aria-hidden="true" />
            </button>
            <input
              type="range"
              min={18}
              max={110}
              value={pxPerSecond}
              onChange={(e) => setPxPerSecond(Number(e.target.value))}
              aria-label="Timeline zoom"
              className="w-16 accent-blue-500 cursor-pointer"
            />
            <button
              type="button"
              onClick={() => setPxPerSecond((z) => Math.min(110, z + 8))}
              aria-label="Zoom in timeline"
              className="p-0.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            >
              <ZoomIn className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable 4-Track Area */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Sticky Left Track Labels */}
        <div className="w-24 shrink-0 border-r border-zinc-800/80 bg-[#0F1217] flex flex-col">
          <div className="h-5 border-b border-zinc-800/80 px-2.5 flex items-center text-[10px] font-mono text-zinc-500">
            Time
          </div>
          <div className="flex-1 grid grid-rows-4">
            <div className="border-b border-zinc-800/60 px-2.5 flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
              <Film className="w-3 h-3 text-blue-400 shrink-0" aria-hidden="true" />
              <span className="truncate">Video</span>
            </div>
            <div className="border-b border-zinc-800/60 px-2.5 flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
              <Layers className="w-3 h-3 text-sky-400 shrink-0" aria-hidden="true" />
              <span className="truncate">Overlay</span>
            </div>
            <div className="border-b border-zinc-800/60 px-2.5 flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
              <Music className="w-3 h-3 text-emerald-400 shrink-0" aria-hidden="true" />
              <span className="truncate">Audio</span>
            </div>
            <div className="px-2.5 flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
              <TypeIcon className="w-3 h-3 text-amber-400 shrink-0" aria-hidden="true" />
              <span className="truncate">Text</span>
            </div>
          </div>
        </div>

        {/* Horizontal Timeline Viewport */}
        <div
          className="flex-1 overflow-x-auto overflow-y-hidden bg-[#0B0D10] relative"
          onPointerMove={handleGlobalPointerMove}
          onPointerUp={handleGlobalPointerUp}
          onPointerCancel={handleGlobalPointerUp}
        >
          <div
            ref={trackContainerRef}
            className="relative h-full flex flex-col"
            style={{width: trackWidthPx}}
          >
            {/* Time Ruler */}
            <div
              onPointerDown={handleRulerPointerDown}
              className="h-5 shrink-0 border-b border-zinc-800/80 bg-[#101319] relative cursor-ew-resize"
            >
              {ticks.map((sec) => (
                <div
                  key={sec}
                  className="absolute top-0 bottom-0 border-l border-zinc-700/60 pl-1 flex items-center pointer-events-none"
                  style={{left: sec * pxPerSecond}}
                >
                  <span className="text-[9px] font-mono tabular-nums text-zinc-500">
                    {formatTime(sec)}
                  </span>
                </div>
              ))}
            </div>

            {/* 4 Tracks Grid */}
            <div
              className="flex-1 grid grid-rows-4 relative"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  onSelectItem(null);
                  onSeek(timeFromClientX(e.clientX));
                }
              }}
            >
              {/* Track 1: Main Video */}
              <div
                className="border-b border-zinc-800/60 relative flex items-center"
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) {
                    onSelectItem(null);
                    onSeek(timeFromClientX(e.clientX));
                  }
                }}
              >
                {videoSegments.length === 0 ? (
                  <span className="px-3 text-[10px] text-zinc-600 pointer-events-none">
                    Add main videos from Media Upload
                  </span>
                ) : (
                  videoSegments.map((seg) => {
                    const leftPx = seg.timelineStart * pxPerSecond;
                    const widthPx = Math.max(
                      24,
                      seg.effectiveDuration * pxPerSecond
                    );
                    const isSelected =
                      selectedItem?.track === 'video' &&
                      selectedItem.id === seg.clip.id;

                    return (
                      <div
                        key={seg.clip.id}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onSelectItem({track: 'video', id: seg.clip.id});
                        }}
                        style={{left: leftPx, width: widthPx}}
                        className={`absolute top-1 bottom-1 rounded border overflow-hidden flex items-center cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-blue-400 bg-blue-600/25 ring-1 ring-blue-500/60'
                            : 'border-blue-500/40 bg-blue-950/40 hover:border-blue-400/70'
                        }`}
                      >
                        <div
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectItem({track: 'video', id: seg.clip.id});
                            dragRef.current = {
                              kind: 'video-trim-left',
                              id: seg.clip.id,
                              initialX: e.clientX,
                              origTrimStart: seg.clip.trimStart,
                              origTrimEnd: seg.clip.trimEnd,
                            };
                            (
                              e.currentTarget.closest(
                                '.overflow-x-auto'
                              ) as HTMLElement | null
                            )?.setPointerCapture(e.pointerId);
                          }}
                          className="w-2 h-full shrink-0 bg-blue-500/40 hover:bg-blue-400 cursor-ew-resize flex items-center justify-center"
                        >
                          <div className="w-0.5 h-2.5 bg-white/80 rounded-full" />
                        </div>

                        <div className="flex-1 min-w-0 px-1.5 flex items-center justify-between gap-1.5">
                          <span className="text-[10px] font-medium text-zinc-100 truncate">
                            {seg.clip.name}
                          </span>
                          <span className="text-[9px] font-mono tabular-nums text-blue-200/80 shrink-0">
                            {formatTime(seg.effectiveDuration)}
                          </span>
                        </div>

                        <div
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectItem({track: 'video', id: seg.clip.id});
                            dragRef.current = {
                              kind: 'video-trim-right',
                              id: seg.clip.id,
                              initialX: e.clientX,
                              origTrimStart: seg.clip.trimStart,
                              origTrimEnd: seg.clip.trimEnd,
                              sourceDuration: seg.clip.sourceDuration,
                            };
                            (
                              e.currentTarget.closest(
                                '.overflow-x-auto'
                              ) as HTMLElement | null
                            )?.setPointerCapture(e.pointerId);
                          }}
                          className="w-2 h-full shrink-0 bg-blue-500/40 hover:bg-blue-400 cursor-ew-resize flex items-center justify-center"
                        >
                          <div className="w-0.5 h-2.5 bg-white/80 rounded-full" />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Track 2: Overlay / PIP */}
              <div
                className="border-b border-zinc-800/60 relative flex items-center"
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) {
                    onSelectItem(null);
                    onSeek(timeFromClientX(e.clientX));
                  }
                }}
              >
                {overlayLayers.length === 0 ? (
                  <span className="px-3 text-[10px] text-zinc-600 pointer-events-none">
                    Add images or secondary videos via &ldquo;Overlay PIP&rdquo;
                  </span>
                ) : (
                  overlayLayers.map((ov) => {
                    const dur = Math.max(0.25, ov.endTime - ov.startTime);
                    const leftPx = ov.startTime * pxPerSecond;
                    const widthPx = Math.max(24, dur * pxPerSecond);
                    const isSelected =
                      selectedItem?.track === 'overlay' &&
                      selectedItem.id === ov.id;

                    return (
                      <div
                        key={ov.id}
                        style={{left: leftPx, width: widthPx}}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onSelectItem({track: 'overlay', id: ov.id});
                          dragRef.current = {
                            kind: 'overlay-move',
                            id: ov.id,
                            initialX: e.clientX,
                            origStartTime: ov.startTime,
                            origEndTime: ov.endTime,
                          };
                          (
                            e.currentTarget.closest(
                              '.overflow-x-auto'
                            ) as HTMLElement | null
                          )?.setPointerCapture(e.pointerId);
                        }}
                        className={`absolute top-1 bottom-1 rounded border overflow-hidden flex items-center cursor-grab active:cursor-grabbing transition-colors ${
                          isSelected
                            ? 'border-sky-400 bg-sky-500/25 ring-1 ring-sky-400/60'
                            : 'border-sky-500/40 bg-sky-950/35 hover:border-sky-400/70'
                        }`}
                      >
                        <div
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectItem({track: 'overlay', id: ov.id});
                            dragRef.current = {
                              kind: 'overlay-trim-left',
                              id: ov.id,
                              initialX: e.clientX,
                              origStartTime: ov.startTime,
                              origEndTime: ov.endTime,
                              origSourceTrimStart: ov.sourceTrimStart,
                              layerKind: ov.kind,
                            };
                            (
                              e.currentTarget.closest(
                                '.overflow-x-auto'
                              ) as HTMLElement | null
                            )?.setPointerCapture(e.pointerId);
                          }}
                          className="w-2 h-full shrink-0 bg-sky-500/40 hover:bg-sky-400 cursor-ew-resize flex items-center justify-center"
                        >
                          <div className="w-0.5 h-2.5 bg-white/80 rounded-full" />
                        </div>

                        <div className="flex-1 min-w-0 px-1.5 flex items-center justify-between gap-1.5">
                          <span className="text-[10px] font-medium text-sky-100 truncate">
                            {ov.name}
                          </span>
                          <span className="text-[9px] font-mono tabular-nums text-sky-200/80 shrink-0">
                            {dur.toFixed(1)}s
                          </span>
                        </div>

                        <div
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectItem({track: 'overlay', id: ov.id});
                            dragRef.current = {
                              kind: 'overlay-trim-right',
                              id: ov.id,
                              initialX: e.clientX,
                              origStartTime: ov.startTime,
                              origEndTime: ov.endTime,
                            };
                            (
                              e.currentTarget.closest(
                                '.overflow-x-auto'
                              ) as HTMLElement | null
                            )?.setPointerCapture(e.pointerId);
                          }}
                          className="w-2 h-full shrink-0 bg-sky-500/40 hover:bg-sky-400 cursor-ew-resize flex items-center justify-center"
                        >
                          <div className="w-0.5 h-2.5 bg-white/80 rounded-full" />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Track 3: Audio */}
              <div
                className="border-b border-zinc-800/60 relative flex items-center"
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) {
                    onSelectItem(null);
                    onSeek(timeFromClientX(e.clientX));
                  }
                }}
              >
                {audioClips.length === 0 ? (
                  <span className="px-3 text-[10px] text-zinc-600 pointer-events-none">
                    Upload MP3/WAV in Audio &amp; Speed tab
                  </span>
                ) : (
                  audioClips.map((ac) => {
                    const dur = getAudioClipDuration(ac);
                    const leftPx = ac.startTime * pxPerSecond;
                    const widthPx = Math.max(24, dur * pxPerSecond);
                    const isSelected =
                      selectedItem?.track === 'audio' &&
                      selectedItem.id === ac.id;

                    return (
                      <div
                        key={ac.id}
                        style={{left: leftPx, width: widthPx}}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onSelectItem({track: 'audio', id: ac.id});
                          dragRef.current = {
                            kind: 'audio-move',
                            id: ac.id,
                            initialX: e.clientX,
                            origStartTime: ac.startTime,
                          };
                          (
                            e.currentTarget.closest(
                              '.overflow-x-auto'
                            ) as HTMLElement | null
                          )?.setPointerCapture(e.pointerId);
                        }}
                        className={`absolute top-1 bottom-1 rounded border overflow-hidden flex items-center cursor-grab active:cursor-grabbing transition-colors ${
                          isSelected
                            ? 'border-emerald-400 bg-emerald-600/25 ring-1 ring-emerald-500/60'
                            : 'border-emerald-500/40 bg-emerald-950/35 hover:border-emerald-400/70'
                        }`}
                      >
                        <div
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectItem({track: 'audio', id: ac.id});
                            dragRef.current = {
                              kind: 'audio-trim-left',
                              id: ac.id,
                              initialX: e.clientX,
                              origStartTime: ac.startTime,
                              origTrimStart: ac.trimStart,
                              origTrimEnd: ac.trimEnd,
                            };
                            (
                              e.currentTarget.closest(
                                '.overflow-x-auto'
                              ) as HTMLElement | null
                            )?.setPointerCapture(e.pointerId);
                          }}
                          className="w-2 h-full shrink-0 bg-emerald-500/40 hover:bg-emerald-400 cursor-ew-resize flex items-center justify-center"
                        >
                          <div className="w-0.5 h-2.5 bg-white/80 rounded-full" />
                        </div>

                        <div className="flex-1 min-w-0 px-1.5 flex items-center justify-between gap-1.5">
                          <span className="text-[10px] font-medium text-emerald-100 truncate">
                            {ac.name}
                          </span>
                          <span className="text-[9px] font-mono tabular-nums text-emerald-300/80 shrink-0">
                            {formatTime(dur)}
                          </span>
                        </div>

                        <div
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectItem({track: 'audio', id: ac.id});
                            dragRef.current = {
                              kind: 'audio-trim-right',
                              id: ac.id,
                              initialX: e.clientX,
                              origTrimStart: ac.trimStart,
                              origTrimEnd: ac.trimEnd,
                              sourceDuration: ac.sourceDuration,
                            };
                            (
                              e.currentTarget.closest(
                                '.overflow-x-auto'
                              ) as HTMLElement | null
                            )?.setPointerCapture(e.pointerId);
                          }}
                          className="w-2 h-full shrink-0 bg-emerald-500/40 hover:bg-emerald-400 cursor-ew-resize flex items-center justify-center"
                        >
                          <div className="w-0.5 h-2.5 bg-white/80 rounded-full" />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Track 4: Text Overlays */}
              <div
                className="relative flex items-center"
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) {
                    onSelectItem(null);
                    onSeek(timeFromClientX(e.clientX));
                  }
                }}
              >
                {textOverlays.length === 0 ? (
                  <span className="px-3 text-[10px] text-zinc-600 pointer-events-none">
                    Add text overlays or AI captions
                  </span>
                ) : (
                  textOverlays.map((txt) => {
                    const dur = Math.max(0.25, txt.endTime - txt.startTime);
                    const leftPx = txt.startTime * pxPerSecond;
                    const widthPx = Math.max(24, dur * pxPerSecond);
                    const isSelected =
                      selectedItem?.track === 'text' &&
                      selectedItem.id === txt.id;

                    return (
                      <div
                        key={txt.id}
                        style={{left: leftPx, width: widthPx}}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onSelectItem({track: 'text', id: txt.id});
                          dragRef.current = {
                            kind: 'text-move',
                            id: txt.id,
                            initialX: e.clientX,
                            origStartTime: txt.startTime,
                            origEndTime: txt.endTime,
                          };
                          (
                            e.currentTarget.closest(
                              '.overflow-x-auto'
                            ) as HTMLElement | null
                          )?.setPointerCapture(e.pointerId);
                        }}
                        className={`absolute top-1 bottom-1 rounded border overflow-hidden flex items-center cursor-grab active:cursor-grabbing transition-colors ${
                          isSelected
                            ? 'border-amber-400 bg-amber-500/25 ring-1 ring-amber-500/60'
                            : 'border-amber-500/40 bg-amber-950/35 hover:border-amber-400/70'
                        }`}
                      >
                        <div
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectItem({track: 'text', id: txt.id});
                            dragRef.current = {
                              kind: 'text-trim-left',
                              id: txt.id,
                              initialX: e.clientX,
                              origStartTime: txt.startTime,
                              origEndTime: txt.endTime,
                            };
                            (
                              e.currentTarget.closest(
                                '.overflow-x-auto'
                              ) as HTMLElement | null
                            )?.setPointerCapture(e.pointerId);
                          }}
                          className="w-2 h-full shrink-0 bg-amber-500/40 hover:bg-amber-400 cursor-ew-resize flex items-center justify-center"
                        >
                          <div className="w-0.5 h-2.5 bg-white/80 rounded-full" />
                        </div>

                        <div className="flex-1 min-w-0 px-1.5 flex items-center justify-between gap-1.5">
                          <span className="text-[10px] font-medium text-amber-100 truncate">
                            {txt.text || 'Text'}
                          </span>
                          <span className="text-[9px] font-mono tabular-nums text-amber-200/80 shrink-0">
                            {dur.toFixed(1)}s
                          </span>
                        </div>

                        <div
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectItem({track: 'text', id: txt.id});
                            dragRef.current = {
                              kind: 'text-trim-right',
                              id: txt.id,
                              initialX: e.clientX,
                              origStartTime: txt.startTime,
                              origEndTime: txt.endTime,
                            };
                            (
                              e.currentTarget.closest(
                                '.overflow-x-auto'
                              ) as HTMLElement | null
                            )?.setPointerCapture(e.pointerId);
                          }}
                          className="w-2 h-full shrink-0 bg-amber-500/40 hover:bg-amber-400 cursor-ew-resize flex items-center justify-center"
                        >
                          <div className="w-0.5 h-2.5 bg-white/80 rounded-full" />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Draggable Red Playhead Line */}
            <div
              onPointerDown={handleRulerPointerDown}
              style={{left: playheadLeftPx}}
              className="absolute top-0 bottom-0 z-20 -translate-x-1/2 w-3 flex flex-col items-center cursor-ew-resize group"
            >
              <div className="w-2.5 h-2.5 bg-red-500 rounded-b-sm shadow-md group-hover:scale-110 transition-transform" />
              <div className="w-0.5 flex-1 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
