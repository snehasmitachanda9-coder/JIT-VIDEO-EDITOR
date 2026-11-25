import type {AudioEffectsConfig} from '../types/editor';

function createSyntheticImpulseResponse(
  ctx: AudioContext,
  durationSec = 1.9,
  decay = 2.6
): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * durationSec);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = 4242;
  const nextRand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };

  for (let ch = 0; ch < 2; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, decay);
      channelData[i] = nextRand() * env;
    }
  }
  return buffer;
}

function createWarmDistortionCurve(amount = 18): Float32Array<ArrayBuffer> {
  const n = 512;
  const buf = new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT);
  const curve = new Float32Array(buf);
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] =
      ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

interface ChannelProcessor {
  input: GainNode;
  output: GainNode;
  nrHighPass: BiquadFilterNode;
  nrLowPass: BiquadFilterNode;
  voicePresenceEq: BiquadFilterNode;
  voiceWarmthEq: BiquadFilterNode;
  // Voice Changer & Pitch Shift network
  pitchDryGain: GainNode;
  pitchWetGain: GainNode;
  pitchDelayA: DelayNode;
  pitchDelayB: DelayNode;
  pitchLfo: OscillatorNode;
  pitchLfoGainA: GainNode;
  pitchLfoGainB: GainNode;
  formantLowShelf: BiquadFilterNode;
  formantHighShelf: BiquadFilterNode;
  radioBandPass: BiquadFilterNode;
  radioDrive: WaveShaperNode;
  radioWetGain: GainNode;
  robotCombDelay: DelayNode;
  robotCombFeedback: GainNode;
  robotCombWet: GainNode;
  robotModGain: GainNode;
  robotOsc: OscillatorNode;
  robotOscDepth: GainNode;
}

