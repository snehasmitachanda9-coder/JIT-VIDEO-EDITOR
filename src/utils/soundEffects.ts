import type {BuiltInSfxKind} from '../types/editor';

export interface BuiltInSfxDefinition {
  kind: BuiltInSfxKind;
  name: string;
  description: string;
  duration: number;
}

export const BUILT_IN_SFX_LIST: BuiltInSfxDefinition[] = [
  {
    kind: 'whoosh',
    name: 'Whoosh',
    description: 'Smooth air sweep for clip transitions',
    duration: 0.75,
  },
  {
    kind: 'pop',
    name: 'Pop',
    description: 'Crisp bubble pop for stickers & text',
    duration: 0.25,
  },
  {
    kind: 'clap',
    name: 'Clap / Applause',
    description: 'Layered crowd applause & claps',
    duration: 2.2,
  },
  {
    kind: 'laugh',
    name: 'Funny Laugh',
    description: 'Playful rhythmic chuckle burst',
    duration: 1.35,
  },
];

interface GeneratedSfxAsset {
  url: string;
  size: number;
  duration: number;
}

const sfxCache = new Map<BuiltInSfxKind, GeneratedSfxAsset>();

function encodeWavFromAudioBuffer(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true
      );
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], {type: 'audio/wav'});
}

function createNoiseBuffer(
  ctx: BaseAudioContext,
  durationSec: number,
  seedOffset = 1
): AudioBuffer {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = 1337 + seedOffset * 97;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = rand();
    }
  }
  return buffer;
}

async function synthesizeSfxBuffer(kind: BuiltInSfxKind): Promise<AudioBuffer> {
  const def =
    BUILT_IN_SFX_LIST.find((s) => s.kind === kind) ?? BUILT_IN_SFX_LIST[0];
  const sampleRate = 44100;
  const duration = def.duration;
  const ctx = new OfflineAudioContext(
    2,
    Math.ceil(sampleRate * duration),
    sampleRate
  );

  if (kind === 'whoosh') {
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx, duration, 11);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.2;
    filter.frequency.setValueAtTime(180, 0);
    filter.frequency.exponentialRampToValueAtTime(2400, duration * 0.42);
    filter.frequency.exponentialRampToValueAtTime(220, duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, 0);
    gain.gain.exponentialRampToValueAtTime(0.85, duration * 0.38);
    gain.gain.exponentialRampToValueAtTime(0.001, duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(0);
    noise.stop(duration);
  } else if (kind === 'pop') {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, 0);
    osc.frequency.exponentialRampToValueAtTime(1180, 0.045);
    osc.frequency.exponentialRampToValueAtTime(190, 0.16);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, 0);
    gain.gain.linearRampToValueAtTime(0.9, 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(0);
    osc.stop(0.24);
  } else if (kind === 'clap') {
    const noiseBuffer = createNoiseBuffer(ctx, 0.12, 23);
    const totalBursts = 34;
    for (let i = 0; i < totalBursts; i++) {
      const start =
        i < 4
          ? i * 0.06
          : 0.16 + (i / totalBursts) * (duration - 0.55) + ((i % 3) - 1) * 0.02;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 950 + ((i * 217) % 1400);
      bp.Q.value = 1.4;

      const env = ctx.createGain();
      const progress = start / duration;
      const amp =
        0.32 * (progress < 0.65 ? 1 : Math.max(0.08, 1 - (progress - 0.65) * 2.5));
      env.gain.setValueAtTime(0.001, start);
      env.gain.linearRampToValueAtTime(amp, start + 0.008);
      env.gain.exponentialRampToValueAtTime(0.001, start + 0.095);

      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.sin(i * 1.9) * 0.65;

      src.connect(bp);
      bp.connect(env);
      env.connect(pan);
      pan.connect(ctx.destination);
      src.start(start);
      src.stop(Math.min(duration, start + 0.11));
    }
  } else if (kind === 'laugh') {
    const syllables = [
      {start: 0.04, dur: 0.18, pitch: 380},
      {start: 0.27, dur: 0.17, pitch: 440},
      {start: 0.49, dur: 0.16, pitch: 410},
      {start: 0.7, dur: 0.16, pitch: 360},
      {start: 0.91, dur: 0.24, pitch: 310},
    ];
    syllables.forEach((syl, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(syl.pitch, syl.start);
      osc.frequency.exponentialRampToValueAtTime(
        syl.pitch * 0.72,
        syl.start + syl.dur
      );

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 18;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 26;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.value = 1150 + idx * 40;
      formant.Q.value = 2.6;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.001, syl.start);
      env.gain.linearRampToValueAtTime(0.55, syl.start + 0.025);
      env.gain.exponentialRampToValueAtTime(0.001, syl.start + syl.dur);

      osc.connect(formant);
      formant.connect(env);
      env.connect(ctx.destination);

      lfo.start(syl.start);
      lfo.stop(syl.start + syl.dur);
      osc.start(syl.start);
      osc.stop(syl.start + syl.dur + 0.01);
    });
  }

  return ctx.startRendering();
}

const bufferCache = new Map<BuiltInSfxKind, AudioBuffer>();
let sharedPreviewCtx: AudioContext | null = null;

function getPreviewAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as {webkitAudioContext?: typeof AudioContext})
      .webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedPreviewCtx || sharedPreviewCtx.state === 'closed') {
    sharedPreviewCtx = new Ctx();
  }
  return sharedPreviewCtx;
}

export async function generateBuiltInSfxAsset(
  kind: BuiltInSfxKind
): Promise<GeneratedSfxAsset> {
  const cached = sfxCache.get(kind);
  if (cached) return cached;

  const buffer = await synthesizeSfxBuffer(kind);
  bufferCache.set(kind, buffer);
  const wavBlob = encodeWavFromAudioBuffer(buffer);
  const url = URL.createObjectURL(wavBlob);
  const asset: GeneratedSfxAsset = {
    url,
    size: wavBlob.size,
    duration: buffer.duration,
  };
  sfxCache.set(kind, asset);
  return asset;
}

export async function playSfxPreview(kind: BuiltInSfxKind): Promise<void> {
  const ctx = getPreviewAudioContext();
  if (ctx) {
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    let buffer = bufferCache.get(kind);
    if (!buffer) {
      buffer = await synthesizeSfxBuffer(kind);
      bufferCache.set(kind, buffer);
      void generateBuiltInSfxAsset(kind).catch(() => {});
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.85;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
    return;
  }

  const asset = await generateBuiltInSfxAsset(kind);
  const audio = new Audio(asset.url);
  audio.volume = 0.85;
  await audio.play().catch(() => {});
}
