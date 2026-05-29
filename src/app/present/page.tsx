"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadScript, type StoredScript } from "@/lib/script-storage";

export default function Present() {
  const router = useRouter();
  const [script, setScript] = useState<StoredScript | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = loadScript();
    if (!stored) {
      router.replace("/");
      return;
    }
    setScript(stored);
    setHydrated(true);
  }, [router]);

  if (!hydrated || !script) return null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-10 px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-medium tracking-tight">
          cue<span className="text-primary">pilot</span>
        </h1>
        <button
          onClick={() => router.push("/")}
          className="text-sm text-muted-foreground transition hover:text-foreground"
        >
          ← Edit script
        </button>
      </header>

      <article className="flex flex-col gap-6">
        {script.sentences.map((sentence, i) => (
          <p
            key={i}
            className="text-2xl leading-relaxed text-muted-foreground"
          >
            {sentence}
          </p>
        ))}
      </article>
    </main>
  );
}
