/**
 * End-to-end check against the live Universal-3.5 Pro Realtime endpoint, using
 * the exact query parameters the browser sends.
 *
 *   say -v Samantha -o /tmp/s1.wav --data-format=LEI16@16000 "..."
 *   npx tsx scripts/smoke-stream.mts /tmp/s1.wav
 *
 * Verifies: token mint → Begin → partial Turns with per-word finality →
 * formatted final turn. Exits non-zero if no formatted turn ever arrived.
 */
import { readFileSync } from "node:fs";
import { KEYTERMS, STREAM_PROMPT, VOICE_FOCUS } from "../lib/agent";

const RATE = 16000;

const KEY = process.env.ASSEMBLYAI_API_KEY ?? readEnvLocal("ASSEMBLYAI_API_KEY");
if (!KEY) throw new Error("ASSEMBLYAI_API_KEY not found in env or .env.local");

function readEnvLocal(name: string): string | undefined {
  try {
    const line = readFileSync(".env.local", "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

function pcmFromWav(path: string): Buffer {
  const d = readFileSync(path);
  if (d.subarray(0, 4).toString() !== "RIFF") throw new Error("not a RIFF file");
  let i = 12;
  while (i < d.length - 8) {
    const id = d.subarray(i, i + 4).toString();
    const size = d.readUInt32LE(i + 4);
    if (id === "data") return d.subarray(i + 8, i + 8 + size);
    i += 8 + size + (size & 1);
  }
  throw new Error("no data chunk");
}

const wavPaths = process.argv.slice(2);
if (wavPaths.length === 0) wavPaths.push("/tmp/s1.wav");

const tokenUrl = new URL("https://streaming.assemblyai.com/v3/token");
tokenUrl.searchParams.set("expires_in_seconds", "120");
const tokRes = await fetch(tokenUrl, { headers: { Authorization: KEY } });
if (!tokRes.ok) {
  throw new Error(`token mint failed ${tokRes.status}: ${await tokRes.text()}`);
}
const { token } = (await tokRes.json()) as { token: string };
console.log("✓ token minted");

const url = new URL("wss://streaming.assemblyai.com/v3/ws");
url.searchParams.set("token", token);
url.searchParams.set("speech_model", "universal-3-5-pro");
url.searchParams.set("sample_rate", String(RATE));
url.searchParams.set("encoding", "pcm_s16le");
url.searchParams.set("format_turns", "true");
url.searchParams.set("mode", "balanced");
url.searchParams.set("keyterms_prompt", JSON.stringify(KEYTERMS));
url.searchParams.set("prompt", STREAM_PROMPT);
url.searchParams.set("voice_focus", VOICE_FOCUS.mode);
url.searchParams.set("voice_focus_threshold", String(VOICE_FOCUS.threshold));

const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";

let began = false;
let partials = 0;
let model = "";
const finals: string[] = [];
const finalizeMs: number[] = [];
const turnOpenedAt = new Map<number, number>();
let lastVoicedAt: number | null = null;
const VOICED_RMS = 0.015;
function rmsOf(buf: Buffer): number {
  let sum = 0;
  const n = Math.floor(buf.length / 2);
  if (n === 0) return 0;
  for (let i = 0; i < n; i++) {
    const v = buf.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}
let maxImmutablePct = 0;

const done = new Promise<void>((resolve) => {
  ws.onmessage = async (ev) => {
    const msg = JSON.parse(String(ev.data));

    if (msg.type === "Begin") {
      began = true;
      model = msg.speech_model ?? "(not reported)";
      console.log(`✓ Begin · model=${model} · session=${msg.id ?? "?"}`);
      await streamAudio();
      return;
    }

    if (msg.type === "Turn") {
      const order = Number(msg.turn_order ?? 0);
      const now = performance.now();
      if (!turnOpenedAt.has(order)) turnOpenedAt.set(order, now);
      partials++;

      const words = (msg.words ?? []) as Array<{
        text: string;
        word_is_final?: boolean;
      }>;
      if (words.length) {
        const locked = words.filter((w) => w.word_is_final).length;
        maxImmutablePct = Math.max(
          maxImmutablePct,
          Math.round((locked / words.length) * 100),
        );
        // bright = locked, dim = still revisable
        const rendered = words
          .map((w) => (w.word_is_final ? w.text : `\x1b[2m${w.text}\x1b[0m`))
          .join(" ");
        process.stdout.write(`\r  ${rendered.slice(-110)}`);
      }

      if (msg.end_of_turn && msg.turn_is_formatted) {
        const t = String(msg.transcript ?? "").trim();
        if (t) {
          finals.push(t);
          if (lastVoicedAt) finalizeMs.push(Math.round(now - lastVoicedAt));
          lastVoicedAt = null;
          console.log(
            `\n  FINAL “${t}”  (${finalizeMs.at(-1) ?? "?"}ms mic-quiet → formatted turn)`,
          );
        }
      }
      return;
    }

    if (msg.type === "Termination") {
      console.log(
        `\n✓ Termination · ${msg.audio_duration_seconds}s audio processed`,
      );
      resolve();
    }
  };

  ws.onerror = () => {
    console.error("✗ socket error");
    resolve();
  };
  ws.onclose = (e) => {
    if (e.code !== 1000) console.error(`✗ closed ${e.code} ${e.reason}`);
    resolve();
  };
});

async function streamAudio() {
  const CHUNK = 800 * 2; // 50ms of 16kHz PCM16
  const silence = (secs: number) => Buffer.alloc(CHUNK * Math.round(secs * 20));
  const parts: Buffer[] = [];
  for (const p of wavPaths) parts.push(pcmFromWav(p), silence(2.5));
  const full = Buffer.concat(parts);

  console.log(`→ streaming ${(full.length / 2 / RATE).toFixed(1)}s as binary frames`);
  for (let o = 0; o < full.length; o += CHUNK) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const c = full.subarray(o, o + CHUNK);
    if (rmsOf(c) > VOICED_RMS) lastVoicedAt = performance.now();
    // raw binary frames here — NOT base64 JSON like the Voice Agent API
    ws.send(new Uint8Array(c).buffer as ArrayBuffer);
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 1500));
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "Terminate" }));
  }
}

await done;

const avg = (xs: number[]) =>
  xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;

console.log("\n─── summary ───────────────────────────────");
console.log(`Begin received       ${began ? "yes" : "NO"}`);
console.log(`model               ${model}`);
console.log(`partial Turn msgs   ${partials}`);
console.log(`formatted finals    ${finals.length}`);
console.log(`endpoint latency    avg ${avg(finalizeMs)}ms (mic quiet → formatted turn)`);
console.log(`peak committed      ${maxImmutablePct}% of in-flight words`);

const ok = began && finals.length > 0;
console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
