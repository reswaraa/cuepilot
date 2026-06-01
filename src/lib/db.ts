const DB_NAME = "cuepilot";
const DB_VERSION = 2;

export const STORES = {
  embeddings: "embeddings",
  scripts: "scripts",
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open the cuepilot IndexedDB connection. Single shared promise so the
 * same handle is reused across modules. All stores are created in one
 * onupgradeneeded so consumers don't have to coordinate version bumps.
 */
export function openCuepilotDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable."));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.embeddings)) {
        // Raw key → Float32Array[] (window embeddings). See embedding-cache.ts.
        db.createObjectStore(STORES.embeddings);
      }
      if (!db.objectStoreNames.contains(STORES.scripts)) {
        // Keyed by `id` on the object itself.
        db.createObjectStore(STORES.scripts, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