function createChannelProcessor(ctx: AudioContext): ChannelProcessor {
  const input = ctx.createGain();
  const output = ctx.createGain();

  // 1. Noise Reduction Filters (highpass rumble cut + lowpass hiss cut)
  const nrHighPass = ctx.createBiquadFilter();
  nrHighPass.type = 'highpass';
  nrHighPass.frequency.value = 20;

  const nrLowPass = ctx.createBiquadFilter();
  nrLowPass.type = 'lowpass';
  nrLowPass.frequency.value = 20000;

  // 2. Voice Enhancement EQ (warmth + vocal presence)
  const voiceWarmthEq = ctx.createBiquadFilter();
  voiceWarmthEq.type = 'lowshelf';
  voiceWarmthEq.frequency.value = 190;
  voiceWarmthEq.gain.value = 0;

  const voicePresenceEq = ctx.createBiquadFilter();
  voicePresenceEq.type = 'peaking';
  voicePresenceEq.frequency.value = 2850;
  voicePresenceEq.Q.value = 1.05;
  voicePresenceEq.gain.value = 0;

  // 3. Dual-Delay Pitch Shifter + Formant Sculpting
  const pitchDryGain = ctx.createGain();
  pitchDryGain.gain.value = 1;
  const pitchWetGain = ctx.createGain();
  pitchWetGain.gain.value = 0;

  const pitchDelayA = ctx.createDelay(0.2);
  const pitchDelayB = ctx.createDelay(0.2);
  pitchDelayA.delayTime.value = 0.032;
  pitchDelayB.delayTime.value = 0.048;

  const pitchLfo = ctx.createOscillator();
  pitchLfo.type = 'sawtooth';
  pitchLfo.frequency.value = 0.01;
  const pitchLfoGainA = ctx.createGain();
  const pitchLfoGainB = ctx.createGain();
  pitchLfoGainA.gain.value = 0;
  pitchLfoGainB.gain.value = 0;
  pitchLfo.connect(pitchLfoGainA);
  pitchLfo.connect(pitchLfoGainB);
  pitchLfoGainA.connect(pitchDelayA.delayTime);
  pitchLfoGainB.connect(pitchDelayB.delayTime);
  pitchLfo.start();

  const formantLowShelf = ctx.createBiquadFilter();
  formantLowShelf.type = 'lowshelf';
  formantLowShelf.frequency.value = 220;
  formantLowShelf.gain.value = 0;

  const formantHighShelf = ctx.createBiquadFilter();
  formantHighShelf.type = 'highshelf';
  formantHighShelf.frequency.value = 2600;
  formantHighShelf.gain.value = 0;

  // 4. Radio Character Path
  const radioBandPass = ctx.createBiquadFilter();
  radioBandPass.type = 'bandpass';
  radioBandPass.frequency.value = 1350;
  radioBandPass.Q.value = 1.25;

  const radioDrive = ctx.createWaveShaper();
  radioDrive.curve = createWarmDistortionCurve(24);
  radioDrive.oversample = '2x';

  const radioWetGain = ctx.createGain();
  radioWetGain.gain.value = 0;

  // 5. Robot Vocoder/Comb Ring Path
  const robotCombDelay = ctx.createDelay(0.1);
  robotCombDelay.delayTime.value = 0.014;
  const robotCombFeedback = ctx.createGain();
  robotCombFeedback.gain.value = 0.58;
  const robotCombWet = ctx.createGain();
  robotCombWet.gain.value = 0;

  const robotModGain = ctx.createGain();
  robotModGain.gain.value = 1;
  const robotOsc = ctx.createOscillator();
  robotOsc.type = 'square';
  robotOsc.frequency.value = 62;
  const robotOscDepth = ctx.createGain();
  robotOscDepth.gain.value = 0;
  robotOsc.connect(robotOscDepth);
  robotOscDepth.connect(robotModGain.gain);
  robotOsc.start();

  // Wire chain: input -> NR -> Voice EQ -> Pitch/Formant -> Robot/Radio -> output
  input.connect(nrHighPass);
  nrHighPass.connect(nrLowPass);
  nrLowPass.connect(voiceWarmthEq);
  voiceWarmthEq.connect(voicePresenceEq);

  // Pitch split -> formantLowShelf -> formantHighShelf
  voicePresenceEq.connect(pitchDryGain);
  voicePresenceEq.connect(pitchDelayA);
  voicePresenceEq.connect(pitchDelayB);
  pitchDelayA.connect(pitchWetGain);
  pitchDelayB.connect(pitchWetGain);

  pitchDryGain.connect(formantLowShelf);
  pitchWetGain.connect(formantLowShelf);
  formantLowShelf.connect(formantHighShelf);

  // Main modulated path
  formantHighShelf.connect(robotModGain);
  robotModGain.connect(output);

  // Robot metallic comb parallel
  formantHighShelf.connect(robotCombDelay);
  robotCombDelay.connect(robotCombFeedback);
  robotCombFeedback.connect(robotCombDelay);
  robotCombDelay.connect(robotCombWet);
  robotCombWet.connect(output);

  // Radio parallel
  formantHighShelf.connect(radioBandPass);
  radioBandPass.connect(radioDrive);
  radioDrive.connect(radioWetGain);
  radioWetGain.connect(output);

  return {
    input,
    output,
    nrHighPass,
    nrLowPass,
    voicePresenceEq,
    voiceWarmthEq,
    pitchDryGain,
    pitchWetGain,
    pitchDelayA,
    pitchDelayB,
    pitchLfo,
    pitchLfoGainA,
    pitchLfoGainB,
    formantLowShelf,
    formantHighShelf,
    radioBandPass,
    radioDrive,
    radioWetGain,
    robotCombDelay,
    robotCombFeedback,
    robotCombWet,
    robotModGain,
    robotOsc,
    robotOscDepth,
  };
}

