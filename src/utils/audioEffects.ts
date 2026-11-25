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

/**
 * Shared Web Audio API Echo (Delay) & Reverb bus for both live preview and final export.
 */
export class AudioEffectsGraph {
  readonly ctx: AudioContext;
  readonly destination: AudioNode;
  readonly videoInputGain: GainNode;
  readonly musicInputGain: GainNode;

  private readonly videoDryGain: GainNode;
  private readonly musicDryGain: GainNode;

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

    this.videoDryGain = ctx.createGain();
    this.musicDryGain = ctx.createGain();
    this.videoDryGain.gain.value = 1;
    this.musicDryGain.gain.value = 1;

    this.videoInputGain.connect(this.videoDryGain);
    this.musicInputGain.connect(this.musicDryGain);
    this.videoDryGain.connect(destination);
    this.musicDryGain.connect(destination);

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

    this.videoInputGain.connect(this.echoSendVideo);
    this.musicInputGain.connect(this.echoSendMusic);
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

    this.videoInputGain.connect(this.reverbSendVideo);
    this.musicInputGain.connect(this.reverbSendMusic);
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
    const sendVideo = effects.target === 'both' || effects.target === 'video' ? 1 : 0;
    const sendMusic = effects.target === 'both' || effects.target === 'music' ? 1 : 0;

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
  }
}
