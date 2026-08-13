import { NextResponse } from "next/server";

/**
 * Mints a single-use Universal-3.5 Pro Realtime token.
 * GET https://streaming.assemblyai.com/v3/token?expires_in_seconds=...
 * Note: the streaming API takes the raw key with no "Bearer" prefix.
 */
export async function GET() {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "ASSEMBLYAI_API_KEY is not set. Add it to .env.local." },
      { status: 500 },
    );
  }

  const url = new URL("https://streaming.assemblyai.com/v3/token");
  url.searchParams.set("expires_in_seconds", "300");
  url.searchParams.set("max_session_duration_seconds", "1800");

  const res = await fetch(url, {
    headers: { Authorization: key },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json(
      { error: `AssemblyAI token request failed (${res.status})`, detail: body },
      { status: 502 },
    );
  }

  const { token } = (await res.json()) as { token: string };
  return NextResponse.json(
    { token },
    { headers: { "Cache-Control": "no-store" } },
  );
}
