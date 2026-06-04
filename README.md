# cuepilot

A teleprompter that follows what you're actually saying.

## Why this exists

Teleprompters scroll on a timer or on simple voice activity. They don't understand the speech, so the moment you go off-script (eg, pause, skip a sentence, rephrase a line, or lose your place for two seconds), the visible text drifts away from what you're saying. Which is exactly when you'd want it close.

The first time I forgot a line in front of an audience I spent maybe ten seconds scrubbing through a Google Doc on my phone looking for where I was. Felt like a lot longer. The fix isn't a smarter scroll speed; it's the prompter understanding where in the script you actually are.

That's all this is. Paste a script, hit Start, talk. The current line stays highlighted. The next two stay visible. If you forget what comes next, you look down, and it's there.

## What it does, concretely

1. Streams your mic to Deepgram for real-time transcription.
2. Matches the last ~15 spoken words against your script using a hybrid pipeline: a cheap n-gram matcher for the verbatim-reading case, and MiniLM embeddings (in a Web Worker) for the rephrasing case.
3. Feeds the per-sentence scores into a small state machine —> Gaussian position prior, EMA smoothing, commit-on-threshold, so the highlight doesn't jitter sub-sentence or fly across the script on a noisy chunk.
4. Computes a composite confidence (margin x consistency x match-rate). When it drops below 0.4, auto-scroll pauses and the visible context widens so you can re-orient. It releases at 0.6 (hysteresis, so it doesn't flicker).
5. If the WebSocket dies, the hook auto-reconnects up to 3 times with exponential backoff (0.8s / 1.5s / 3s), reusing the same mic stream so iOS Safari doesn't re-prompt for permission mid-pitch.

The pipeline is mostly client-side. Script storage, embeddings, model weights, all IndexedDB / browser Cache Storage. The only outbound traffic during a session is the audio stream to Deepgram and (optionally) a single Plausible page-view.

## Running it locally

```bash
npm install
cp .env.example .env.local # fill in DEEPGRAM_API_KEY and ACCESS_PASSWORD
npm run dev
```

Then open `http://localhost:3000`, log in with whatever you set as `ACCESS_PASSWORD`, paste a script, hit Continue.

A few env vars are optional and silently disable their integration when blank: `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`. The Deepgram key and the access password are the only ones you actually need.

Mic capture requires HTTPS or localhost. If you're testing on a real device against a dev box, use a tunnel that gives you HTTPS (`vercel dev`, `cloudflared`, `ngrok`, etc.). Desktop Chrome will lie to you about iOS Safari behaviour, so verify on an actual iPhone before assuming anything works.
