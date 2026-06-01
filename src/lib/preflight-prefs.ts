const SKIP_KEY = "cuepilot.preflight.skip";

export function getSkipPreflight(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SKIP_KEY) === "1";
}

export function setSkipPreflight(skip: boolean): void {
  if (typeof window === "undefined") return;
  if (skip) window.localStorage.setItem(SKIP_KEY, "1");
  else window.localStorage.removeItem(SKIP_KEY);
}
