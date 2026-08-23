import { type RefObject, useEffect } from "react";
import type { DisplayPart } from "./types";

/**
 * Keeps the newest content in view as it arrives.
 *
 * The thread's own box is scrolled directly rather than asking the last
 * element to bring itself into view. `scrollIntoView` walks up and scrolls
 * EVERY ancestor scroll container it finds, so the thread re-mounting —
 * switching away from this tab and back — dragged the whole editor beside it
 * to the top and then back down again.
 */
export function useThreadAutoScroll({
  scrollRef,
  parts,
  pendingReply,
  enabled,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  parts: DisplayPart[];
  pendingReply: boolean;
  enabled: boolean;
}): void {
  useEffect(() => {
    if (!enabled) return;
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    // `pendingReply` is a dependency because the waiting state is the newest
    // thing in the thread the moment it appears, and it appears before any
    // part of the reply does.
  }, [scrollRef, parts, pendingReply, enabled]);
}
