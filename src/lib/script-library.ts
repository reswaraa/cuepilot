import { openCuepilotDb, STORES } from "./db";

export type SavedScript = {
  id: string;
  title: string;
  rawText: string;
  sentences: string[];
  createdAt: number;
  updatedAt: number;
};

const TITLE_MAX = 60;

function autoTitleFromSentences(sentences: string[]): string {
  const first = sentences.find((s) => s.trim())?.trim() ?? "";
  if (!first) return "";
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1)}…` : first;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `script_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function listSavedScripts(): Promise<SavedScript[]> {
  try {
    const db = await openCuepilotDb();
    return await new Promise<SavedScript[]>((resolve, reject) => {
      const tx = db.transaction(STORES.scripts, "readonly");
      const req = tx.objectStore(STORES.scripts).getAll();
      req.onsuccess = () => {
        const all = (req.result as SavedScript[]) ?? [];
        all.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(all);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function getSavedScript(
  id: string,
): Promise<SavedScript | null> {
  try {
    const db = await openCuepilotDb();
    return await new Promise<SavedScript | null>((resolve, reject) => {
      const tx = db.transaction(STORES.scripts, "readonly");
      const req = tx.objectStore(STORES.scripts).get(id);
      req.onsuccess = () => resolve((req.result as SavedScript) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function upsertSavedScript(input: {
  id?: string;
  title?: string;
  rawText: string;
  sentences: string[];
}): Promise<SavedScript> {
  const db = await openCuepilotDb();
  const now = Date.now();

  let createdAt = now;
  const id = input.id ?? newId();
  if (input.id) {
    const existing = await getSavedScript(input.id);
    if (existing) createdAt = existing.createdAt;
  }

  const title =
    input.title?.trim() ||
    autoTitleFromSentences(input.sentences) ||
    "Untitled script";

  const record: SavedScript = {
    id,
    title,
    rawText: input.rawText,
    sentences: input.sentences,
    createdAt,
    updatedAt: now,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.scripts, "readwrite");
    const req = tx.objectStore(STORES.scripts).put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  return record;
}

export async function renameSavedScript(
  id: string,
  title: string,
): Promise<SavedScript | null> {
  const existing = await getSavedScript(id);
  if (!existing) return null;
  const trimmed = title.trim() || "Untitled script";
  if (trimmed === existing.title) return existing;
  const updated: SavedScript = {
    ...existing,
    title: trimmed,
    updatedAt: Date.now(),
  };
  const db = await openCuepilotDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.scripts, "readwrite");
    const req = tx.objectStore(STORES.scripts).put(updated);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  return updated;
}

export async function deleteSavedScript(id: string): Promise<void> {
  try {
    const db = await openCuepilotDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.scripts, "readwrite");
      const req = tx.objectStore(STORES.scripts).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // best-effort
  }
}
