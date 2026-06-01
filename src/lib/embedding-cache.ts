import { openCuepilotDb, STORES } from "./db";

export async function hashScript(text: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    // Fallback: poor but deterministic; only hit on very old runtimes.
    let h = 0;
    for (let i = 0; i < text.length; i++) {
      h = (h * 31 + text.charCodeAt(i)) | 0;
    }
    return `len${text.length}_h${h.toString(16)}`;
  }
  const enc = new TextEncoder();
  const buffer = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getCachedWindowEmbeddings(
  key: string,
): Promise<number[][] | null> {
  try {
    const db = await openCuepilotDb();
    return await new Promise<number[][] | null>((resolve, reject) => {
      const tx = db.transaction(STORES.embeddings, "readonly");
      const req = tx.objectStore(STORES.embeddings).get(key);
      req.onsuccess = () => {
        const value = req.result;
        if (!value || !Array.isArray(value)) return resolve(null);
        const out: number[][] = value.map((row: unknown) =>
          row instanceof Float32Array
            ? Array.from(row)
            : Array.isArray(row)
              ? (row as number[])
              : [],
        );
        resolve(out.length > 0 && out[0].length > 0 ? out : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function setCachedWindowEmbeddings(
  key: string,
  embeddings: number[][],
): Promise<void> {
  try {
    const db = await openCuepilotDb();
    const compressed = embeddings.map((row) => Float32Array.from(row));
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.embeddings, "readwrite");
      const req = tx.objectStore(STORES.embeddings).put(compressed, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // best-effort — losing the cache just means we re-embed next visit
  }
}
