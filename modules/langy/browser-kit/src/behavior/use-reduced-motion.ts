import { useSyncExternalStore } from "react";

const mediaQuery = "(prefers-reduced-motion: reduce)";

let cachedQuery: {
  matchMedia: typeof window.matchMedia;
  query: MediaQueryList;
} | null = null;

function getQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }

  if (!cachedQuery || cachedQuery.matchMedia !== window.matchMedia) {
    cachedQuery = {
      matchMedia: window.matchMedia,
      query: window.matchMedia(mediaQuery),
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

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
