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

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BACKOFF_MS = [800, 1500, 3000];

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
  const [stream, setStream] = useState<MediaStream | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Self-reference for the retry setTimeout. Populated by an effect at the
  // bottom so we don't trip the "accessed before declared" lint rule.
  const connectSessionRef = useRef<
    ((stream: MediaStream) => Promise<void>) | null
  >(null);
  const onTranscriptRef = useRef(options.onTranscript);
  useEffect(() => {
    onTranscriptRef.current = options.onTranscript;
  });

  const stopRecorder = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = 0;

    stopRecorder();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = null;
    setStream(null);

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
  }, [stopRecorder]);

  const stop = useCallback(() => {
    setStatus((s) => (s === "idle" ? s : "stopping"));
    cleanup();
    setStatus("idle");
  }, [cleanup]);

  /**
   * Open a Deepgram session using an existing MediaStream. Used both for
   * the initial connect (from start()) and for auto-reconnect attempts
   * after a transient WS close.
   */
  const connectSession = useCallback(
    async (mediaStream: MediaStream): Promise<void> => {
      // Schedule a retry if we still have a live stream and haven't exhausted
      // attempts; otherwise commit to an error state.
      const scheduleRetry = (reasonForError: string) => {
        if (!streamRef.current) return; // stop() raced — nothing to do
        const attempt = reconnectAttemptsRef.current;
        if (attempt >= MAX_RECONNECT_ATTEMPTS) {
          setError(reasonForError);
          setStatus("error");
          return;
        }
        reconnectAttemptsRef.current = attempt + 1;
        const backoff = RECONNECT_BACKOFF_MS[attempt] ?? 4000;
        setStatus("starting");
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (!streamRef.current) return;
          void connectSessionRef.current?.(streamRef.current);
        }, backoff);
      };

      // 1. Token.
      let token: string;
      try {
        const res = await fetch("/api/deepgram/token", { method: "POST" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            body.error ?? `Token endpoint returned ${res.status}.`,
          );
        }
        const data = (await res.json()) as { token: string };
        token = data.token;
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Failed to fetch token.";
        scheduleRetry(message);
        return;
      }

      // 2. WebSocket → Deepgram. Bearer via Sec-WebSocket-Protocol; the
      // raw API key is what gets sent (JWT tokens don't work in browsers).
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
        reconnectAttemptsRef.current = 0; // success → reset the backoff
        const mimeType = pickMimeType();
        const recorder = mimeType
          ? new MediaRecorder(mediaStream, { mimeType })
          : new MediaRecorder(mediaStream);
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

      // ws.onerror fires just before onclose for socket failures; do
      // nothing here and let onclose decide whether to retry. Stashing
      // the error path in one place keeps the state machine simpler.
      ws.onerror = () => {};

      ws.onclose = (event) => {
        // Recorder is tied to this WS — stop it but keep the mic stream
        // so a reconnect can immediately attach a fresh recorder.
        stopRecorder();

        const isCleanClose = event.code === 1000 || event.code === 1005;
        if (isCleanClose) {
          // Either stop() ran or the upstream closed normally.
          setStatus((s) => (s === "error" ? s : "idle"));
          return;
        }
        scheduleRetry(`Connection lost (code ${event.code}).`);
      };
    },
    [stopRecorder],
  );

  const start = useCallback(async () => {
    setError(null);
    setTranscript({ finals: [], interim: "" });
    setStatus("starting");
    reconnectAttemptsRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // 1. Mic first — iOS Safari rejects getUserMedia if not synchronous-ish
    // to a user gesture.
    let mediaStream: MediaStream;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = mediaStream;
      setStream(mediaStream);
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

    await connectSession(mediaStream);
  }, [connectSession]);

  useEffect(() => {
    connectSessionRef.current = connectSession;
  });

  useEffect(() => cleanup, [cleanup]);

  return { status, transcript, error, stream, start, stop };
}
