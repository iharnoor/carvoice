export function int16ToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(
    bytes.buffer,
    bytes.byteOffset,
    Math.floor(bytes.byteLength / 2),
  );
}

export function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Schedules base64 PCM16 chunks back-to-back on a Web Audio timeline and can
 * hard-stop everything for barge-in.
 */
export class PcmPlayer {
  private nextTime = 0;
  private live = new Set<AudioBufferSourceNode>();
  private gain: GainNode;

  constructor(
    private ctx: AudioContext,
    private rate = 24000,
  ) {
    this.gain = ctx.createGain();
    this.gain.connect(ctx.destination);
  }

  /** how many chunks have been queued since the last clear */
  private queued = 0;

  /**
   * Queues a chunk. Returns `underrun: true` when the previous chunk had already
   * finished playing before this one arrived — i.e. the listener heard a gap.
   */
  push(samples: Int16Array): { underrun: boolean } {
    if (samples.length === 0) return { underrun: false };
    const starved = this.queued > 0 && this.nextTime < this.ctx.currentTime;
    const f = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) f[i] = samples[i] / 32768;

    const buf = this.ctx.createBuffer(1, f.length, this.rate);
    buf.copyToChannel(f, 0);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);

    const now = this.ctx.currentTime;
    // 60ms jitter cushion when starting or after a gap
    if (this.nextTime < now) this.nextTime = now + 0.06;
    src.start(this.nextTime);
    this.nextTime += buf.duration;

    this.live.add(src);
    this.queued++;
    src.onended = () => this.live.delete(src);
    return { underrun: starved };
  }

  /**
   * Stop everything already scheduled — used on barge-in. Returns how much
   * generated audio was thrown away, which is how far ahead of itself the agent
   * had run.
   */
  clear(): { discardedMs: number } {
    const ahead = Math.max(0, this.nextTime - this.ctx.currentTime);
    for (const s of this.live) {
      try {
        s.onended = null;
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.live.clear();
    this.nextTime = 0;
    this.queued = 0;
    return { discardedMs: Math.round(ahead * 1000) };
  }

  get isPlaying() {
    return this.live.size > 0;
  }
}
