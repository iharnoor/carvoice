/**
 * End-to-end check against the live Voice Agent API using the exact same
 * prompt / tools / voice config the browser sends.
 *
 *   say -v Samantha -o /tmp/q1.wav --data-format=LEI16@24000 "..."
 *   npx tsx scripts/smoke.ts /tmp/q1.wav
 *
 * Verifies: token mint → session.ready → transcription → tool calls execute
 * → agent speaks. Exits non-zero if the agent never replied.
 */
import { readFileSync } from "node:fs";
import {
  GREETING,
  KEYTERMS,
  SYSTEM_PROMPT,
  TOOLS,
  TURN_DETECTION,
  VOICE,
} from "../lib/agent";
import { createToolRunner, type ToolEffects } from "../lib/tools";

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

/** Pull mono PCM16 out of a RIFF file, skipping non-standard chunks. */
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
if (wavPaths.length === 0) wavPaths.push("/tmp/q1.wav");

const fired: string[] = [];
const noopEffects: ToolEffects = {
  showCar: (id) => fired.push(`ui:showCar(${id})`),
  compare: (ids) => fired.push(`ui:compare(${ids.join(",")})`),
  quote: (q) => fired.push(`ui:quote($${q.monthly}/mo)`),
  book: (b) => fired.push(`ui:book(${b.ref})`),
};

const tokenUrl = new URL("https://agents.assemblyai.com/v1/token");
tokenUrl.searchParams.set("expires_in_seconds", "120");
const tokRes = await fetch(tokenUrl, {
  headers: { Authorization: `Bearer ${KEY}` },
});
if (!tokRes.ok) {
  throw new Error(`token mint failed ${tokRes.status}: ${await tokRes.text()}`);
}
const { token } = (await tokRes.json()) as { token: string };
console.log("✓ token minted");

const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${token}`);

let agentAudioChunks = 0;
let toolCalls = 0;
let dedupedCalls = 0;
let sawReady = false;
const agentSaid: string[] = [];
const callTool = createToolRunner();

// latency stopwatches, same definitions the browser UI reports: anchor on the
// last chunk we sent that actually carried voice, because the server emits its
// lifecycle events in one overlapped burst
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
let userFinalAt: number | null = null;
let awaitingFirstAudio = false;
// Ava may still be speaking the previous reply, so only clock audio that
// arrives after a fresh reply.started
let replyStarted = false;
const sttSamples: number[] = [];
const replySamples: number[] = [];
const e2eSamples: number[] = [];
const stat = (xs: number[]) =>
  xs.length
    ? `min ${Math.min(...xs)}ms · avg ${Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)}ms · max ${Math.max(...xs)}ms`
    : "no samples";

const done = new Promise<void>((resolve) => {
  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          system_prompt: SYSTEM_PROMPT,
          greeting: GREETING,
          input: {
            format: { encoding: "audio/pcm" },
            keyterms: KEYTERMS,
            turn_detection: TURN_DETECTION,
          },
          output: { voice: VOICE, format: { encoding: "audio/pcm" }, volume: 90 },
          tools: TOOLS,
        },
      }),
    );
    console.log("→ session.update sent");
  };

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(String(ev.data));
    switch (msg.type) {
      case "session.ready":
        sawReady = true;
        console.log(`✓ session.ready (${msg.session_id})`);
        await streamAudio();
        break;

      case "transcript.user": {
        const now = performance.now();
        userFinalAt = now;
        awaitingFirstAudio = true;
        replyStarted = false;
        if (lastVoicedAt) sttSamples.push(Math.round(now - lastVoicedAt));
        console.log(`\n  USER  “${msg.text}”`);
        break;
      }

      case "reply.started":
        if (awaitingFirstAudio) replyStarted = true;
        break;

      case "transcript.agent":
        agentSaid.push(msg.text);
        console.log(`  AVA   “${msg.text}”`);
        break;

      case "reply.audio":
        agentAudioChunks++;
        if (awaitingFirstAudio && replyStarted) {
          awaitingFirstAudio = false;
          replyStarted = false;
          const now = performance.now();
          if (userFinalAt) replySamples.push(Math.round(now - userFinalAt));
          if (lastVoicedAt) e2eSamples.push(Math.round(now - lastVoicedAt));
          lastVoicedAt = null; // consumed
        }
        break;

      case "tool.call": {
        toolCalls++;
        const { result, cached } = callTool(
          msg.name,
          msg.arguments ?? {},
          noopEffects,
        );
        if (cached) dedupedCalls++;
        console.log(
          `  TOOL  ${msg.name}(${JSON.stringify(msg.arguments)})${cached ? " [deduped]" : ""} → ${JSON.stringify(result).slice(0, 120)}`,
        );
        ws.send(
          JSON.stringify({
            type: "tool.result",
            call_id: msg.call_id,
            result: JSON.stringify(result),
          }),
        );
        break;
      }

      case "session.error":
        console.error(`✗ session.error ${msg.code}: ${msg.message} ${msg.param ?? ""}`);
        break;

      case "session.ended":
        console.log(
          `\n✓ session.ended (${msg.session_duration_seconds}s billed)`,
        );
        resolve();
        break;
    }
  };

  ws.onerror = (e) => {
    console.error("✗ socket error", e);
    resolve();
  };
  ws.onclose = (e) => {
    if (e.code !== 1000) console.error(`✗ closed ${e.code} ${e.reason}`);
    resolve();
  };
});

async function streamAudio() {
  const CHUNK = 1200 * 2; // 50ms of 24kHz PCM16
  const silence = (secs: number) => Buffer.alloc(CHUNK * Math.round(secs * 20));

  // lead-in lets the greeting land; the gap after each question gives Ava room
  // to answer before the next one starts, so every turn gets its own latency sample
  const parts: Buffer[] = [silence(1.5)];
  for (const p of wavPaths) {
    parts.push(pcmFromWav(p), silence(Number(process.env.GAP ?? 13)));
  }
  const full = Buffer.concat(parts);

  console.log(`→ streaming ${(full.length / 2 / 24000).toFixed(1)}s of audio`);
  for (let o = 0; o < full.length; o += CHUNK) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const chunk = full.subarray(o, o + CHUNK);
    if (rmsOf(chunk) > VOICED_RMS) lastVoicedAt = performance.now();
    ws.send(
      JSON.stringify({
        type: "input.audio",
        audio: chunk.toString("base64"),
      }),
    );
    await new Promise((r) => setTimeout(r, 50)); // real time, not faster
  }

  // give the agent room to finish answering, then close cleanly
  await new Promise((r) => setTimeout(r, 16000));
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "session.end" }));
  }
}

await done;

console.log("\n─── summary ───────────────────────────────");
console.log(`session.ready       ${sawReady ? "yes" : "NO"}`);
console.log(`tool calls          ${toolCalls} (${dedupedCalls} deduped)`);
console.log(`ui effects fired    ${fired.length ? fired.join(", ") : "none"}`);
console.log(`agent audio chunks  ${agentAudioChunks}`);
console.log(`agent turns         ${agentSaid.length}`);
console.log("\n─── latency ───────────────────────────────");
console.log(`transcript lock     ${stat(sttSamples)}`);
console.log(`reason + speak      ${stat(replySamples)}`);
console.log(`voice → voice       ${stat(e2eSamples)}`);

const ok = sawReady && agentAudioChunks > 0 && agentSaid.length > 0;
console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
