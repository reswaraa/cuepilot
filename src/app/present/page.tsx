"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadScript, type StoredScript } from "@/lib/script-storage";
import { useDeepgramTranscription } from "@/lib/use-deepgram-transcription";
import { useEmbedder } from "@/lib/use-embedder";
import {
  matchTranscriptToSentences,
  takeTranscriptTail,
} from "@/lib/fuzzy-matcher";
import {
  buildSemanticIndex,
  semanticMatch,
  type SemanticIndex,
} from "@/lib/semantic-matcher";
import {
  getCachedWindowEmbeddings,
  hashScript,
  setCachedWindowEmbeddings,
} from "@/lib/embedding-cache";
import { usePositionTracker } from "@/lib/position-tracker";

const TRANSCRIPT_TAIL_WORDS = 15;
const FUZZY_TRUST_THRESHOLD = 0.2;

type MatchPath = "fuzzy" | "semantic";

export default function Present() {
  const router = useRouter();
  const [script, setScript] = useState<StoredScript | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [matchPath, setMatchPath] = useState<MatchPath | null>(null);
  const [semanticIndex, setSemanticIndex] = useState<SemanticIndex | null>(
    null,
  );
  const [indexing, setIndexing] = useState(false);

  const { status, transcript, error, start, stop } = useDeepgramTranscription();
  const {
    status: embedderStatus,
    progress: embedderProgress,
    preload: embedderPreload,
    embed: embedderEmbed,
    embedBatch: embedderEmbedBatch,
  } = useEmbedder();
  const {
    position: trackerPosition,
    confidence: trackerConfidence,
    isLocked: trackerLocked,
    observe: trackerObserve,
    reset: trackerReset,
  } = usePositionTracker();

  const currentRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    const stored = loadScript();
    if (!stored) {
      router.replace("/");
      return;
    }
    setScript(stored);
    setHydrated(true);
  }, [router]);

  useEffect(() => {
    embedderPreload();
  }, [embedderPreload]);

  // Reset the tracker each time a new session starts.
  useEffect(() => {
    if (status === "starting") {
      trackerReset();
      setMatchPath(null);
    }
  }, [status, trackerReset]);

  // Build the semantic index once both the script and the model are ready.
  // Cache hit → instant; cache miss → embed once, persist for next visit.
  useEffect(() => {
    if (!script) return;
    if (embedderStatus !== "ready") return;
    if (semanticIndex) return;
    let cancelled = false;
    (async () => {
      try {
        const hash = await hashScript(script.raw);
        const cached = await getCachedWindowEmbeddings(hash);
        if (cached) {
          if (!cancelled) setSemanticIndex({ windowEmbeddings: cached });
          return;
        }
        if (!cancelled) setIndexing(true);
        const index = await buildSemanticIndex(
          script.sentences,
          embedderEmbedBatch,
        );
        if (cancelled) return;
        setSemanticIndex(index);
        void setCachedWindowEmbeddings(hash, index.windowEmbeddings);
      } catch {
        // fall back to fuzzy-only — non-fatal
      } finally {
        if (!cancelled) setIndexing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [script, embedderStatus, embedderEmbedBatch, semanticIndex]);

  const transcriptTail = useMemo(() => {
    const all = [...transcript.finals, transcript.interim]
      .filter(Boolean)
      .join(" ");
    return takeTranscriptTail(all, TRANSCRIPT_TAIL_WORDS);
  }, [transcript]);

  // Hybrid match → feed the tracker. Tracker absorbs the commit/floor logic
  // that used to live in this effect.
  useEffect(() => {
    if (!script || !transcriptTail) return;
    let cancelled = false;

    (async () => {
      const fuzzy = matchTranscriptToSentences(
        script.sentences,
        transcriptTail,
      );
      const trustFuzzy = fuzzy.score >= FUZZY_TRUST_THRESHOLD;
      const canSemantic = semanticIndex && embedderStatus === "ready";

      if (trustFuzzy || !canSemantic) {
        if (cancelled) return;
        trackerObserve({ scores: fuzzy.scores });
        setMatchPath("fuzzy");
        return;
      }

      try {
        const tailEmbedding = await embedderEmbed(transcriptTail);
        if (cancelled) return;
        const sem = semanticMatch(semanticIndex!, tailEmbedding);
        // Pick the higher-scoring path's scores for the tracker.
        if (sem.score > fuzzy.score) {
          trackerObserve({ scores: sem.scores });
          setMatchPath("semantic");
        } else {
          trackerObserve({ scores: fuzzy.scores });
          setMatchPath("fuzzy");
        }
      } catch {
        if (cancelled) return;
        trackerObserve({ scores: fuzzy.scores });
        setMatchPath("fuzzy");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    script,
    transcriptTail,
    semanticIndex,
    embedderStatus,
    embedderEmbed,
    trackerObserve,
  ]);

  // Auto-scroll on position change — only while not locked by low confidence.
  useEffect(() => {
    if (trackerPosition === null) return;
    if (trackerLocked) return;
    const node = currentRef.current;
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [trackerPosition, trackerLocked]);

  if (!hydrated || !script) return null;

  const isListening = status === "listening";
  const isBusy = status === "starting" || status === "stopping";

  const statusLabel = (() => {
    switch (status) {
      case "idle":
        return "Tap Start when you're ready.";
      case "starting":
        return "Connecting…";
      case "listening":
        if (trackerPosition === null) {
          return "Listening — say something to begin.";
        }
        return trackerLocked
          ? `Re-aligning · ${Math.round(trackerConfidence * 100)}%`
          : `Tracking · ${Math.round(trackerConfidence * 100)}%${
              matchPath ? ` · ${matchPath}` : ""
            }`;
      case "stopping":
        return "Stopping…";
      case "error":
        return error ?? "Something went wrong.";
    }
  })();

  const engineCaption = (() => {
    if (embedderStatus === "error") {
      return "Semantic engine unavailable — falling back to keyword match.";
    }
    if (embedderStatus === "loading") {
      return embedderProgress != null
        ? `Semantic engine · loading ${Math.round(embedderProgress)}%`
        : "Semantic engine · loading…";
    }
    if (indexing) return "Indexing script…";
    if (embedderStatus === "ready" && !semanticIndex) {
      return "Semantic engine · preparing…";
    }
    return null;
  })();

  const currentIndex = trackerPosition;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-medium tracking-tight">
          cue<span className="text-primary">pilot</span>
        </h1>
        <button
          onClick={() => {
            stop();
            router.push("/");
          }}
          className="text-sm text-muted-foreground transition hover:text-foreground"
        >
          ← Edit script
        </button>
      </header>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2.5 text-sm">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isListening
                  ? trackerLocked
                    ? "animate-pulse bg-muted-foreground/60"
                    : "animate-pulse bg-primary"
                  : status === "error"
                    ? "bg-destructive"
                    : "bg-muted-foreground/40",
              )}
              aria-hidden
            />
            <span
              className={
                status === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }
            >
              {statusLabel}
            </span>
          </div>
          <Button
            onClick={isListening ? stop : start}
            disabled={isBusy}
            variant={isListening ? "secondary" : "default"}
            size="sm"
          >
            {isListening ? "Stop" : "Start"}
          </Button>
        </div>
        {engineCaption && (
          <div className="px-1 text-[11px] text-muted-foreground/70">
            {engineCaption}
          </div>
        )}
      </div>

      <article className="flex flex-col gap-5">
        {script.sentences.map((sentence, i) => {
          const isCurrent = i === currentIndex;
          const isPast = currentIndex !== null && i < currentIndex;
          return (
            <p
              key={i}
              ref={isCurrent ? currentRef : null}
              className={cn(
                "scroll-mt-32 border-l-2 pl-4 -ml-4 text-2xl leading-relaxed transition-colors duration-300",
                isCurrent
                  ? trackerLocked
                    ? "border-muted-foreground/40 text-foreground/70"
                    : "border-primary text-foreground"
                  : isPast
                    ? "border-transparent text-muted-foreground/35"
                    : "border-transparent text-muted-foreground",
              )}
            >
              {sentence}
            </p>
          );
        })}
      </article>

      {(transcript.finals.length > 0 || transcript.interim) && (
        <section className="rounded-lg border border-dashed border-border bg-card/50 p-4 text-sm">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Live transcript · debug
          </div>
          <p className="leading-relaxed text-muted-foreground">
            {transcript.finals.join(" ")}{" "}
            {transcript.interim && (
              <span className="opacity-60">{transcript.interim}</span>
            )}
          </p>
        </section>
      )}
    </main>
  );
}
