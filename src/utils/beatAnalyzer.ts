import type {BeatSyncAnalysis, TimelineAudioClip} from '../types/editor';

/**
 * Decodes an audio clip in the browser and detects rhythmic amplitude peaks
 * aligned to the clip's position on the timeline.
 */
export async function analyzeAudioClipBeats(
  clip: TimelineAudioClip
): Promise<BeatSyncAnalysis> {
  const response = await fetch(clip.url);
  if (!response.ok) {
    throw new Error('Unable to read audio file for beat detection.');
  }
  const arrayBuffer = await response.arrayBuffer();
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as {webkitAudioContext: typeof AudioContext})
      .webkitAudioContext;
  const ctx = new AudioCtx();

  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const sampleRate = audioBuffer.sampleRate;
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 =
      audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;

    const startSample = Math.max(0, Math.floor(clip.trimStart * sampleRate));
    const endSample = Math.min(
      audioBuffer.length,
      Math.floor(clip.trimEnd * sampleRate)
    );
    const totalSamples = Math.max(1, endSample - startSample);

    // 25ms energy windows
    const hopSamples = Math.max(256, Math.floor(sampleRate * 0.025));
    const windowSec = hopSamples / sampleRate;
    const energies: number[] = [];

    for (let i = startSample; i < endSample; i += hopSamples) {
      const limit = Math.min(endSample, i + hopSamples);
      let sumSq = 0;
      const count = Math.max(1, limit - i);
      for (let j = i; j < limit; j++) {
        const s = ch1 ? (ch0[j] + ch1[j]) * 0.5 : ch0[j];
        sumSq += s * s;
      }
      energies.push(Math.sqrt(sumSq / count));
    }

    if (energies.length === 0 || totalSamples < hopSamples) {
      return {
        clipId: clip.id,
        clipName: clip.name,
        bpm: 120,
        beatTimes: [],
      };
    }

    // Peak onset energy above local moving average
    const beatTimes: number[] = [];
    const halfWin = 10; // ~250ms before/after
    const minBeatSpacingSec = 0.28; // max ~214 BPM
    let lastBeatOffset = -1;

    // Global floor so silent sections don't spawn false beats
    let maxEnergy = 0;
    for (let k = 0; k < energies.length; k++) {
      if (energies[k] > maxEnergy) maxEnergy = energies[k];
    }
    const noiseFloor = Math.max(0.01, maxEnergy * 0.16);

    for (let k = 1; k < energies.length - 1; k++) {
      const cur = energies[k];
      if (cur < noiseFloor) continue;
      if (cur < energies[k - 1] || cur < energies[k + 1]) continue;

      const lo = Math.max(0, k - halfWin);
      const hi = Math.min(energies.length - 1, k + halfWin);
      let avg = 0;
      for (let m = lo; m <= hi; m++) avg += energies[m];
      avg /= hi - lo + 1;

      if (cur > avg * 1.28) {
        const offsetSec = k * windowSec;
        if (lastBeatOffset < 0 || offsetSec - lastBeatOffset >= minBeatSpacingSec) {
          lastBeatOffset = offsetSec;
          beatTimes.push(Number((clip.startTime + offsetSec).toFixed(3)));
        }
      }
    }

    // Estimate BPM from median inter-beat interval
    let bpm = 120;
    if (beatTimes.length >= 3) {
      const intervals: number[] = [];
      for (let i = 1; i < beatTimes.length; i++) {
        const dt = beatTimes[i] - beatTimes[i - 1];
        if (dt >= 0.28 && dt <= 1.2) {
          intervals.push(dt);
        }
      }
      if (intervals.length > 0) {
        intervals.sort((a, b) => a - b);
        const medianDt = intervals[Math.floor(intervals.length / 2)];
        const rawBpm = 60 / medianDt;
        // Fold into realistic 70..170 BPM range
        let normalized = rawBpm;
        while (normalized < 70) normalized *= 2;
        while (normalized > 170) normalized /= 2;
        bpm = Math.round(normalized);
      }
    }

    return {
      clipId: clip.id,
      clipName: clip.name,
      bpm,
      beatTimes: beatTimes.slice(0, 240),
    };
  } finally {
    void ctx.close().catch(() => {});
  }
}
