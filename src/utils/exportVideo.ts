import type {
  AspectRatioPreset,
  AudioSettings,
  BackgroundRemovalConfig,
  MotionTransform,
  OverlayLayerItem,
  TextOverlayItem,
  TimelineAudioClip,
  TimelineEffectItem,
  TimelineVideoClip,
  VideoFilters,
  VideoFitMode,
} from '../types/editor';
import {AudioEffectsGraph} from './audioEffects';
import {segmentFrameForExport} from './backgroundRemover';
import {
  ASPECT_RATIO_DIMENSIONS,
  renderEditorFrame,
  type MediaSourceElement,
} from './canvasRenderer';
import {preloadStickerImage} from './stickerRenderer';
import {
  computeTotalTimelineDuration,
  computeVideoTimelineSegments,
  getAudioClipDuration,
  getSpeedRampMultiplierAtTime,
  resolveSegmentSourceTime,
  resolveVideoStateAtTime,
} from './timelineMath';

export interface ExportVideoOptions {
  videoClips: TimelineVideoClip[];
  effectItems: TimelineEffectItem[];
  overlayLayers: OverlayLayerItem[];
  audioClips: TimelineAudioClip[];
  textOverlays: TextOverlayItem[];
  aspectRatio: AspectRatioPreset;
  fitMode: VideoFitMode;
  filters: VideoFilters;
  motionTransform: MotionTransform;
  mainBgRemoval: BackgroundRemovalConfig;
  audioSettings: AudioSettings;
  beatTimes?: number[];
  onProgress: (percent: number, phase: string) => void;
  signal: AbortSignal;
}

export interface ExportVideoResult {
  blob: Blob;
  mimeType: string;
  extension: string;
}

function chooseSupportedMimeType(): {mimeType: string; extension: string} {
  const candidates = [
    {mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', extension: 'mp4'},
    {mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4'},
    {mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm'},
    {mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm'},
    {mimeType: 'video/mp4', extension: 'mp4'},
    {mimeType: 'video/webm', extension: 'webm'},
  ];

  for (const candidate of candidates) {
    if (
      typeof MediaRecorder !== 'undefined' &&
      MediaRecorder.isTypeSupported(candidate.mimeType)
    ) {
      return candidate;
    }
  }
  return {mimeType: 'video/webm', extension: 'webm'};
}

function createHighBitrateRecorder(
  stream: MediaStream,
  mimeType: string
): MediaRecorder {
  try {
    return new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 12_000_000,
      audioBitsPerSecond: 192_000,
    });
  } catch {
    try {
      return new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 12_000_000,
      });
    } catch {
      return new MediaRecorder(stream, {mimeType});
    }
  }
}

function waitForImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for export.'));
    img.src = url;
  });
}

