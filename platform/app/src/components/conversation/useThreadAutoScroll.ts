import { type RefObject, useEffect, useRef } from "react";
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
/**
 * How far from the bottom still counts as "reading the newest content".
 *
 * Wide enough to survive a part whose height settles a frame late (an image
 * resolving, a tool card expanding) without treating that as the reader having
 * scrolled away.
 */
const PINNED_TO_BOTTOM_SLACK_PX = 80;

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
  // Whether the reader is still at the newest content. Tracked on scroll
  // rather than measured when new content arrives: by then the container has
  // already grown by the height of that content, so a reader who was pinned to
  // the bottom measures as far from it.
  const pinnedRef = useRef(true);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      pinnedRef.current = distanceFromBottom <= PINNED_TO_BOTTOM_SLACK_PX;
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  useEffect(() => {
    if (!enabled) return;
    const container = scrollRef.current;
    if (!container) return;
    // A reader who has scrolled up to re-read an earlier turn stays there.
    // Following the stream regardless pulled them back to the bottom on every
    // token batch, which made re-reading during a reply impossible.
    if (!pinnedRef.current) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    // `pendingReply` is a dependency because the waiting state is the newest
    // thing in the thread the moment it appears, and it appears before any
    // part of the reply does.
  }, [scrollRef, parts, pendingReply, enabled]);
}
