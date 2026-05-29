"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { splitIntoSentences } from "@/lib/sentence-split";
import { saveScript } from "@/lib/script-storage";

export default function Home() {
  const router = useRouter();
  const [script, setScript] = useState("");

  const sentences = splitIntoSentences(script);
  const canContinue = sentences.length > 0;

  const handleContinue = () => {
    if (!canContinue) return;
    saveScript({ raw: script, sentences });
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
        value={script}
        onChange={(e) => setScript(e.target.value)}
        placeholder="Paste your script here…"
        autoFocus
        className="min-h-[50dvh] flex-1 resize-none rounded-lg border border-border bg-card p-4 text-base leading-relaxed outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring"
      />

      <footer className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {sentences.length === 0
            ? "Paste some text to begin."
            : `${sentences.length} sentence${sentences.length === 1 ? "" : "s"} detected.`}
        </p>
        <Button onClick={handleContinue} disabled={!canContinue}>
          Continue
        </Button>
      </footer>
    </main>
  );
}
