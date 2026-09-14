/** System prefers-reduced-motion setting; useSyncExternalStore for first-paint correctness */

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function query(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(QUERY);
}

function subscribe(onChange: () => void): () => void {
  const list = query();
  if (!list) return () => void 0;
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? false,
    // Rendered without a window: no preference is the honest default, and the
    // first client paint corrects it before anything animates.
    () => false,
  );
}
