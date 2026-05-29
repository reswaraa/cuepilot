"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TranscriptionStatus =
  | "idle"
  | "starting"
  | "listening"
  | "stopping"
  | "error";

export type Transcript = {
  finals: string[];
  interim: string;
};

type Options = {
  onTranscript?: (text: string, isFinal: boolean) => void;
};

const DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen";
const RECORDER_TIMESLICE_MS = 250;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

export function useDeepgramTranscription(options: Options = {}) {
  const [status, setStatus] = useState<TranscriptionStatus>("idle");
  const [transcript, setTranscript] = useState<Transcript>({
    finals: [],
    interim: "",
  });
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onTranscriptRef = useRef(options.onTranscript);
  onTranscriptRef.current = options.onTranscript;

  const cleanup = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = null;

    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "CloseStream" }));
        }
      } catch {
        // ignore
      }
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
    }
    wsRef.current = null;
  }, []);

  const stop = useCallback(() => {
    setStatus((s) => (s === "idle" ? s : "stopping"));
    cleanup();
    setStatus("idle");
  }, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    setTranscript({ finals: [], interim: "" });
    setStatus("starting");

    // 1. Mic first — iOS Safari rejects getUserMedia if not synchronous-ish to a user gesture.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch (e) {
      const message =
        e instanceof Error
          ? e.name === "NotAllowedError"
            ? "Microphone permission denied."
            : (e.message ?? "Could not access microphone.")
          : "Could not access microphone.";
      setError(message);
      setStatus("error");
      return;
    }

    // 2. Token.
    let token: string;
    try {
      const res = await fetch("/api/deepgram/token", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Token endpoint returned ${res.status}.`);
      }
      const data = (await res.json()) as { token: string };
      token = data.token;
    } catch (e) {
      cleanup();
      const message = e instanceof Error ? e.message : "Failed to fetch token.";
      setError(message);
      setStatus("error");
      return;
    }

    // 3. WebSocket → Deepgram, authenticated via the bearer subprotocol.
    const params = new URLSearchParams({
      model: "nova-3",
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      endpointing: "300",
      language: "en-US",
    });
    const ws = new WebSocket(`${DEEPGRAM_WS_URL}?${params.toString()}`, [
      "token",
      token,
    ]);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("listening");
      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(event.data);
        }
      };
      recorder.start(RECORDER_TIMESLICE_MS);
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let msg: unknown;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = msg as {
        type?: string;
        is_final?: boolean;
        channel?: { alternatives?: Array<{ transcript?: string }> };
      };
      if (parsed.type !== "Results") return;
      const text = parsed.channel?.alternatives?.[0]?.transcript ?? "";
      if (!text) return;
      const isFinal = !!parsed.is_final;
      if (isFinal) {
        setTranscript((prev) => ({
          finals: [...prev.finals, text],
          interim: "",
        }));
      } else {
        setTranscript((prev) => ({ ...prev, interim: text }));
      }
      onTranscriptRef.current?.(text, isFinal);
    };

    ws.onerror = () => {
      setError("Connection to Deepgram failed.");
      setStatus("error");
      cleanup();
    };

    ws.onclose = (event) => {
      // 1000 = normal closure; everything else might indicate a problem.
      if (event.code !== 1000 && event.code !== 1005) {
        setError(`Stream closed unexpectedly (code ${event.code}).`);
        setStatus("error");
      } else {
        setStatus((s) => (s === "error" ? s : "idle"));
      }
    };
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  return { status, transcript, error, start, stop };
}
