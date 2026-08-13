# Carvoice

A three-car dealership storefront you operate by voice. Built to demo two
AssemblyAI APIs side by side:

- **Voice Agent API** — `wss://agents.assemblyai.com/v1/ws`. One socket carries
  your microphone up and the agent's voice back. Speech recognition, turn
  detection, reasoning, tool calling, barge-in, and speech generation all live
  behind that single connection.
- **Universal-3.5 Pro Realtime** — `wss://streaming.assemblyai.com/v3/ws`.
  Transcription only, showing provisional words firming into immutable ones.

The agent (Ava) answers questions about the inventory and calls four functions
that visibly change the page: `show_car`, `compare_cars`, `estimate_payment`,
`book_test_drive`.

## Running it

```bash
npm install
```

Put your key in `.env.local` (already gitignored):

```bash
ASSEMBLYAI_API_KEY=your_key_here
```

```bash
npm run dev
```

Open the app, pick an API in the left rail, and start a session. **Use
headphones** — without them the agent hears itself through your speakers and
barge-in fires in a loop.

`?seed=1` fills the payment, comparison, and booking cards without a call,
which is handy for screenshots and layout work.

## What it measures

Both modes put a live metrics strip above the storefront. Everything in it is
measured in the browser during the session — nothing is quoted from a datasheet.

**Voice Agent mode**

| Metric | Definition |
| --- | --- |
| Voice → voice | Mic went quiet → first byte of agent audio. The only latency a caller feels. |
| p50 / p95 | Distribution of voice-to-voice across every turn in the call |
| Cost so far | Session seconds billed at the flat $4.50/hr covering STT + LLM + TTS |
| Endpoint + STT | Mic quiet → final transcript, including the silence the server waits out |
| Reason + TTS | Final transcript → first audio byte |
| Connect | Button click → `session.ready`, including minting the token |
| Tool | Your own function execution time |
| Barge-in drop | Generated speech discarded when you last interrupted |
| Gaps | Times the playback queue ran dry mid-reply, i.e. an audible hole |

**Universal-3.5 Pro mode**

| Metric | Definition |
| --- | --- |
| First partial | Speech onset → first partial transcript |
| p50 / p95 finalize | First partial → formatted, punctuated final turn |
| Committed | Share of in-flight words already marked immutable |
| Word conf | Mean per-word confidence for words in flight |
| End-of-turn conf | Model's confidence your turn actually ended |
| Words / speech rate | Finalized word count and words per minute |
| Uplink | Raw PCM16 upstream bitrate (16kHz mono ≈ 256 kbps) |

Two of these deserve a note. **Reason + TTS** reads near zero, and that is not a
bug: the server generates the reply while it is still finalizing the transcript,
so the pipeline overlaps rather than running three round trips in series.
**Gaps** should stay at zero — if it climbs, the playback jitter cushion is too
thin for your network.

## End-to-end check

Verifies token minting, session setup, transcription, tool calls, and spoken
replies against the live API — no microphone needed. It synthesizes the customer
side with macOS `say`, so it only runs on a Mac.

```bash
say -v Samantha -o /tmp/q1.wav --data-format=LEI16@24000 "Hi, I'm looking for a truck. Show me the Rivian."
say -v Samantha -o /tmp/q2.wav --data-format=LEI16@24000 "What would my monthly payment be with five thousand down over sixty months on good credit?"
npx tsx scripts/smoke.mts /tmp/q1.wav /tmp/q2.wav
```

It prints the transcript, every tool call with its arguments, and latency
percentiles, then exits non-zero if the agent never replied. `GAP=13` controls
the silence inserted between questions.

## How it fits together

| Path | Job |
| --- | --- |
| `app/api/agent-token/route.ts` | Mints a 5-minute Voice Agent token so the key never reaches the browser |
| `app/api/stream-token/route.ts` | Same, for the streaming transcription endpoint |
| `lib/agent.ts` | System prompt, tool schemas, voice, turn-detection config |
| `lib/tools.ts` | The four functions, plus a dedupe guard for repeated identical calls |
| `lib/useVoiceAgent.ts` | Voice Agent socket, mic capture, playback, barge-in, latency metrics |
| `lib/useStreaming.ts` | Transcription socket and per-word confidence metrics |
| `public/pcm-worklet.js` | Audio-thread worklet: float → PCM16, resampled to the target rate |
| `components/` | Storefront, voice rail, metrics strip |

## Notes worth knowing

- The two endpoints want audio in **different shapes**: the Voice Agent API
  takes base64 PCM16 inside JSON messages at 24kHz, the streaming endpoint takes
  raw binary frames at 16kHz.
- Safari ignores `new AudioContext({ sampleRate })`, so the worklet computes its
  resample ratio from the rate it actually got.
- `session.end` is sent and acknowledged before the socket closes. Closing
  without it can leave the session billing.
- Latency is measured against a **local VAD** on the mic, not server events —
  the server emits `speech.stopped`, `transcript.user`, and `reply.audio` in one
  burst because the pipeline is overlapped, so those timestamps can't anchor a
  measurement.

Inventory, financing, and bookings are fictional.
