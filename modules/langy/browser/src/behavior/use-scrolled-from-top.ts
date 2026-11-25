import { useSyncExternalStore } from "react";

// Scroll does not bubble, but it does capture: one document listener follows
// whichever element is behind the ref, including one swapped in on remount.
function subscribeToScroll(onScroll: () => void): () => void {
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => document.removeEventListener("scroll", onScroll, { capture: true });
}

/**
 * Whether a scroll container has content scrolled off above its top edge.
 */
export function useScrolledFromTop(scrollRef: React.RefObject<HTMLElement | null>): boolean {
  // A pixel of slack: fractional zoom and smooth-scroll settling can leave
  // sub-pixel residue at the top, which must still count as "at the top".
  const readScrolledFromTop = () => (scrollRef.current?.scrollTop ?? 0) > 1;
  return useSyncExternalStore(subscribeToScroll, readScrolledFromTop, () => false);
}