function waitForMediaReady(media: HTMLMediaElement): Promise<void> {
  return new Promise((resolve) => {
    if (media.readyState >= 2) {
      resolve();
      return;
    }
    const finish = () => {
      media.removeEventListener('canplay', finish);
      media.removeEventListener('loadeddata', finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, 4000);
    media.addEventListener('canplay', finish, {once: true});
    media.addEventListener('loadeddata', finish, {once: true});
  });
}

function seekMedia(media: HTMLMediaElement, targetTime: number): Promise<void> {
  return new Promise((resolve) => {
    const safeTarget = Math.max(0, targetTime);
    if (Math.abs(media.currentTime - safeTarget) < 0.03 && media.readyState >= 2) {
      resolve();
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      media.removeEventListener('seeked', finish);
      window.clearTimeout(timer);
      resolve();
    };

    const timer = window.setTimeout(finish, 1200);
    media.addEventListener('seeked', finish, {once: true});
    try {
      media.currentTime = safeTarget;
    } catch {
      finish();
    }
  });
}

export async function exportEditedVideo(
  options: ExportVideoOptions
): Promise<ExportVideoResult> {
  const {
    videoClips,
    effectItems,
    overlayLayers,
    audioClips,
    textOverlays,
    aspectRatio,
    fitMode,
    filters,
    motionTransform,
    mainBgRemoval,
    audioSettings,
    beatTimes = [],
    onProgress,
    signal,
  } = options;

  const totalDuration = computeTotalTimelineDuration(
    videoClips,
    overlayLayers,
    audioClips,
    textOverlays,
    audioSettings.playbackSpeed,
    effectItems
  );

  if (totalDuration <= 0 || (videoClips.length === 0 && overlayLayers.length === 0)) {
    throw new Error('Add at least one video clip or overlay layer before exporting.');
  }

  const segments = computeVideoTimelineSegments(
    videoClips,
    audioSettings.playbackSpeed,
    effectItems
  );
  const hasSpeedRamps = effectItems.some((e) => e.type === 'speed-ramp');
  const dims = ASPECT_RATIO_DIMENSIONS[aspectRatio];

  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d', {alpha: false});
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable.');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  onProgress(2, `Loading media assets for ${dims.width}×${dims.height} 60fps render...`);

  const audioCtx = new AudioContext();
  const destination = audioCtx.createMediaStreamDestination();
  const audioFx = new AudioEffectsGraph(audioCtx, destination);
  audioFx.updateVolumes({
    videoVolume: audioSettings.videoVolume,
    videoMuted: audioSettings.videoMuted,
    musicVolume: audioSettings.musicVolume,
    musicMuted: audioSettings.musicMuted,
  });
  audioFx.updateEffects(audioSettings.effects);

  // Primary & Outgoing video elements for seamless transitions
  const mainVideoEl = document.createElement('video');
  mainVideoEl.crossOrigin = 'anonymous';
  mainVideoEl.playsInline = true;
  mainVideoEl.preload = 'auto';
  mainVideoEl.muted = false;
  mainVideoEl.volume = 1;
  mainVideoEl.playbackRate = audioSettings.playbackSpeed;

  const mainVideoSource = audioCtx.createMediaElementSource(mainVideoEl);
  mainVideoSource.connect(audioFx.videoInputGain);

  const outgoingVideoEl = document.createElement('video');
  outgoingVideoEl.crossOrigin = 'anonymous';
  outgoingVideoEl.playsInline = true;
  outgoingVideoEl.preload = 'auto';
  outgoingVideoEl.muted = true;
  outgoingVideoEl.playbackRate = audioSettings.playbackSpeed;

  // Preload freeze frame images
  const freezeImageMap = new Map<string, HTMLImageElement>();
  for (const clip of videoClips) {
    if (clip.kind === 'freeze') {
      try {
        const img = await waitForImage(clip.url);
        freezeImageMap.set(clip.id, img);
      } catch {
        // skip
      }
    }
  }

  // Per-clip audio elements so Music + multiple SFX can play simultaneously with Fade In/Out
  const audioClipElements = new Map<
    string,
    {el: HTMLAudioElement; gainNode: GainNode}
  >();
  for (const ac of audioClips) {
    const el = document.createElement('audio');
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.muted = false;
    el.volume = 1;
    el.src = ac.url;
    await waitForMediaReady(el);
    const srcNode = audioCtx.createMediaElementSource(el);
    const clipGain = audioCtx.createGain();
    clipGain.gain.value = Math.max(0, Math.min(1.5, ac.volume ?? 1));
    srcNode.connect(clipGain);
    clipGain.connect(audioFx.musicInputGain);
    audioClipElements.set(ac.id, {el, gainNode: clipGain});
  }

  // Optional custom BG replacement asset element
  let bgReplacementEl: MediaSourceElement | null = null;
  if (
    mainBgRemoval.mode !== 'none' &&
    mainBgRemoval.replacementAssetUrl &&
    (mainBgRemoval.replacementType === 'image' ||
      mainBgRemoval.replacementType === 'video')
  ) {
    if (mainBgRemoval.replacementType === 'image') {
      bgReplacementEl = await waitForImage(mainBgRemoval.replacementAssetUrl).catch(
        () => null
      );
    } else {
      const bgVid = document.createElement('video');
      bgVid.crossOrigin = 'anonymous';
      bgVid.playsInline = true;
      bgVid.loop = true;
      bgVid.muted = true;
      bgVid.src = mainBgRemoval.replacementAssetUrl;
      await waitForMediaReady(bgVid);
      bgReplacementEl = bgVid;
    }
  }

  // Preload overlay image, sticker & video elements
  const overlayElementsMap = new Map<string, MediaSourceElement>();
  const overlayVideoElements: HTMLVideoElement[] = [];

  for (const layer of overlayLayers) {
    if (layer.kind === 'sticker' && layer.stickerKind) {
      const img = await preloadStickerImage(layer.stickerKind);
      overlayElementsMap.set(layer.id, img);
    } else if (layer.kind === 'image') {
      try {
        const img = await waitForImage(layer.url);
        overlayElementsMap.set(layer.id, img);
      } catch {
        // skip
      }
    } else {
      const vid = document.createElement('video');
      vid.crossOrigin = 'anonymous';
      vid.playsInline = true;
      vid.muted = true;
      vid.preload = 'auto';
      vid.src = layer.url;
      await waitForMediaReady(vid);
      overlayElementsMap.set(layer.id, vid);
      overlayVideoElements.push(vid);
    }
  }

  const hasAiSegmentation =
    mainBgRemoval.mode === 'ai-person' ||
    overlayLayers.some((l) => l.bgRemoval.mode === 'ai-person');

  const canvasStream = canvas.captureStream(60);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);

  const {mimeType, extension} = chooseSupportedMimeType();
  const recorder = createHighBitrateRecorder(combinedStream, mimeType);

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const cleanup = () => {
    [mainVideoEl, outgoingVideoEl, ...overlayVideoElements].forEach((v) => {
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch {
        // ignore
      }
    });
    audioClipElements.forEach(({el: a}) => {
      try {
        a.pause();
        a.removeAttribute('src');
        a.load();
      } catch {
        // ignore
      }
    });
    if (bgReplacementEl instanceof HTMLVideoElement) {
      try {
        bgReplacementEl.pause();
        bgReplacementEl.removeAttribute('src');
        bgReplacementEl.load();
      } catch {
        // ignore
      }
    }
    combinedStream.getTracks().forEach((t) => t.stop());
    void audioCtx.close().catch(() => {});
  };

  try {
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const recorderStopped = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, {type: mimeType}));
      recorder.onerror = () =>
        reject(new Error('MediaRecorder failed during export.'));
    });

    recorder.start(200);
    onProgress(5, 'Exporting 1080p HD Video... (5%)');

    const fps = hasAiSegmentation ? 24 : 60;
    const frameIntervalMs = 1000 / fps;
    let currentTimelineTime = 0;
    let frameIndex = 0;
    let activeMainClipUrl: string | null = null;
    let activeOutgoingUrl: string | null = null;
    const renderLoopStartMs = performance.now();

    if (bgReplacementEl instanceof HTMLVideoElement) {
      void bgReplacementEl.play().catch(() => {});
    }

    while (currentTimelineTime <= totalDuration) {
      if (signal.aborted) {
        throw new Error('Export cancelled.');
      }

      const frameStartMs = performance.now();
      const videoState = resolveVideoStateAtTime(segments, currentTimelineTime);
      const seg = videoState.primary;
      const outSeg = videoState.outgoing;

      const effectiveRate = Math.max(
        0.25,
        Math.min(
          3,
          audioSettings.playbackSpeed *
            getSpeedRampMultiplierAtTime(effectItems, currentTimelineTime)
        )
      );

      let primarySource: MediaSourceElement | null = null;
      if (seg) {
        if (seg.clip.kind === 'freeze') {
          primarySource = freezeImageMap.get(seg.clip.id) ?? null;
          if (!mainVideoEl.paused) mainVideoEl.pause();
        } else {
          const expectedSrcTime = resolveSegmentSourceTime(
            seg,
            currentTimelineTime,
            audioSettings.playbackSpeed,
            effectItems
          );

          if (activeMainClipUrl !== seg.clip.url) {
            activeMainClipUrl = seg.clip.url;
            mainVideoEl.src = seg.clip.url;
            await waitForMediaReady(mainVideoEl);
            mainVideoEl.playbackRate = effectiveRate;
            await seekMedia(mainVideoEl, expectedSrcTime);
            if (!hasAiSegmentation) {
              void mainVideoEl.play().catch(() => {});
            }
          } else if (hasAiSegmentation) {
            mainVideoEl.playbackRate = effectiveRate;
            await seekMedia(mainVideoEl, expectedSrcTime);
          } else {
            if (Math.abs(mainVideoEl.playbackRate - effectiveRate) > 0.02) {
              mainVideoEl.playbackRate = effectiveRate;
            }
            if (mainVideoEl.paused && !mainVideoEl.ended) {
              void mainVideoEl.play().catch(() => {});
            }
            const driftThreshold = hasSpeedRamps ? 0.12 : 0.2;
            if (Math.abs(mainVideoEl.currentTime - expectedSrcTime) > driftThreshold) {
              await seekMedia(mainVideoEl, expectedSrcTime);
            }
          }
          primarySource = mainVideoEl;
        }
      } else if (!mainVideoEl.paused) {
        mainVideoEl.pause();
      }

      let outgoingSource: MediaSourceElement | null = null;
      if (outSeg) {
        if (outSeg.clip.kind === 'freeze') {
          outgoingSource = freezeImageMap.get(outSeg.clip.id) ?? null;
          if (!outgoingVideoEl.paused) outgoingVideoEl.pause();
        } else {
          const expectedOutTime = resolveSegmentSourceTime(
            outSeg,
            currentTimelineTime,
            audioSettings.playbackSpeed,
            effectItems
          );

          if (activeOutgoingUrl !== outSeg.clip.url) {
            activeOutgoingUrl = outSeg.clip.url;
            outgoingVideoEl.src = outSeg.clip.url;
            await waitForMediaReady(outgoingVideoEl);
            outgoingVideoEl.playbackRate = effectiveRate;
            await seekMedia(outgoingVideoEl, expectedOutTime);
            if (!hasAiSegmentation) {
              void outgoingVideoEl.play().catch(() => {});
            }
          } else if (hasAiSegmentation) {
            outgoingVideoEl.playbackRate = effectiveRate;
            await seekMedia(outgoingVideoEl, expectedOutTime);
          } else {
            if (Math.abs(outgoingVideoEl.playbackRate - effectiveRate) > 0.02) {
              outgoingVideoEl.playbackRate = effectiveRate;
            }
            const driftThreshold = hasSpeedRamps ? 0.12 : 0.2;
            if (Math.abs(outgoingVideoEl.currentTime - expectedOutTime) > driftThreshold) {
              await seekMedia(outgoingVideoEl, expectedOutTime);
            }
            if (outgoingVideoEl.paused && !outgoingVideoEl.ended) {
              void outgoingVideoEl.play().catch(() => {});
            }
          }
          outgoingSource = outgoingVideoEl;
        }
      } else if (!outgoingVideoEl.paused) {
        outgoingVideoEl.pause();
      }

      // Sync overlay videos
      for (const layer of overlayLayers) {
        if (layer.kind !== 'video') continue;
        const vid = overlayElementsMap.get(layer.id);
        if (!(vid instanceof HTMLVideoElement)) continue;

        const isActive =
          currentTimelineTime >= layer.startTime &&
          currentTimelineTime <= layer.endTime;
        if (isActive) {
          const targetOverlayTime =
            layer.sourceTrimStart + (currentTimelineTime - layer.startTime);
          const safeTime =
            layer.sourceDuration > 0
              ? targetOverlayTime % layer.sourceDuration
              : targetOverlayTime;
          if (hasAiSegmentation || Math.abs(vid.currentTime - safeTime) > 0.22) {
            await seekMedia(vid, safeTime);
          }
          if (!hasAiSegmentation && vid.paused) {
            void vid.play().catch(() => {});
          }
        } else if (!vid.paused) {
          vid.pause();
        }
      }

      // Sync all active audio & SFX clips simultaneously with Fade In / Fade Out envelopes
      for (const ac of audioClips) {
        const entry = audioClipElements.get(ac.id);
        if (!entry) continue;
        const {el, gainNode} = entry;
        const dur = getAudioClipDuration(ac);
        const active =
          currentTimelineTime >= ac.startTime &&
          currentTimelineTime < ac.startTime + dur;
        if (active) {
          const elapsed = Math.max(0, currentTimelineTime - ac.startTime);
          const remaining = Math.max(0, dur - elapsed);
          const fadeIn = Math.max(0, Math.min(5, ac.fadeIn ?? 0));
          const fadeOut = Math.max(0, Math.min(5, ac.fadeOut ?? 0));
          let env = 1;
          if (fadeIn > 0 && elapsed < fadeIn) env *= elapsed / fadeIn;
          if (fadeOut > 0 && remaining < fadeOut) env *= remaining / fadeOut;
          const baseVol = Math.max(0, Math.min(1.5, ac.volume ?? 1));
          gainNode.gain.setTargetAtTime(
            baseVol * Math.max(0, Math.min(1, env)),
            audioCtx.currentTime,
            0.015
          );

          const targetAudioTime = ac.trimStart + elapsed;
          if (Math.abs(el.currentTime - targetAudioTime) > 0.22) {
            try {
              el.currentTime = targetAudioTime;
            } catch {
              // ignore
            }
          }
          if (el.paused && !el.ended) {
            void el.play().catch(() => {});
          }
        } else if (!el.paused) {
          el.pause();
        }
      }

      let mainMask: HTMLCanvasElement | null | undefined = undefined;
      if (primarySource && mainBgRemoval.mode === 'ai-person') {
        mainMask = await segmentFrameForExport('main', primarySource);
      }

      const overlayMasks = new Map<string, HTMLCanvasElement | null>();
      for (const layer of overlayLayers) {
        if (
          layer.bgRemoval.mode === 'ai-person' &&
          currentTimelineTime >= layer.startTime &&
          currentTimelineTime <= layer.endTime
        ) {
          const el = overlayElementsMap.get(layer.id);
          if (el) {
            const m = await segmentFrameForExport(`overlay-${layer.id}`, el);
            overlayMasks.set(layer.id, m);
          }
        }
      }

      const primaryClipProgress =
        seg && seg.effectiveDuration > 0
          ? (currentTimelineTime - seg.timelineStart) / seg.effectiveDuration
          : 0;
      const outgoingClipProgress =
        outSeg && outSeg.effectiveDuration > 0
          ? (currentTimelineTime - outSeg.timelineStart) / outSeg.effectiveDuration
          : 1;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      renderEditorFrame({
        ctx,
        canvasWidth: dims.width,
        canvasHeight: dims.height,
        primarySource,
        primaryClipProgress,
        outgoingSource,
        outgoingClipProgress,
        transition: videoState.transition,
        transitionProgress: videoState.transitionProgress,
        fitMode,
        filters,
        motionTransform,
        mainBgRemoval,
        mainBgReplacementEl: bgReplacementEl,
        precomputedMainMask: mainMask,
        effectItems,
        beatTimes,
        overlayLayers,
        overlayElementsMap,
        precomputedOverlayMasks: overlayMasks,
        textOverlays,
        currentTime: currentTimelineTime,
        showSelectionBox: false,
        isExport: true,
      });

      const pct = Math.min(
        98,
        Math.max(5, Math.round((currentTimelineTime / totalDuration) * 93) + 5)
      );
      onProgress(pct, `Exporting 1080p HD Video... (${pct}%)`);

      if (currentTimelineTime >= totalDuration) {
        await new Promise((r) => setTimeout(r, 50));
        break;
      }

      frameIndex += 1;
      const targetNextWallMs = renderLoopStartMs + frameIndex * frameIntervalMs;
      const waitMs = Math.max(0, targetNextWallMs - performance.now());
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
      } else {
        await new Promise((r) => setTimeout(r, 0));
      }

      const rawStepSec = (performance.now() - frameStartMs) / 1000;
      const clampedStepSec = Math.min(0.1, Math.max(frameIntervalMs / 1000, rawStepSec));
      const nextTime =
        currentTimelineTime +
        (hasAiSegmentation ? frameIntervalMs / 1000 : clampedStepSec);
      currentTimelineTime =
        currentTimelineTime < totalDuration && nextTime > totalDuration
          ? totalDuration
          : nextTime;
    }

    if (signal.aborted) {
      if (recorder.state !== 'inactive') recorder.stop();
      throw new Error('Export cancelled.');
    }

    onProgress(99, 'Finalizing 1080p HD video file...');
    mainVideoEl.pause();
    outgoingVideoEl.pause();
    audioClipElements.forEach(({el: a}) => {
      if (!a.paused) a.pause();
    });
    if (recorder.state !== 'inactive') recorder.stop();

    const blob = await recorderStopped;
    onProgress(100, '1080p HD Export complete!');
    return {blob, mimeType, extension};
  } finally {
    cleanup();
  }
}
