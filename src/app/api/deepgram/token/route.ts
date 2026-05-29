import { NextResponse } from "next/server";

const TOKEN_TTL_SECONDS = 60;

export async function POST() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Deepgram is not configured on the server." },
      { status: 503 },
    );
  }

  let response: Response;
  try {
    response = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach Deepgram." },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return NextResponse.json(
      {
        error: "Deepgram rejected the token request.",
        upstreamStatus: response.status,
        upstreamMessage: text.slice(0, 300),
      },
      { status: 502 },
    );
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    return NextResponse.json(
      { error: "Deepgram response was missing a token." },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      token: data.access_token,
      expiresIn: data.expires_in ?? TOKEN_TTL_SECONDS,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
