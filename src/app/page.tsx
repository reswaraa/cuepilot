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
import {
  deleteSavedScript,
  listSavedScripts,
  renameSavedScript,
  upsertSavedScript,
  type SavedScript,
} from "@/lib/script-library";
import { timeAgo } from "@/lib/time-ago";
import { getSkipPreflight } from "@/lib/preflight-prefs";

export default function Home() {
  const router = useRouter();

  // Library
  const [library, setLibrary] = useState<SavedScript[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);

  // Editor
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [rawText, setRawText] = useState("");
  const [sentences, setSentences] = useState<string[]>([]);
  const [mode, setMode] = useState<ScriptMode>("script");
  const [manualOverride, setManualOverride] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const detectedMode = useMemo(() => detectScriptMode(rawText), [rawText]);

  // Initial library load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await listSavedScripts();
      if (!cancelled) {
        setLibrary(list);
        setLibraryLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-parse on raw text / mode change, unless user is editing chunks.
  useEffect(() => {
    if (manualOverride) return;
    setSentences(parseScript(rawText, mode));
  }, [rawText, mode, manualOverride]);

  // Adopt the detected mode (Bullets is locked out in v0).
  useEffect(() => {
    if (detectedMode === "bullets") return;
    setMode(detectedMode);
  }, [detectedMode]);

  const trimmedSentences = sentences.map((s) => s.trim()).filter(Boolean);
  const canContinue = trimmedSentences.length > 0;

  const loadScriptIntoEditor = (script: SavedScript) => {
    setEditingId(script.id);
    setTitle(script.title);
    setRawText(script.rawText);
    setSentences(script.sentences);
    setManualOverride(true);
    setMode(detectScriptMode(script.rawText));
  };

  const startNewScript = () => {
    setEditingId(null);
    setTitle("");
    setRawText("");
    setSentences([]);
    setManualOverride(false);
    setMode("script");
  };

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

  const handleContinue = async () => {
    if (!canContinue) return;
    const raw = rawText.trim() || trimmedSentences.join(" ");
    try {
      const saved = await upsertSavedScript({
        id: editingId ?? undefined,
        title: title.trim() || undefined,
        rawText: raw,
        sentences: trimmedSentences,
      });
      saveScript({
        raw,
        sentences: trimmedSentences,
        id: saved.id,
        title: saved.title,
      });
    } catch {
      // IndexedDB unavailable — still ship the session via sessionStorage
      saveScript({ raw, sentences: trimmedSentences });
    }
    router.push(getSkipPreflight() ? "/present" : "/preflight");
  };

  const beginRename = (script: SavedScript) => {
    setRenamingId(script.id);
    setRenameDraft(script.title);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const next = await renameSavedScript(renamingId, renameDraft);
    if (next) {
      setLibrary((prev) =>
        prev.map((s) => (s.id === next.id ? next : s)).sort(
          (a, b) => b.updatedAt - a.updatedAt,
        ),
      );
      if (editingId === next.id) setTitle(next.title);
    }
    setRenamingId(null);
    setRenameDraft("");
  };

  const handleDelete = async (script: SavedScript) => {
    const confirmed = window.confirm(`Delete "${script.title}"?`);
    if (!confirmed) return;
    await deleteSavedScript(script.id);
    setLibrary((prev) => prev.filter((s) => s.id !== script.id));
    if (editingId === script.id) startNewScript();
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-medium tracking-tight">
          cue<span className="text-primary">pilot</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Paste your script. We&apos;ll listen and keep your place as you
          speak.
        </p>
      </header>

      {libraryLoaded && library.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              Recent
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={startNewScript}
                className="text-xs text-muted-foreground transition hover:text-foreground"
              >
                + New script
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-2">
            {library.map((script) => {
              const isActive = script.id === editingId;
              const isRenaming = renamingId === script.id;
              return (
                <li
                  key={script.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition",
                    isActive
                      ? "border-primary/60"
                      : "border-border hover:border-muted-foreground/40",
                  )}
                >
                  {isRenaming ? (
                    <input
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === "Escape") {
                          setRenamingId(null);
                          setRenameDraft("");
                        }
                      }}
                      autoFocus
                      className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => loadScriptIntoEditor(script)}
                      onDoubleClick={() => beginRename(script)}
                      className="flex-1 text-left"
                      title="Tap to load · double-tap to rename"
                    >
                      <div className="truncate text-sm font-medium text-foreground">
                        {script.title}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground/70">
                        {script.sentences.length}{" "}
                        {script.sentences.length === 1
                          ? "sentence"
                          : "sentences"}{" "}
                        · {timeAgo(script.updatedAt)}
                      </div>
                    </button>
                  )}
                  {!isRenaming && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => beginRename(script)}
                        className="rounded px-2 py-1 text-xs text-muted-foreground/70 transition hover:bg-muted hover:text-foreground"
                        aria-label="Rename"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(script)}
                        className="rounded px-2 py-1 text-xs text-muted-foreground/70 transition hover:bg-destructive/15 hover:text-destructive"
                        aria-label="Delete"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            {editingId ? "Editing" : "New script"}
          </h2>
          {editingId && (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled script"
              className="max-w-[60%] rounded border-0 bg-transparent px-1 text-right text-sm font-medium text-foreground placeholder:text-muted-foreground/40 outline-none focus:bg-card focus:ring-1 focus:ring-ring"
            />
          )}
        </div>

        <textarea
          value={rawText}
          onChange={(e) => {
            setRawText(e.target.value);
            setManualOverride(false);
          }}
          placeholder="Paste your script here…"
          className="min-h-[26dvh] resize-none rounded-lg border border-border bg-card p-4 text-base leading-relaxed outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring"
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
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/40 p-4">
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
          </div>
        )}
      </section>

      <footer className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          {trimmedSentences.length === 0
            ? "Paste some text to begin."
            : editingId
              ? "Saved to your library."
              : "Will be saved to your library."}
        </p>
        <Button onClick={handleContinue} disabled={!canContinue}>
          Continue
        </Button>
      </footer>
    </main>
  );
}