function updateChannelProcessor(
  proc: ChannelProcessor,
  ctx: AudioContext,
  enabled: boolean,
  effects: AudioEffectsConfig
) {
  const now = ctx.currentTime;

  // 1. Noise reduction
  if (enabled && effects.noiseReductionEnabled) {
    const amt = Math.max(0, Math.min(1, effects.noiseReductionAmount / 100));
    proc.nrHighPass.frequency.setTargetAtTime(75 + amt * 165, now, 0.02);
    proc.nrLowPass.frequency.setTargetAtTime(16000 - amt * 9500, now, 0.02);
  } else {
    proc.nrHighPass.frequency.setTargetAtTime(20, now, 0.02);
    proc.nrLowPass.frequency.setTargetAtTime(20000, now, 0.02);
  }

  // 2. Voice enhancement
  if (enabled && effects.voiceEnhanceEnabled) {
    const amt = Math.max(0, Math.min(1, effects.voiceEnhanceAmount / 100));
    proc.voiceWarmthEq.gain.setTargetAtTime(amt * 3.5, now, 0.02);
    proc.voicePresenceEq.gain.setTargetAtTime(amt * 9.0, now, 0.02);
  } else {
    proc.voiceWarmthEq.gain.setTargetAtTime(0, now, 0.02);
    proc.voicePresenceEq.gain.setTargetAtTime(0, now, 0.02);
  }

  // 3. Voice Changer Preset + Pitch Semitones
  let effectivePitch = enabled ? effects.pitchSemitones : 0;
  let lowShelfGain = 0;
  let highShelfGain = 0;
  let radioMix = 0;
  let robotMix = 0;
  let dryGain = 1;

  if (enabled) {
    if (effects.voicePreset === 'deep') {
      effectivePitch = effects.pitchSemitones !== 0 ? effects.pitchSemitones : -5;
      lowShelfGain = 8;
      highShelfGain = -5;
    } else if (effects.voicePreset === 'chipmunk') {
      effectivePitch = effects.pitchSemitones !== 0 ? effects.pitchSemitones : 7;
      lowShelfGain = -7;
      highShelfGain = 7;
    } else if (effects.voicePreset === 'robot') {
      robotMix = 0.72;
      dryGain = 0.65;
    } else if (effects.voicePreset === 'radio') {
      radioMix = 1.1;
      dryGain = 0.14;
    }
  }

  const clampedSemi = Math.max(-12, Math.min(12, effectivePitch));
  if (Math.abs(clampedSemi) >= 0.25) {
    const pitchRatio = Math.pow(2, clampedSemi / 12);
    const lfoFreq = Math.max(0.5, Math.min(34, Math.abs(1 - pitchRatio) * 18));
    const depth = clampedSemi > 0 ? -0.016 : 0.016;
    proc.pitchLfo.frequency.setTargetAtTime(lfoFreq, now, 0.02);
    proc.pitchLfoGainA.gain.setTargetAtTime(depth, now, 0.02);
    proc.pitchLfoGainB.gain.setTargetAtTime(depth * 0.85, now, 0.02);
    proc.pitchDryGain.gain.setTargetAtTime(dryGain * 0.22, now, 0.02);
    proc.pitchWetGain.gain.setTargetAtTime(dryGain * 0.62, now, 0.02);
  } else {
    proc.pitchLfoGainA.gain.setTargetAtTime(0, now, 0.02);
    proc.pitchLfoGainB.gain.setTargetAtTime(0, now, 0.02);
    proc.pitchDryGain.gain.setTargetAtTime(dryGain, now, 0.02);
    proc.pitchWetGain.gain.setTargetAtTime(0, now, 0.02);
  }

  proc.formantLowShelf.gain.setTargetAtTime(lowShelfGain, now, 0.02);
  proc.formantHighShelf.gain.setTargetAtTime(highShelfGain, now, 0.02);
  proc.radioWetGain.gain.setTargetAtTime(radioMix, now, 0.02);
  proc.robotCombWet.gain.setTargetAtTime(robotMix, now, 0.02);
  proc.robotOscDepth.gain.setTargetAtTime(robotMix > 0 ? 0.42 : 0, now, 0.02);
}

/**
 * Pro Studio Web Audio API graph supporting Noise Reduction, Voice Enhancement,
 * Voice Changer presets, Pitch Shifting, Echo, Reverb, and Auto Volume Normalization
 * identically in both live preview and final export.
 */
export class AudioEffectsGraph {
  readonly ctx: AudioContext;
  readonly destination: AudioNode;
  readonly videoInputGain: GainNode;
  readonly musicInputGain: GainNode;

  private readonly videoProc: ChannelProcessor;
  private readonly musicProc: ChannelProcessor;

  private readonly masterBus: GainNode;
  private readonly compressorBypassGain: GainNode;
  private readonly compressorWetGain: GainNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly compressorMakeupGain: GainNode;

  private readonly echoSendVideo: GainNode;
  private readonly echoSendMusic: GainNode;
  private readonly delayNode: DelayNode;
  private readonly delayFeedback: GainNode;
  private readonly delayTone: BiquadFilterNode;
  private readonly echoWetGain: GainNode;

  private readonly reverbSendVideo: GainNode;
  private readonly reverbSendMusic: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly reverbWetGain: GainNode;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.destination = destination;

    this.videoInputGain = ctx.createGain();
    this.musicInputGain = ctx.createGain();

    this.videoProc = createChannelProcessor(ctx);
    this.musicProc = createChannelProcessor(ctx);

    this.videoInputGain.connect(this.videoProc.input);
    this.musicInputGain.connect(this.musicProc.input);

    // Master output bus with switchable Automatic Volume Control (Compressor)
    this.masterBus = ctx.createGain();
    this.videoProc.output.connect(this.masterBus);
    this.musicProc.output.connect(this.masterBus);

    this.compressorBypassGain = ctx.createGain();
    this.compressorBypassGain.gain.value = 1;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.18;

    this.compressorMakeupGain = ctx.createGain();
    this.compressorMakeupGain.gain.value = 1.38;

