/**
 * Captures mic audio, linearly resamples it to a target rate, converts to
 * PCM16 mono, and posts fixed-size chunks to the main thread.
 *
 * Safari ignores `new AudioContext({ sampleRate })`, so the resample ratio is
 * computed from the worklet's real `sampleRate` rather than assumed to be 1.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.targetRate = opts.targetSampleRate || 24000;
    this.chunkSamples = opts.chunkSamples || 1200; // 50ms @ 24kHz
    this.ratio = sampleRate / this.targetRate;
    this.tail = new Float32Array(0);
    this.out = new Int16Array(this.chunkSamples);
    this.outIdx = 0;
    this.pos = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    const merged = new Float32Array(this.tail.length + ch.length);
    merged.set(this.tail);
    merged.set(ch, this.tail.length);

    let p = this.pos;
    while (Math.floor(p) + 1 < merged.length) {
      const i = Math.floor(p);
      const frac = p - i;
      let s = merged[i] * (1 - frac) + merged[i + 1] * frac;
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      this.out[this.outIdx++] = s < 0 ? s * 0x8000 : s * 0x7fff;

      if (this.outIdx === this.chunkSamples) {
        const copy = this.out.slice(0);
        this.port.postMessage(copy.buffer, [copy.buffer]);
        this.outIdx = 0;
      }
      p += this.ratio;
    }

    const consumed = Math.floor(p);
    this.tail = merged.slice(consumed);
    this.pos = p - consumed;
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
