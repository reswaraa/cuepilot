import {
  DEFAULT_TRACKER_OPTIONS,
  type TrackerOptions,
} from "./position-tracker";

export type DebugConfig = {
  enabled: boolean;
  options: TrackerOptions;
};

const PARAM_MAP: Array<{
  param: string;
  key: keyof TrackerOptions;
  kind: "float" | "int";
}> = [
  { param: "sigma", key: "sigma", kind: "float" },
  { param: "ema", key: "ema", kind: "float" },
  { param: "commit", key: "commitDelta", kind: "float" },
  { param: "win", key: "recentWindow", kind: "int" },
  { param: "floor", key: "matchRateFloor", kind: "float" },
  { param: "pause", key: "pauseAt", kind: "float" },
  { param: "resume", key: "resumeAt", kind: "float" },
];

export function readDebugConfig(search: string): DebugConfig {
  const params = new URLSearchParams(search);
  const enabled = params.get("debug") === "1";
  if (!enabled) {
    return { enabled: false, options: DEFAULT_TRACKER_OPTIONS };
  }

  const options: TrackerOptions = { ...DEFAULT_TRACKER_OPTIONS };
  for (const { param, key, kind } of PARAM_MAP) {
    const raw = params.get(param);
    if (raw === null) continue;
    const parsed = kind === "int" ? parseInt(raw, 10) : parseFloat(raw);
    if (Number.isFinite(parsed)) {
      options[key] = parsed;
    }
  }

  return { enabled: true, options };
}

export function readDebugConfigFromWindow(): DebugConfig {
  if (typeof window === "undefined") {
    return { enabled: false, options: DEFAULT_TRACKER_OPTIONS };
  }
  return readDebugConfig(window.location.search);
}
