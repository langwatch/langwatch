/**
 * Whether the reader asked their system for less motion.
 *
 * `platform/app/src/hooks/useReducedMotion.ts` was deleted while this move was
 * in flight, so this is a rewrite rather than a copy of it. It is four lines of
 * `matchMedia` and one subscription, and the answer is a hard constraint: a
 * decorative animation that ignores it is an accessibility failure, not a
 * missing nicety.
 *
 * `useSyncExternalStore` rather than an effect, so the first paint already has
 * the right answer and a change of system preference reaches every reader of
 * it at once. A browser without `matchMedia` reads as "no preference", which is
 * the same answer the media query gives when nobody has expressed one.
 */

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
