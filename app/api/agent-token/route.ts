import { NextResponse } from "next/server";

/**
 * Mints a short-lived Voice Agent token so the browser never sees the API key.
 * GET https://agents.assemblyai.com/v1/token?expires_in_seconds=...
 */
export async function GET() {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "ASSEMBLYAI_API_KEY is not set. Add it to .env.local." },
      { status: 500 },
    );
  }

  const url = new URL("https://agents.assemblyai.com/v1/token");
  url.searchParams.set("expires_in_seconds", "300");
  url.searchParams.set("max_session_duration_seconds", "1800");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
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
