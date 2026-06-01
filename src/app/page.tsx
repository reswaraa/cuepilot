"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  detectScriptMode,
  parseScript,
  type ScriptMode,
} from "@/lib/sentence-split";
import { saveScript } from "@/lib/script-storage";

export default function Home() {
  const router = useRouter();
  const [rawText, setRawText] = useState("");
  const [sentences, setSentences] = useState<string[]>([]);
  const [mode, setMode] = useState<ScriptMode>("script");
  // Whether the user has manually edited the chunked preview. While
  // they have, we leave the preview alone on each keystroke so their
  // edits aren't blown away. Re-running the parse is gated to mode
  // changes and explicit re-parse.
  const [manualOverride, setManualOverride] = useState(false);

  const detectedMode = useMemo(() => detectScriptMode(rawText), [rawText]);

  // Re-parse whenever raw text or mode changes, unless the user is
  // currently editing chunks inline.
  useEffect(() => {
    if (manualOverride) return;
    setSentences(parseScript(rawText, mode));
  }, [rawText, mode, manualOverride]);

  // Adopt the detected mode unless the user has explicitly set one
  // (mode === "bullets" is disabled in v0, so this just keeps the
  // active mode aligned with the input's shape).
  useEffect(() => {
    if (detectedMode === "bullets") return; // mode toggle is locked to script
    setMode(detectedMode);
  }, [detectedMode]);

  const handleSentenceEdit = (idx: number, value: string) => {
    setManualOverride(true);
    setSentences((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  const handleReparse = () => {
    setManualOverride(false);
    setSentences(parseScript(rawText, mode));
  };

  const trimmedSentences = sentences.map((s) => s.trim()).filter(Boolean);
  const canContinue = trimmedSentences.length > 0;

  const handleContinue = () => {
    if (!canContinue) return;
    saveScript({
      raw: rawText.trim() || trimmedSentences.join(" "),
      sentences: trimmedSentences,
    });
    router.push("/present");
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-medium tracking-tight">
          cue<span className="text-primary">pilot</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Paste your script. We&apos;ll listen and keep your place as you
          speak.
        </p>
      </header>

      <textarea
        value={rawText}
        onChange={(e) => {
          setRawText(e.target.value);
          setManualOverride(false);
        }}
        placeholder="Paste your script here…"
        autoFocus
        className="min-h-[28dvh] resize-none rounded-lg border border-border bg-card p-4 text-base leading-relaxed outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring"
      />

      <div className="flex items-center justify-between">
        <div
          className="inline-flex items-center rounded-md border border-border bg-card p-0.5"
          role="tablist"
          aria-label="Script mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "script"}
            onClick={() => setMode("script")}
            className={cn(
              "rounded-sm px-3 py-1 text-xs font-medium transition",
              mode === "script"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Script
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={false}
            aria-disabled
            disabled
            title="Bullet Mode is coming soon."
            className="cursor-not-allowed rounded-sm px-3 py-1 text-xs font-medium text-muted-foreground/50"
          >
            Bullets · soon
          </button>
        </div>
        <span className="text-xs text-muted-foreground/70">
          Detected: {detectedMode === "bullets" ? "bullets" : "script"}
        </span>
      </div>

      {trimmedSentences.length > 0 && (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-card/40 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              Preview · {trimmedSentences.length}{" "}
              {trimmedSentences.length === 1 ? "sentence" : "sentences"}
            </span>
            {manualOverride && (
              <button
                type="button"
                onClick={handleReparse}
                className="text-xs text-muted-foreground transition hover:text-foreground"
              >
                Reset to auto-split
              </button>
            )}
          </div>
          <ol className="flex flex-col gap-1">
            {sentences.map((sentence, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-1.5 w-6 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/50">
                  {i + 1}
                </span>
                <textarea
                  value={sentence}
                  onChange={(e) => handleSentenceEdit(i, e.target.value)}
                  rows={1}
                  className="cp-autosize flex-1 resize-none rounded-md border border-transparent bg-transparent px-2 py-1 text-sm leading-relaxed outline-none transition focus:border-border focus:bg-card focus:ring-2 focus:ring-ring"
                />
              </li>
            ))}
          </ol>
        </section>
      )}

      <footer className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          {trimmedSentences.length === 0
            ? "Paste some text to begin."
            : "Tap any line above to edit."}
        </p>
        <Button onClick={handleContinue} disabled={!canContinue}>
          Continue
        </Button>
      </footer>
    </main>
  );
}