    this.compressorWetGain = ctx.createGain();
    this.compressorWetGain.gain.value = 0;

    this.masterBus.connect(this.compressorBypassGain);
    this.compressorBypassGain.connect(destination);

    this.masterBus.connect(this.compressor);
    this.compressor.connect(this.compressorMakeupGain);
    this.compressorMakeupGain.connect(this.compressorWetGain);
    this.compressorWetGain.connect(destination);

    // Echo / Delay bus with feedback & high-cut dampening
    this.echoSendVideo = ctx.createGain();
    this.echoSendMusic = ctx.createGain();
    this.delayNode = ctx.createDelay(1.5);
    this.delayNode.delayTime.value = 0.28;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.35;
    this.delayTone = ctx.createBiquadFilter();
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.value = 3400;
    this.echoWetGain = ctx.createGain();
    this.echoWetGain.gain.value = 0;

    this.videoProc.output.connect(this.echoSendVideo);
    this.musicProc.output.connect(this.echoSendMusic);
    this.echoSendVideo.connect(this.delayNode);
    this.echoSendMusic.connect(this.delayNode);

    this.delayNode.connect(this.delayTone);
    this.delayTone.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayTone.connect(this.echoWetGain);
    this.echoWetGain.connect(destination);

    // Procedural Stereo Reverb Convolver bus
    this.reverbSendVideo = ctx.createGain();
    this.reverbSendMusic = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = createSyntheticImpulseResponse(ctx, 1.9, 2.5);
    this.reverbWetGain = ctx.createGain();
    this.reverbWetGain.gain.value = 0;

    this.videoProc.output.connect(this.reverbSendVideo);
    this.musicProc.output.connect(this.reverbSendMusic);
    this.reverbSendVideo.connect(this.convolver);
    this.reverbSendMusic.connect(this.convolver);
    this.convolver.connect(this.reverbWetGain);
    this.reverbWetGain.connect(destination);
  }

  updateVolumes(params: {
    videoVolume: number;
    videoMuted: boolean;
    musicVolume: number;
    musicMuted: boolean;
  }) {
    const now = this.ctx.currentTime;
    const vGain = params.videoMuted ? 0 : Math.max(0, params.videoVolume);
    const mGain = params.musicMuted ? 0 : Math.max(0, params.musicVolume);
    this.videoInputGain.gain.setTargetAtTime(vGain, now, 0.015);
    this.musicInputGain.gain.setTargetAtTime(mGain, now, 0.015);
  }

  updateEffects(effects: AudioEffectsConfig) {
    const now = this.ctx.currentTime;
    const affectVideo = effects.target === 'both' || effects.target === 'video';
    const affectMusic = effects.target === 'both' || effects.target === 'music';

    updateChannelProcessor(this.videoProc, this.ctx, affectVideo, effects);
    updateChannelProcessor(this.musicProc, this.ctx, affectMusic, effects);

    const sendVideo = affectVideo ? 1 : 0;
    const sendMusic = affectMusic ? 1 : 0;

    this.echoSendVideo.gain.setTargetAtTime(sendVideo, now, 0.015);
    this.echoSendMusic.gain.setTargetAtTime(sendMusic, now, 0.015);
    this.reverbSendVideo.gain.setTargetAtTime(sendVideo, now, 0.015);
    this.reverbSendMusic.gain.setTargetAtTime(sendMusic, now, 0.015);

    const echoNorm = effects.echoEnabled
      ? Math.max(0, Math.min(1, effects.echoAmount / 100))
      : 0;
    this.echoWetGain.gain.setTargetAtTime(echoNorm * 0.72, now, 0.02);
    this.delayFeedback.gain.setTargetAtTime(
      effects.echoEnabled ? 0.22 + echoNorm * 0.42 : 0,
      now,
      0.02
    );

    const reverbNorm = effects.reverbEnabled
      ? Math.max(0, Math.min(1, effects.reverbAmount / 100))
      : 0;
    this.reverbWetGain.gain.setTargetAtTime(reverbNorm * 0.85, now, 0.02);

    // Automatic Volume Control (Compressor / Normalizer)
    if (effects.autoVolumeEnabled) {
      this.compressorBypassGain.gain.setTargetAtTime(0, now, 0.02);
      this.compressorWetGain.gain.setTargetAtTime(1, now, 0.02);
    } else {
      this.compressorBypassGain.gain.setTargetAtTime(1, now, 0.02);
      this.compressorWetGain.gain.setTargetAtTime(0, now, 0.02);
    }
  }
}
