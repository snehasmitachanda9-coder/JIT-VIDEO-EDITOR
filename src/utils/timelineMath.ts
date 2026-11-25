import type {
  ClipTransition,
  OverlayLayerItem,
  TextOverlayItem,
  TimelineAudioClip,
  TimelineEffectItem,
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

interface NormalizedSpeedRamp {
  start: number;
  end: number;
  delta: number; // peakMultiplier - 1, in [-0.72, 1.5]
}

function normalizeSpeedRamps(
  effectItems: TimelineEffectItem[]
): NormalizedSpeedRamp[] {
  const ramps = effectItems
    .filter((ef) => ef.type === 'speed-ramp' && ef.endTime > ef.startTime + 0.05)
    .map((ef) => {
      const strength =
        Math.max(0, Math.min(1, ef.intensity)) *
        Math.max(0, Math.min(1, ef.opacity));
      const mode = ef.speedRampMode ?? 'slow-mo';
      const delta =
        mode === 'speed-up' ? 1.5 * strength : -0.72 * strength;
      return {
        start: Math.max(0, ef.startTime),
        end: Math.max(0, ef.endTime),
        delta,
      };
    })
    .filter((r) => Math.abs(r.delta) > 0.005)
    .sort((a, b) => a.start - b.start);

  // Make disjoint if any two speed-ramp blocks overlap so rate stays strictly >= 0.28
  const disjoint: NormalizedSpeedRamp[] = [];
  for (const r of ramps) {
    if (disjoint.length === 0) {
      disjoint.push(r);
      continue;
    }
    const prev = disjoint[disjoint.length - 1];
    if (r.start < prev.end) {
      const trimmedStart = prev.end;
      if (r.end > trimmedStart + 0.05) {
        disjoint.push({...r, start: trimmedStart});
      }
    } else {
      disjoint.push(r);
    }
  }
  return disjoint;
}

/**
 * Instantaneous speed-ramp multiplier (1.0 when outside speed-ramp blocks).
 */
export function getSpeedRampMultiplierAtTime(
  effectItems: TimelineEffectItem[],
  timelineTime: number
): number {
  const ramps = normalizeSpeedRamps(effectItems);
  for (const r of ramps) {
    if (timelineTime >= r.start && timelineTime <= r.end) {
      const u = (timelineTime - r.start) / (r.end - r.start);
      const s = Math.sin(Math.PI * u);
      return Math.max(0.25, 1 + r.delta * s * s);
    }
  }
  return 1;
}

/**
 * Exact closed-form integral of speed-ramp multiplier from tA to tB.
 */
function integrateSpeedRampInterval(
  ramps: NormalizedSpeedRamp[],
  tA: number,
  tB: number
): number {
  if (tB <= tA) return 0;
  let total = tB - tA;
  for (const r of ramps) {
    const a = Math.max(tA, r.start);
    const b = Math.min(tB, r.end);
    if (b <= a) continue;
    const L = r.end - r.start;
    const antideriv = (tau: number) =>
      0.5 * (tau - r.start) -
      (L / (4 * Math.PI)) * Math.sin((2 * Math.PI * (tau - r.start)) / L);
    total += r.delta * (antideriv(b) - antideriv(a));
  }
  return Math.max(0, total);
}

/**
 * Given a clip's timelineStart and required source duration (raw / playbackSpeed),
 * solve for the warped timeline duration using bisection.
 */
function solveWarpedClipDuration(
  ramps: NormalizedSpeedRamp[],
  timelineStart: number,
  baseEffectiveDuration: number
): number {
  if (ramps.length === 0) return baseEffectiveDuration;
  // Check if any ramp overlaps [timelineStart, timelineStart + baseEffectiveDuration * 4]
  const maxPossibleDur = baseEffectiveDuration / 0.25 + 0.1;
  const hasOverlap = ramps.some(
    (r) => r.end > timelineStart && r.start < timelineStart + maxPossibleDur
  );
  if (!hasOverlap) return baseEffectiveDuration;

  let lo = 0;
  let hi = maxPossibleDur;
  for (let iter = 0; iter < 26; iter++) {
    const mid = (lo + hi) * 0.5;
    const covered = integrateSpeedRampInterval(
      ramps,
      timelineStart,
      timelineStart + mid
    );
    if (covered < baseEffectiveDuration) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) * 0.5;
}

export function resolveSegmentSourceTime(
  seg: ComputedVideoSegment,
  timelineTime: number,
  playbackSpeed: number,
  effectItems: TimelineEffectItem[] = []
): number {
  if (seg.clip.kind === 'freeze') {
    return seg.clip.trimStart;
  }
  const safeSpeed = Math.max(0.5, Math.min(2, playbackSpeed));
  const clampedTime = Math.max(
    seg.timelineStart,
    Math.min(seg.timelineEnd, timelineTime)
  );
  const ramps = normalizeSpeedRamps(effectItems);
  const warpedElapsed =
    ramps.length === 0
      ? clampedTime - seg.timelineStart
      : integrateSpeedRampInterval(ramps, seg.timelineStart, clampedTime);
  return Math.min(
    seg.clip.trimEnd,
    Math.max(seg.clip.trimStart, seg.clip.trimStart + warpedElapsed * safeSpeed)
  );
}

export function computeVideoTimelineSegments(
  clips: TimelineVideoClip[],
  playbackSpeed: number,
  effectItems: TimelineEffectItem[] = []
): ComputedVideoSegment[] {
  const segments: ComputedVideoSegment[] = [];
  const ramps = normalizeSpeedRamps(effectItems);

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const baseEffective = getVideoClipEffectiveDuration(clip, playbackSpeed);

    // Tentatively place at previous clip end to resolve overlap, then finalize with speed-ramp
    let overlap = 0;
    if (i > 0 && clip.transitionIn.type !== 'none') {
      const prevSeg = segments[i - 1];
      const maxOverlap = Math.min(
        prevSeg.effectiveDuration * 0.45,
        baseEffective * 0.45
      );
      overlap = Math.max(0, Math.min(clip.transitionIn.duration, maxOverlap));
    }

    const timelineStart =
      i === 0 ? 0 : Math.max(0, segments[i - 1].timelineEnd - overlap);
    const effectiveDuration =
      clip.kind === 'freeze'
        ? baseEffective
        : solveWarpedClipDuration(ramps, timelineStart, baseEffective);
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
  playbackSpeed: number,
  effectItems: TimelineEffectItem[] = []
): number {
  const videoSegments = computeVideoTimelineSegments(
    videoClips,
    playbackSpeed,
    effectItems
  );
  const videoEnd =
    videoSegments.length > 0
      ? videoSegments[videoSegments.length - 1].timelineEnd
      : 0;

  const effectEnd = effectItems.reduce(
    (max, item) => Math.max(max, item.endTime),
    0
  );

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

  return Math.max(videoEnd, effectEnd, overlayEnd, audioEnd, textEnd);
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
