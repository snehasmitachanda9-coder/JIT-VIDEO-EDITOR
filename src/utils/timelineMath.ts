import type {
  OverlayLayerItem,
  TextOverlayItem,
  TimelineAudioClip,
  TimelineVideoClip,
} from '../types/editor';

export interface ComputedVideoSegment {
  clip: TimelineVideoClip;
  timelineStart: number;
  timelineEnd: number;
  effectiveDuration: number;
}

export function getVideoClipEffectiveDuration(
  clip: TimelineVideoClip,
  playbackSpeed: number
): number {
  const raw = Math.max(0.1, clip.trimEnd - clip.trimStart);
  const safeSpeed = Math.max(0.5, Math.min(2, playbackSpeed));
  return raw / safeSpeed;
}

export function computeVideoTimelineSegments(
  clips: TimelineVideoClip[],
  playbackSpeed: number
): ComputedVideoSegment[] {
  let cursor = 0;
  return clips.map((clip) => {
    const effectiveDuration = getVideoClipEffectiveDuration(clip, playbackSpeed);
    const segment: ComputedVideoSegment = {
      clip,
      timelineStart: cursor,
      timelineEnd: cursor + effectiveDuration,
      effectiveDuration,
    };
    cursor += effectiveDuration;
    return segment;
  });
}

export function getAudioClipDuration(clip: TimelineAudioClip): number {
  return Math.max(0.1, clip.trimEnd - clip.trimStart);
}

export function computeTotalTimelineDuration(
  videoClips: TimelineVideoClip[],
  overlayLayers: OverlayLayerItem[],
  audioClips: TimelineAudioClip[],
  textOverlays: TextOverlayItem[],
  playbackSpeed: number
): number {
  const videoSegments = computeVideoTimelineSegments(videoClips, playbackSpeed);
  const videoEnd =
    videoSegments.length > 0
      ? videoSegments[videoSegments.length - 1].timelineEnd
      : 0;

  const overlayEnd = overlayLayers.reduce(
    (max, layer) => Math.max(max, layer.endTime),
    0
  );

  const audioEnd = audioClips.reduce(
    (max, clip) => Math.max(max, clip.startTime + getAudioClipDuration(clip)),
    0
  );

  const textEnd = textOverlays.reduce(
    (max, overlay) => Math.max(max, overlay.endTime),
    0
  );

  return Math.max(videoEnd, overlayEnd, audioEnd, textEnd);
}

export function findActiveVideoSegment(
  segments: ComputedVideoSegment[],
  timelineTime: number
): ComputedVideoSegment | null {
  if (segments.length === 0) return null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    if (
      timelineTime >= seg.timelineStart &&
      (isLast ? timelineTime <= seg.timelineEnd : timelineTime < seg.timelineEnd)
    ) {
      return seg;
    }
  }
  return null;
}

export function extractAudioDuration(objectUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    let settled = false;
    const finish = (dur: number) => {
      if (settled) return;
      settled = true;
      audio.removeAttribute('src');
      audio.load();
      resolve(Number.isFinite(dur) && dur > 0 ? dur : 0);
    };
    const timeoutId = window.setTimeout(() => finish(0), 4000);
    audio.onloadedmetadata = () => {
      window.clearTimeout(timeoutId);
      finish(audio.duration);
    };
    audio.onerror = () => {
      window.clearTimeout(timeoutId);
      finish(0);
    };
    audio.src = objectUrl;
  });
}
