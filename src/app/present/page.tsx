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
import { readDebugConfigFromWindow } from "@/lib/debug-options";
import {
  scrollSentenceIntoAnchor,
  sentenceOpacity,
} from "@/lib/teleprompter-view";
import { trackEvent } from "@/lib/analytics";

const TRANSCRIPT_TAIL_WORDS = 15;
const FUZZY_TRUST_THRESHOLD = 0.2;

const FONT_SIZES = [24, 28, 32, 40] as const;
type FontSize = (typeof FONT_SIZES)[number];
const DEFAULT_FONT_SIZE: FontSize = 28;
const FONT_SIZE_KEY = "cuepilot.fontSize";

type MatchPath = "fuzzy" | "semantic";

function readStoredFontSize(): FontSize {
  if (typeof window === "undefined") return DEFAULT_FONT_SIZE;
  const stored = window.localStorage.getItem(FONT_SIZE_KEY);
  const n = stored ? parseInt(stored, 10) : NaN;
  return (FONT_SIZES as readonly number[]).includes(n)
    ? (n as FontSize)
    : DEFAULT_FONT_SIZE;
}

export default function Present() {
  const router = useRouter();
  const [script, setScript] = useState<StoredScript | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [matchPath, setMatchPath] = useState<MatchPath | null>(null);
  const [semanticIndex, setSemanticIndex] = useState<SemanticIndex | null>(
    null,
  );
  const [indexing, setIndexing] = useState(false);

  // Read /present?debug=1&sigma=...&ema=... once at first render.
  // The whole object is frozen for the session so the tracker hook gets
  // a stable options reference.
  const [debugConfig] = useState(readDebugConfigFromWindow);
  const debugEnabled = debugConfig.enabled;

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
    margin: trackerMargin,
    consistency: trackerConsistency,
    matchRate: trackerMatchRate,
    isLocked: trackerLocked,
    observe: trackerObserve,
    reset: trackerReset,
    setPosition: trackerSetPosition,
  } = usePositionTracker(debugConfig.options);

  const [pulseIndex, setPulseIndex] = useState<number | null>(null);
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tracks whether the analytics "session_started" event already fired
  // for the current Start→Stop cycle. Auto-reconnects flip status back
  // to listening and shouldn't double-count.
  const sessionTrackedRef = useRef(false);

  // Auto-hiding chrome: visible by default; while listening, hides after
  // 3s of no interaction. Any tap/keystroke re-reveals and resets the timer.
  const [chromeVisible, setChromeVisible] = useState(true);
  const [interactionTick, setInteractionTick] = useState(0);

  // Font size; the lazy initializer reads localStorage on the first
  // render. The component returns null until `hydrated` flips, so any
  // server/client divergence isn't visible in the rendered HTML.
  const [fontSize, setFontSize] = useState<FontSize>(readStoredFontSize);

  const currentRef = useRef<HTMLParagraphElement | null>(null);

  const revealChrome = () => {
    setChromeVisible(true);
    setInteractionTick((t) => t + 1);
  };

  const cycleFontSize = () => {
    const next =
      FONT_SIZES[(FONT_SIZES.indexOf(fontSize) + 1) % FONT_SIZES.length];
    setFontSize(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FONT_SIZE_KEY, String(next));
    }
  };

  const anchorToSentence = (idx: number) => {
    trackerSetPosition(idx);
    setPulseIndex(idx);
    if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
    pulseTimeoutRef.current = setTimeout(() => {
      setPulseIndex((curr) => (curr === idx ? null : curr));
      pulseTimeoutRef.current = null;
    }, 700);
  };

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const stored = loadScript();
    if (!stored) {
      router.replace("/");
      return;
    }
    // One-shot hydration from sessionStorage; the component returns null
    // until `hydrated` flips, so no SSR/CSR mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScript(stored);
    setHydrated(true);
  }, [router]);

  useEffect(() => {
    embedderPreload();
  }, [embedderPreload]);

  const handleStart = () => {
    trackerReset();
    setMatchPath(null);
    sessionTrackedRef.current = false;
    start();
  };

  // Fire the Plausible "session_started" event the first time the WS
  // actually reaches listening for a given Start→Stop cycle.
  useEffect(() => {
    if (status === "listening" && !sessionTrackedRef.current) {
      sessionTrackedRef.current = true;
      trackEvent("session_started");
    }
    if (status === "idle" || status === "error") {
      sessionTrackedRef.current = false;
    }
  }, [status]);

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
  // Current sentence is anchored ~40% from the top of the viewport so the
  // next line(s) stay in the natural read-ahead zone.
  useEffect(() => {
    if (trackerPosition === null) return;
    if (trackerLocked) return;
    const node = currentRef.current;
    if (!node) return;
    scrollSentenceIntoAnchor(node);
  }, [trackerPosition, trackerLocked]);

  // Auto-hide chrome 3s after the last interaction, but only while
  // actively listening. Anything else (idle, error, model loading) shows
  // chrome unconditionally via the derived `showChrome` below.
  useEffect(() => {
    if (status !== "listening") return;
    if (!chromeVisible) return;
    const id = setTimeout(() => setChromeVisible(false), 3000);
    return () => clearTimeout(id);
  }, [status, chromeVisible, interactionTick]);

  // Effective visibility: while not actively listening, force visible.
  const showChrome = status !== "listening" || chromeVisible;

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
  const { options } = debugConfig;
  const fmt = (n: number) =>
    Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");

  return (
    <main
      onClick={revealChrome}
      onKeyDown={revealChrome}
      className="relative mx-auto min-h-dvh max-w-2xl px-6"
    >
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 top-0 z-20 transition-opacity duration-300 ease-out motion-reduce:transition-none",
          showChrome ? "opacity-100" : "opacity-0",
        )}
        aria-hidden={!showChrome}
      >
        <div
          className={cn(
            "mx-auto flex max-w-2xl items-center justify-between px-6 py-3 backdrop-blur-md",
            showChrome ? "bg-background/70 pointer-events-auto" : "",
          )}
        >
          <h1 className="text-base font-medium tracking-tight">
            cue<span className="text-primary">pilot</span>
          </h1>
          <div className="flex items-center gap-1">
            <button
              onClick={cycleFontSize}
              aria-label={`Font size — currently ${fontSize}px. Tap to change.`}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <span aria-hidden>Aa</span>
              <span
                aria-hidden
                className="text-[10px] tabular-nums opacity-60"
              >
                {fontSize}
              </span>
            </button>
            <button
              onClick={() => {
                stop();
                router.push("/");
              }}
              className="rounded-md px-2 py-1 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              ← Edit
            </button>
          </div>
        </div>
      </div>

      <article className="flex min-h-[60dvh] flex-col gap-5 pb-[40dvh] pt-[24dvh]">
        {script.sentences.map((sentence, i) => {
          const isCurrent = i === currentIndex;
          const isPast = currentIndex !== null && i < currentIndex;
          const distance =
            currentIndex === null ? 0 : Math.abs(i - currentIndex);
          const opacity =
            currentIndex === null
              ? 1
              : sentenceOpacity(distance, isPast, trackerLocked);
          const isPulsing = pulseIndex === i;
          return (
            <p
              key={i}
              ref={isCurrent ? currentRef : null}
              style={{
                opacity,
                fontSize: `${fontSize}px`,
                lineHeight: 1.45,
              }}
              onClick={() => anchorToSentence(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  anchorToSentence(i);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`Anchor at sentence ${i + 1}`}
              className={cn(
                "-ml-4 cursor-pointer rounded-r-md border-l-2 pl-4 text-foreground transition-[opacity,color,border-color] duration-300 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                isCurrent
                  ? trackerLocked
                    ? "border-muted-foreground/40"
                    : "border-primary"
                  : "border-transparent",
                isPulsing && "cp-anchor-pulse",
              )}
            >
              {sentence}
            </p>
          );
        })}
      </article>

      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-20 transition-opacity duration-300 ease-out motion-reduce:transition-none",
          showChrome ? "opacity-100" : "opacity-0",
        )}
        aria-hidden={!showChrome}
      >
        <div
          className={cn(
            "mx-auto max-w-2xl px-6 pb-6 pt-3",
            showChrome ? "pointer-events-auto" : "",
          )}
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-xl border border-border bg-card/85 px-4 py-3 shadow-lg backdrop-blur-md">
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
                onClick={isListening ? stop : handleStart}
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
        </div>
      </div>

      {debugEnabled && (
        <section className="mb-32 flex flex-col gap-3 rounded-lg border border-dashed border-border bg-card/50 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-foreground/80">debug</span>
            <span>σ={fmt(options.sigma)}</span>
            <span>ema={fmt(options.ema)}</span>
            <span>Δ={fmt(options.commitDelta)}</span>
            <span>win={fmt(options.recentWindow)}</span>
            <span>floor={fmt(options.matchRateFloor)}</span>
            <span>
              pause/resume={fmt(options.pauseAt)}/{fmt(options.resumeAt)}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>conf {Math.round(trackerConfidence * 100)}%</span>
            <span>margin {trackerMargin.toFixed(3)}</span>
            <span>consistency {trackerConsistency.toFixed(2)}</span>
            <span>matchRate {trackerMatchRate.toFixed(2)}</span>
            <span>
              {trackerLocked ? "● locked" : "○ live"}
              {matchPath ? ` · ${matchPath}` : ""}
            </span>
          </div>
          {(transcript.finals.length > 0 || transcript.interim) && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                transcript
              </div>
              <p className="font-sans">
                {transcript.finals.join(" ")}{" "}
                {transcript.interim && (
                  <span className="opacity-60">{transcript.interim}</span>
                )}
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
