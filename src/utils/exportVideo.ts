import type {
  AspectRatioPreset,
  AudioSettings,
  BackgroundRemovalConfig,
  MotionTransform,
  OverlayLayerItem,
  TextOverlayItem,
  TimelineAudioClip,
  TimelineVideoClip,
  VideoFilters,
  VideoFitMode,
} from '../types/editor';
import {segmentFrameForExport} from './backgroundRemover';
import {
  ASPECT_RATIO_DIMENSIONS,
  renderEditorFrame,
  type MediaSourceElement,
} from './canvasRenderer';
import {
  computeTotalTimelineDuration,
  computeVideoTimelineSegments,
  getAudioClipDuration,
  resolveVideoStateAtTime,
} from './timelineMath';

export interface ExportVideoOptions {
  videoClips: TimelineVideoClip[];
  overlayLayers: OverlayLayerItem[];
  audioClips: TimelineAudioClip[];
  textOverlays: TextOverlayItem[];
  aspectRatio: AspectRatioPreset;
  fitMode: VideoFitMode;
  filters: VideoFilters;
  motionTransform: MotionTransform;
  mainBgRemoval: BackgroundRemovalConfig;
  audioSettings: AudioSettings;
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
    {mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm'},
    {mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm'},
    {mimeType: 'video/webm', extension: 'webm'},
    {mimeType: 'video/mp4', extension: 'mp4'},
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
    overlayLayers,
    audioClips,
    textOverlays,
    aspectRatio,
    fitMode,
    filters,
    motionTransform,
    mainBgRemoval,
    audioSettings,
    onProgress,
    signal,
  } = options;

  const totalDuration = computeTotalTimelineDuration(
    videoClips,
    overlayLayers,
    audioClips,
    textOverlays,
    audioSettings.playbackSpeed
  );

  if (totalDuration <= 0 || (videoClips.length === 0 && overlayLayers.length === 0)) {
    throw new Error('Add at least one video clip or overlay layer before exporting.');
  }

  const segments = computeVideoTimelineSegments(
    videoClips,
    audioSettings.playbackSpeed
  );
  const dims = ASPECT_RATIO_DIMENSIONS[aspectRatio];

  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable.');
  }

  onProgress(2, 'Loading media assets for render...');

  const audioCtx = new AudioContext();
  const destination = audioCtx.createMediaStreamDestination();

  // Primary & Outgoing video elements for seamless transitions
  const mainVideoEl = document.createElement('video');
  mainVideoEl.crossOrigin = 'anonymous';
  mainVideoEl.playsInline = true;
  mainVideoEl.preload = 'auto';
  mainVideoEl.muted = false;
  mainVideoEl.volume = 1;
  mainVideoEl.playbackRate = audioSettings.playbackSpeed;

  const mainVideoSource = audioCtx.createMediaElementSource(mainVideoEl);
  const mainVideoGain = audioCtx.createGain();
  mainVideoGain.gain.value = audioSettings.videoMuted ? 0 : audioSettings.videoVolume;
  mainVideoSource.connect(mainVideoGain);
  mainVideoGain.connect(destination);

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

  // Background music audio element
  let musicEl: HTMLAudioElement | null = null;
  if (audioClips.length > 0) {
    musicEl = document.createElement('audio');
    musicEl.crossOrigin = 'anonymous';
    musicEl.preload = 'auto';
    musicEl.muted = false;
    musicEl.volume = 1;
    const musicSource = audioCtx.createMediaElementSource(musicEl);
    const musicGain = audioCtx.createGain();
    musicGain.gain.value = audioSettings.musicMuted ? 0 : audioSettings.musicVolume;
    musicSource.connect(musicGain);
    musicGain.connect(destination);
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

  // Preload overlay image & video elements
  const overlayElementsMap = new Map<string, MediaSourceElement>();
  const overlayVideoElements: HTMLVideoElement[] = [];

  for (const layer of overlayLayers) {
    if (layer.kind === 'image') {
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

  const canvasStream = canvas.captureStream(30);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);

  const {mimeType, extension} = chooseSupportedMimeType();
  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 5_000_000,
  });

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
    if (musicEl) {
      try {
        musicEl.pause();
        musicEl.removeAttribute('src');
        musicEl.load();
      } catch {
        // ignore
      }
    }
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

    recorder.start(250);
    onProgress(5, 'Rendering timeline...');

