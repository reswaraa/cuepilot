"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.push(params.get("from") ?? "/");
    } else {
      setError("Wrong password.");
      setPending(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-8 px-6">
      <header className="flex flex-col items-center gap-1.5 text-center">
        <h1 className="text-2xl font-medium tracking-tight">
          cue<span className="text-primary">pilot</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter your access password to continue.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          required
          className="rounded-lg border border-border bg-card px-4 py-2.5 text-base outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending || !password} className="w-full">
          {pending ? "Checking…" : "Continue"}
        </Button>
      </form>
    </main>
  );
}
