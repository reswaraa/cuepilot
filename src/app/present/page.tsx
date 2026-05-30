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

const TRANSCRIPT_TAIL_WORDS = 15;
const FUZZY_TRUST_THRESHOLD = 0.2; // above this, fuzzy alone is trusted
const MIN_FUZZY_COMMIT = 0.08;
const MIN_SEMANTIC_COMMIT = 0.4;

type MatchPath = "fuzzy" | "semantic";

export default function Present() {
  const router = useRouter();
  const [script, setScript] = useState<StoredScript | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [matchScore, setMatchScore] = useState(0);
  const [matchPath, setMatchPath] = useState<MatchPath | null>(null);
  const [semanticIndex, setSemanticIndex] = useState<SemanticIndex | null>(
    null,
  );
  const [indexing, setIndexing] = useState(false);

  const { status, transcript, error, start, stop } = useDeepgramTranscription();
  const embedder = useEmbedder();

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
    embedder.preload();
  }, [embedder]);

  // Build the semantic index once both the script and the model are ready.
  // Cache hit → instant; cache miss → embed once, persist for next visit.
  useEffect(() => {
    if (!script) return;
    if (embedder.status !== "ready") return;
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
          embedder.embedBatch,
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
  }, [script, embedder, semanticIndex]);

  const transcriptTail = useMemo(() => {
    const all = [...transcript.finals, transcript.interim]
      .filter(Boolean)
      .join(" ");
    return takeTranscriptTail(all, TRANSCRIPT_TAIL_WORDS);
  }, [transcript]);

  // Hybrid match: fuzzy first; semantic fallback when fuzzy is unsure.
  useEffect(() => {
    if (!script || !transcriptTail) return;
    let cancelled = false;

    const commit = (idx: number, score: number, path: MatchPath) => {
      if (cancelled) return;
      setCurrentIndex(idx);
      setMatchScore(score);
      setMatchPath(path);
    };

    (async () => {
      const fuzzy = matchTranscriptToSentences(
        script.sentences,
        transcriptTail,
      );

      const fuzzyOk = fuzzy.score >= MIN_FUZZY_COMMIT;
      const trustFuzzy = fuzzy.score >= FUZZY_TRUST_THRESHOLD;
      const canSemantic = semanticIndex && embedder.status === "ready";

      if (trustFuzzy || !canSemantic) {
        if (fuzzyOk) commit(fuzzy.index, fuzzy.score, "fuzzy");
        return;
      }

      try {
        const tailEmbedding = await embedder.embed(transcriptTail);
        if (cancelled) return;
        const sem = semanticMatch(semanticIndex!, tailEmbedding);

        const semanticBetter =
          sem.score >= MIN_SEMANTIC_COMMIT &&
          (!fuzzyOk || sem.score >= fuzzy.score + 0.05);

        if (semanticBetter) {
          commit(sem.index, sem.score, "semantic");
        } else if (fuzzyOk) {
          commit(fuzzy.index, fuzzy.score, "fuzzy");
        }
      } catch {
        if (fuzzyOk) commit(fuzzy.index, fuzzy.score, "fuzzy");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [script, transcriptTail, semanticIndex, embedder]);

  useEffect(() => {
    if (currentIndex === null) return;
    const node = currentRef.current;
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentIndex]);

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
        return currentIndex === null
          ? "Listening — say something to begin."
          : `Tracking · ${Math.round(matchScore * 100)}%${
              matchPath ? ` · ${matchPath}` : ""
            }`;
      case "stopping":
        return "Stopping…";
      case "error":
        return error ?? "Something went wrong.";
    }
  })();

  const engineCaption = (() => {
    if (embedder.status === "error") {
      return "Semantic engine unavailable — falling back to keyword match.";
    }
    if (embedder.status === "loading") {
      return embedder.progress != null
        ? `Semantic engine · loading ${Math.round(embedder.progress)}%`
        : "Semantic engine · loading…";
    }
    if (indexing) return "Indexing script…";
    if (embedder.status === "ready" && !semanticIndex) {
      return "Semantic engine · preparing…";
    }
    return null;
  })();

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
                  ? "animate-pulse bg-primary"
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
                  ? "border-primary text-foreground"
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
