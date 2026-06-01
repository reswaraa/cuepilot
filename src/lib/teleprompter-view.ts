"use client";

/**
 * Helpers for the teleprompter's viewport behaviour.
 * Kept out of the page component so the math is easy to tune in isolation.
 */

const ANCHOR_FRACTION = 0.4; // current sentence sits at 40% from the top

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Scroll the window so `node`'s vertical center lands at ~40% of the viewport.
 */
export function scrollSentenceIntoAnchor(node: HTMLElement): void {
  if (typeof window === "undefined") return;
  const viewportHeight = window.innerHeight;
  const rect = node.getBoundingClientRect();
  const elementCenter = window.scrollY + rect.top + rect.height / 2;
  const target = Math.max(0, elementCenter - viewportHeight * ANCHOR_FRACTION);
  window.scrollTo({
    top: target,
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
}

/**
 * Compute the opacity for a sentence given its distance from the current
 * position. Past sentences fade fast; upcoming sentences fade gradually
 * so a few next lines are always readable. When the tracker is locked
 * (low confidence) the visible "context window" widens in both directions.
 */
export function sentenceOpacity(
  distance: number,
  isPast: boolean,
  isLocked: boolean,
): number {
  if (distance === 0) return 1;
  if (isPast) {
    return isLocked
      ? Math.max(0.22, 0.5 - distance * 0.07)
      : Math.max(0.16, 0.4 - distance * 0.12);
  }
  return isLocked
    ? Math.max(0.28, 1 - distance * 0.1)
    : Math.max(0.22, 1 - distance * 0.18);
}
