const KEY = "cuepilot.script";

export type StoredScript = {
  raw: string;
  sentences: string[];
};

export function saveScript(script: StoredScript): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY, JSON.stringify(script));
}

export function loadScript(): StoredScript | null {
  if (typeof window === "undefined") return null;
  const stored = sessionStorage.getItem(KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.raw === "string" &&
      Array.isArray(parsed.sentences)
    ) {
      return parsed as StoredScript;
    }
  } catch {
    // fall through
  }
  return null;
}

export function clearScript(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY);
}
