'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { loadScript, type StoredScript } from '@/lib/script-storage';
import { useDeepgramTranscription } from '@/lib/use-deepgram-transcription';
import { useMicLevel } from '@/lib/use-mic-level';
import { getSkipPreflight, setSkipPreflight } from '@/lib/preflight-prefs';

export default function Preflight() {
  const router = useRouter();
  const [script, setScript] = useState<StoredScript | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [skipNextTime, setSkipNextTime] = useState(false);

  const { status, transcript, error, stream, start, stop } =
    useDeepgramTranscription();
  const level = useMicLevel(stream);

  useEffect(() => {
    const stored = loadScript();
    if (!stored) {
      router.replace('/');
      return;
    }
    // One-shot hydration from sessionStorage + localStorage. The page renders
    // null until `hydrated` flips, so there's no SSR/CSR mismatch — this is
    // the canonical "load from browser-only store on mount" pattern that the
    // rule flags as a false positive.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScript(stored);
    setSkipNextTime(getSkipPreflight());
    setHydrated(true);
  }, [router]);

  const handleSkipToggle = (next: boolean) => {
    setSkipNextTime(next);
    setSkipPreflight(next);
  };

  const handleBegin = () => {
    stop();
    router.push('/present');
  };

  if (!hydrated || !script) return null;

  const isTesting = status === 'listening';
  const isMicDenied =
    status === 'error' && /denied|permission/i.test(error ?? '');
  const heardSomething =
    transcript.finals.length > 0 || transcript.interim.length > 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-medium tracking-tight">
          cue<span className="text-primary">pilot</span>
        </h1>
        <button
          type="button"
          onClick={() => {
            stop();
            router.push('/');
          }}
          className="text-sm text-muted-foreground transition hover:text-foreground"
        >
          ← Edit
        </button>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-2xl font-medium tracking-tight">Quick mic check</h2>
        <p className="text-sm text-muted-foreground">
          Make sure we can hear you before going live. Say a few words, you
          should see them appear below.
        </p>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card/60 p-5">
        <div
          className="relative h-2 overflow-hidden rounded-full bg-muted"
          aria-hidden
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width,background-color] duration-100 ease-out',
              level > 0.05 ? 'bg-primary' : 'bg-muted-foreground/30',
            )}
            style={{ width: `${Math.max(2, level * 100)}%` }}
          />
        </div>
        <div className="min-h-[3rem] text-base leading-relaxed">
          {!isTesting && !heardSomething && (
            <span className="text-muted-foreground">
              Tap the button below and say something.
            </span>
          )}
          {isTesting && !heardSomething && (
            <span className="text-muted-foreground">Listening…</span>
          )}
          {heardSomething && (
            <span>
              {transcript.finals.join(' ')}{' '}
              {transcript.interim && (
                <span className="opacity-60">{transcript.interim}</span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          {status === 'error' ? (
            <span className="text-xs text-destructive">{error}</span>
          ) : (
            <span className="text-xs text-muted-foreground/70">
              {isTesting ? 'Live · audio reaches Deepgram.' : 'Idle.'}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant={isTesting ? 'secondary' : 'default'}
            onClick={isTesting ? stop : start}
            disabled={status === 'starting' || status === 'stopping'}
          >
            {isTesting ? 'Stop test' : 'Test microphone'}
          </Button>
        </div>
        {isMicDenied && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Microphone access was denied. On iOS Safari: Settings → Safari →
            Microphone, then reload. On desktop browsers: click the lock icon in
            the address bar to allow microphone access.
          </p>
        )}
      </section>

      <label className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={skipNextTime}
          onChange={(e) => handleSkipToggle(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-primary"
        />
        Skip this check next time
      </label>

      <footer className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          {script.title ? `Script: ${script.title}` : null}
        </p>
        <Button size="default" onClick={handleBegin}>
          Begin presentation
        </Button>
      </footer>
    </main>
  );
}
