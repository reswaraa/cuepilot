export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-start justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-medium tracking-tight">
        cue<span className="text-primary">pilot</span>
      </h1>
      <p className="text-base text-muted-foreground">
        An AI teleprompter that tracks where you are in your script — so the
        next line is always there when you forget.
      </p>
    </main>
  );
}
