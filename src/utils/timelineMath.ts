import type {
  ClipTransition,
  OverlayLayerItem,
  TextOverlayItem,
  TimelineAudioClip,
  TimelineVideoClip,
} from '../types/editor';

export interface ComputedVideoSegment {
  clip: TimelineVideoClip;
  index: number;
  timelineStart: number;
  timelineEnd: number;
  effectiveDuration: number;
  effectiveTransitionIn: number; // Actual clamped overlap duration with previous clip
}

export interface ActiveVideoRenderState {
  primary: ComputedVideoSegment | null;
  outgoing: ComputedVideoSegment | null;
  transition: ClipTransition | null;
  transitionProgress: number; // 0..1 when transitioning
}

export function getVideoClipEffectiveDuration(
  clip: TimelineVideoClip,
  playbackSpeed: number
): number {
  const raw = Math.max(0.1, clip.trimEnd - clip.trimStart);
  if (clip.kind === 'freeze') {
    return raw;
  }
  const safeSpeed = Math.max(0.5, Math.min(2, playbackSpeed));
  return raw / safeSpeed;
}

export function computeVideoTimelineSegments(
  clips: TimelineVideoClip[],
  playbackSpeed: number
): ComputedVideoSegment[] {
  const segments: ComputedVideoSegment[] = [];

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const effectiveDuration = getVideoClipEffectiveDuration(clip, playbackSpeed);

    let overlap = 0;
    if (i > 0 && clip.transitionIn.type !== 'none') {
      const prevSeg = segments[i - 1];
      const maxOverlap = Math.min(
        prevSeg.effectiveDuration * 0.45,
        effectiveDuration * 0.45
      );
      overlap = Math.max(0, Math.min(clip.transitionIn.duration, maxOverlap));
    }

    const timelineStart =
      i === 0 ? 0 : Math.max(0, segments[i - 1].timelineEnd - overlap);
    const timelineEnd = timelineStart + effectiveDuration;

    segments.push({
      clip,
      index: i,
      timelineStart,
      timelineEnd,
      effectiveDuration,
      effectiveTransitionIn: overlap,
    });
  }

  return segments;
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

export function resolveVideoStateAtTime(
  segments: ComputedVideoSegment[],
  timelineTime: number
): ActiveVideoRenderState {
  if (segments.length === 0) {
    return {
      primary: null,
      outgoing: null,
      transition: null,
      transitionProgress: 0,
    };
  }

  // Check if timelineTime falls inside an overlap transition zone between segments[i-1] and segments[i]
  for (let i = 1; i < segments.length; i++) {
    const incoming = segments[i];
    const outgoing = segments[i - 1];
    if (
      incoming.effectiveTransitionIn > 0.01 &&
      timelineTime >= incoming.timelineStart &&
      timelineTime < outgoing.timelineEnd
    ) {
      const progress = Math.min(
        1,
        Math.max(
          0,
          (timelineTime - incoming.timelineStart) /
            incoming.effectiveTransitionIn
        )
      );
      return {
        primary: incoming,
        outgoing,
        transition: {
          type: incoming.clip.transitionIn.type,
          duration: incoming.effectiveTransitionIn,
        },
        transitionProgress: progress,
      };
    }
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    if (
      timelineTime >= seg.timelineStart &&
      (isLast ? timelineTime <= seg.timelineEnd : timelineTime < seg.timelineEnd)
    ) {
      return {
        primary: seg,
        outgoing: null,
        transition: null,
        transitionProgress: 0,
      };
    }
  }

  return {
    primary: null,
    outgoing: null,
    transition: null,
    transitionProgress: 0,
  };
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
