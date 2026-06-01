"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/nextjs";

export type EmbedderStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

type EmbedderProgress = {
  status?: string;
  progress?: number;
  file?: string;
};

let workerInstance: Worker | null = null;
const pending = new Map<string, Pending>();
const progressListeners = new Set<(progress: EmbedderProgress) => void>();

function getWorker(): Worker {
  if (workerInstance) return workerInstance;

  const w = new Worker(
    new URL("../workers/embedder.worker.ts", import.meta.url),
    { type: "module" },
  );

  // Forward uncaught worker exceptions to Sentry so we can see them.
  // Errors thrown inside our own try/catch land on the .error message
  // path below.
  w.onerror = (event) => {
    Sentry.captureException(
      new Error(
        `Embedder worker uncaught: ${event.message ?? "unknown error"}`,
      ),
    );
  };

  w.onmessage = (event: MessageEvent) => {
    const data = event.data as
      | { type: "progress"; progress: EmbedderProgress }
      | { id: string; embedding?: number[]; embeddings?: number[][]; ready?: boolean; error?: string };

    if ("type" in data && data.type === "progress") {
      for (const listener of progressListeners) listener(data.progress);
      return;
    }
    if (!("id" in data)) return;
    const handler = pending.get(data.id);
    if (!handler) return;
    pending.delete(data.id);
    if (data.error) {
      const err = new Error(`Embedder: ${data.error}`);
      Sentry.captureException(err);
      handler.reject(err);
    } else {
      handler.resolve(data);
    }
  };

  workerInstance = w;
  return w;
}

function send<T>(message: Record<string, unknown>): Promise<T> {
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (v) => resolve(v as T),
      reject,
    });
    getWorker().postMessage({ id, ...message });
  });
}

export function useEmbedder() {
  const [status, setStatus] = useState<EmbedderStatus>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const handler = (p: EmbedderProgress) => {
      if (typeof p.progress === "number") {
        setProgress(p.progress);
      }
    };
    progressListeners.add(handler);
    return () => {
      progressListeners.delete(handler);
    };
  }, []);

  const preload = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStatus("loading");
    try {
      await send<{ ready: true }>({ type: "preload" });
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  const embed = useCallback(async (text: string): Promise<number[]> => {
    const res = await send<{ embedding: number[] }>({ type: "embed", text });
    return res.embedding;
  }, []);

  const embedBatch = useCallback(
    async (texts: string[]): Promise<number[][]> => {
      const res = await send<{ embeddings: number[][] }>({
        type: "embed-batch",
        texts,
      });
      return res.embeddings;
    },
    [],
  );

  return { status, progress, preload, embed, embedBatch };
}
