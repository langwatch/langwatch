/** Whether this reader has asked for less motion (`prefers-reduced-motion`). */
import { useSyncExternalStore } from "react";

const MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

// One live MediaQueryList for the whole app: `getSnapshot` runs on EVERY render
// of every subscriber, and `window.matchMedia` is a measurable per-call cost at
// that frequency (profiled in the Langy panel). The cache keys on the
// `matchMedia` function identity so a test that stubs it gets a fresh list.
let cachedQuery: {
  matchMedia: typeof window.matchMedia;
  query: MediaQueryList;
} | null = null;

function getQuery(): MediaQueryList | null {
  if (typeof window === "undefined") return null;

  if (typeof window.matchMedia !== "function") return null;

  if (!cachedQuery || cachedQuery.matchMedia !== window.matchMedia) {
    cachedQuery = {
      matchMedia: window.matchMedia,
      query: window.matchMedia(MEDIA_QUERY),
    };
  }
  return cachedQuery.query;
}

function subscribe(callback: () => void) {
  const query = getQuery();
  query?.addEventListener("change", callback);
  return () => query?.removeEventListener("change", callback);
}
function getSnapshot() {
  return getQuery()?.matches ?? false;
}
function getServerSnapshot() {
  return false;
}
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
