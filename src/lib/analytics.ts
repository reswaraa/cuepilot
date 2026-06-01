"use client";

/**
 * Thin wrapper over Plausible's window.plausible(). No-ops when
 * NEXT_PUBLIC_PLAUSIBLE_DOMAIN is unset (the script isn't injected in
 * layout.tsx, so window.plausible doesn't exist) and on the server.
 *
 * Do not pass PII as props.
 */
type PlausibleFn = (
  event: string,
  options?: { props?: Record<string, string | number> },
) => void;

export function trackEvent(
  name: string,
  props?: Record<string, string | number>,
): void {
  if (typeof window === "undefined") return;
  const plausible = (window as unknown as { plausible?: PlausibleFn })
    .plausible;
  if (typeof plausible !== "function") return;
  try {
    plausible(name, props ? { props } : undefined);
  } catch {
    // best-effort
  }
}
