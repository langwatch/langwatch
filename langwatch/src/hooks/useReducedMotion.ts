import { useSyncExternalStore } from "react";

const query =
  typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

function subscribe(callback: () => void) {
  query?.addEventListener("change", callback);
  return () => query?.removeEventListener("change", callback);
}

function getSnapshot() {
  return query?.matches ?? false;
}

function getServerSnapshot() {
  return false;
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
