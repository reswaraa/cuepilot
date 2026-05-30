import { NextResponse } from 'next/server';

export async function POST() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Deepgram is not configured on the server.' },
      { status: 503 },
    );
  }

  // Deepgram's JWT tokens (/v1/auth/grant) only work via the Authorization header,
  // which browsers cannot set on WebSocket connections. The Sec-WebSocket-Protocol
  // subprotocol hack (the only browser-available auth path) only accepts raw API keys.
  // For a production multi-tenant app, replace this with a server-side audio proxy.
  return NextResponse.json(
    { token: apiKey },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