    const fps = hasAiSegmentation ? 20 : 30;
    const frameIntervalMs = 1000 / fps;
    let currentTimelineTime = 0;
    let activeMainClipUrl: string | null = null;
    let activeOutgoingUrl: string | null = null;
    let activeMusicClipId: string | null = null;

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

      let primarySource: MediaSourceElement | null = null;
      if (seg) {
        if (seg.clip.kind === 'freeze') {
          primarySource = freezeImageMap.get(seg.clip.id) ?? null;
          if (!mainVideoEl.paused) mainVideoEl.pause();
        } else {
          const expectedSrcTime =
            seg.clip.trimStart +
            Math.max(0, currentTimelineTime - seg.timelineStart) *
              audioSettings.playbackSpeed;

          if (activeMainClipUrl !== seg.clip.url) {
            activeMainClipUrl = seg.clip.url;
            mainVideoEl.src = seg.clip.url;
            await waitForMediaReady(mainVideoEl);
            mainVideoEl.playbackRate = audioSettings.playbackSpeed;
            await seekMedia(mainVideoEl, expectedSrcTime);
            if (!hasAiSegmentation) {
              void mainVideoEl.play().catch(() => {});
            }
          } else if (hasAiSegmentation) {
            await seekMedia(mainVideoEl, expectedSrcTime);
          } else {
            if (mainVideoEl.paused && !mainVideoEl.ended) {
              void mainVideoEl.play().catch(() => {});
            }
            if (Math.abs(mainVideoEl.currentTime - expectedSrcTime) > 0.2) {
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
          const expectedOutTime =
            outSeg.clip.trimStart +
            Math.max(0, currentTimelineTime - outSeg.timelineStart) *
              audioSettings.playbackSpeed;

          if (activeOutgoingUrl !== outSeg.clip.url) {
            activeOutgoingUrl = outSeg.clip.url;
            outgoingVideoEl.src = outSeg.clip.url;
            await waitForMediaReady(outgoingVideoEl);
            outgoingVideoEl.playbackRate = audioSettings.playbackSpeed;
            await seekMedia(outgoingVideoEl, expectedOutTime);
            if (!hasAiSegmentation) {
              void outgoingVideoEl.play().catch(() => {});
            }
          } else if (hasAiSegmentation) {
            await seekMedia(outgoingVideoEl, expectedOutTime);
          } else {
            if (Math.abs(outgoingVideoEl.currentTime - expectedOutTime) > 0.2) {
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

      // Sync background music
      if (musicEl) {
        const matchingAudio = audioClips.find((ac) => {
          const dur = getAudioClipDuration(ac);
          return (
            currentTimelineTime >= ac.startTime &&
            currentTimelineTime < ac.startTime + dur
          );
        });
        if (matchingAudio) {
          const targetAudioTime =
            matchingAudio.trimStart +
            (currentTimelineTime - matchingAudio.startTime);
          if (activeMusicClipId !== matchingAudio.id) {
            activeMusicClipId = matchingAudio.id;
            musicEl.src = matchingAudio.url;
            await waitForMediaReady(musicEl);
            await seekMedia(musicEl, targetAudioTime);
            void musicEl.play().catch(() => {});
          } else {
            if (Math.abs(musicEl.currentTime - targetAudioTime) > 0.25) {
              musicEl.currentTime = targetAudioTime;
            }
            if (musicEl.paused) {
              void musicEl.play().catch(() => {});
            }
          }
        } else if (!musicEl.paused) {
          musicEl.pause();
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
      onProgress(pct, 'Rendering effects, transitions & audio...');

      const elapsedMs = performance.now() - frameStartMs;
      const waitMs = Math.max(4, frameIntervalMs - elapsedMs);
      await new Promise((r) => setTimeout(r, waitMs));

      const actualStepSec = (performance.now() - frameStartMs) / 1000;
      currentTimelineTime += hasAiSegmentation
        ? frameIntervalMs / 1000
        : actualStepSec;
    }

    if (signal.aborted) {
      if (recorder.state !== 'inactive') recorder.stop();
      throw new Error('Export cancelled.');
    }

    onProgress(99, 'Finalizing video file...');
    mainVideoEl.pause();
    outgoingVideoEl.pause();
    if (musicEl && !musicEl.paused) musicEl.pause();
    if (recorder.state !== 'inactive') recorder.stop();

    const blob = await recorderStopped;
    onProgress(100, 'Export complete');
    return {blob, mimeType, extension};
  } finally {
    cleanup();
  }
}
