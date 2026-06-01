/**
 * Tiny relative-time formatter. Returns short strings tuned for a
 * library list view ("just now", "5m ago", "yesterday", "3d ago").
 */
export function timeAgo(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 30) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m}m ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h}h ago`;
  }
  if (diff < 172800) return "yesterday";
  const d = Math.floor(diff / 86400);
  if (d < 30) return `${d}d ago`;
  const months = Math.floor(d / 30);
  return `${months}mo ago`;
}
