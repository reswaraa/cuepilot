"use client";

import { useCallback, useRef, useState } from "react";

export type TrackerOptions = {
  /** Gaussian σ in sentences — width of the position prior bias. */
  sigma: number;
  /** EMA alpha; higher = more reactive, lower = smoother. */
  ema: number;
  /** Minimum smoothed delta before the displayed position updates. */
  commitDelta: number;
  /** Rolling window length used for consistency + match-rate. */
  recentWindow: number;
  /** Absolute score floor counted as "a real match" in match-rate. */
  matchRateFloor: number;
  /** Confidence below which auto-scroll pauses. */
  pauseAt: number;
  /** Confidence required to resume auto-scroll after a pause. */
  resumeAt: number;
};

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  sigma: 2.5,
  ema: 0.5,
  commitDelta: 0.5,
  recentWindow: 5,
  matchRateFloor: 0.12,
  pauseAt: 0.4,
  resumeAt: 0.6,
};

export type TrackerObservation = {
  /** Per-sentence (or per-window) scores produced by the matcher. */
  scores: number[];
};

export type TrackerState = {
  /** Committed display position (null until first observation). */
  position: number | null;
  /** Composite confidence in [0, 1]. */
  confidence: number;
  /** Top - second-best raw score. */
  margin: number;
  /** Inverse-variance of recent candidate positions in [0, 1]. */
  consistency: number;
  /** Fraction of recent chunks above the absolute score floor. */
  matchRate: number;
  /** True when hysteresis is keeping auto-scroll paused. */
  isLocked: boolean;
};

export const INITIAL_TRACKER_STATE: TrackerState = {
  position: null,
  confidence: 0,
  margin: 0,
  consistency: 0,
  matchRate: 0,
  isLocked: false,
};

type Internal = {
  smoothed: number | null;
  history: Array<{ position: number; topScore: number }>;
  isLocked: boolean;
};

function createInternal(): Internal {
  return { smoothed: null, history: [], isLocked: false };
}

export function observePosition(
  internal: Internal,
  observation: TrackerObservation,
  previous: TrackerState,
  options: TrackerOptions,
): TrackerState {
  const { scores } = observation;
  if (scores.length === 0) return previous;

  // 1. Position prior. Bias toward where we already are.
  const prior = previous.position;
  const sigma2 = options.sigma * options.sigma;
  const weighted =
    prior === null
      ? scores.slice()
      : scores.map((s, i) => {
          const d = i - prior;
          return s * Math.exp(-(d * d) / (2 * sigma2));
        });

  // 2. Argmax of weighted scores → instantaneous candidate.
  let candidateIndex = 0;
  let candidateScore = -Infinity;
  for (let i = 0; i < weighted.length; i++) {
    if (weighted[i] > candidateScore) {
      candidateScore = weighted[i];
      candidateIndex = i;
    }
  }

  // 3. EMA smoothing on the candidate position.
  const smoothed =
    internal.smoothed === null
      ? candidateIndex
      : options.ema * candidateIndex +
        (1 - options.ema) * internal.smoothed;
  internal.smoothed = smoothed;

  // 4. Commit-on-threshold: hide sub-sentence jitter from the display.
  const lastPosition = previous.position;
  const clamp = (n: number) =>
    Math.max(0, Math.min(scores.length - 1, Math.round(n)));

  let newPosition: number;
  if (lastPosition === null) {
    newPosition = clamp(smoothed);
  } else if (Math.abs(smoothed - lastPosition) >= options.commitDelta) {
    newPosition = clamp(smoothed);
  } else {
    newPosition = lastPosition;
  }

  // 5. Margin from raw (un-weighted) scores.
  let topRaw = -Infinity;
  let secondRaw = -Infinity;
  for (const s of scores) {
    if (s > topRaw) {
      secondRaw = topRaw;
      topRaw = s;
    } else if (s > secondRaw) {
      secondRaw = s;
    }
  }
  const margin = Math.max(0, topRaw - Math.max(0, secondRaw));

  // 6. Update rolling history.
  internal.history.push({ position: candidateIndex, topScore: topRaw });
  if (internal.history.length > options.recentWindow) {
    internal.history.shift();
  }

  // 7. Temporal consistency (low variance → high consistency).
  const positions = internal.history.map((h) => h.position);
  const mean = positions.reduce((a, b) => a + b, 0) / positions.length;
  const variance =
    positions.reduce((acc, p) => acc + (p - mean) ** 2, 0) / positions.length;
  const consistency = 1 / (1 + variance / 4);

  // 8. Match rate over the same window.
  const matchRate =
    internal.history.filter((h) => h.topScore >= options.matchRateFloor)
      .length / internal.history.length;

  // 9. Composite confidence. Margin is normalized so 0.2 ≈ "very confident".
  const scaledMargin = Math.min(1, margin / 0.2);
  const confidence = Math.max(
    0,
    Math.min(1, scaledMargin * consistency * matchRate),
  );

  // 10. Hysteresis on the lock flag.
  let isLocked = internal.isLocked;
  if (!isLocked && confidence < options.pauseAt) {
    isLocked = true;
  } else if (isLocked && confidence > options.resumeAt) {
    isLocked = false;
  }
  internal.isLocked = isLocked;

  return {
    position: newPosition,
    confidence,
    margin,
    consistency,
    matchRate,
    isLocked,
  };
}

export function usePositionTracker(
  options: TrackerOptions = DEFAULT_TRACKER_OPTIONS,
) {
  const [state, setState] = useState<TrackerState>(INITIAL_TRACKER_STATE);
  const internalRef = useRef<Internal>(createInternal());
  const stateRef = useRef<TrackerState>(INITIAL_TRACKER_STATE);

  const observe = useCallback(
    (observation: TrackerObservation) => {
      const next = observePosition(
        internalRef.current,
        observation,
        stateRef.current,
        options,
      );
      stateRef.current = next;
      setState(next);
    },
    [options],
  );

  const reset = useCallback(() => {
    internalRef.current = createInternal();
    stateRef.current = INITIAL_TRACKER_STATE;
    setState(INITIAL_TRACKER_STATE);
  }, []);

  return { ...state, observe, reset };
}
