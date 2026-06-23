import { useCallback, useState } from "react";
import type { TraceListItem } from "../../../../../types/trace";

export const INITIAL_VISIBLE_TURNS = 7;
export const SHOW_MORE_STEP = 10;

export interface TurnsWindow {
  /** Leading turns rendered in order. */
  head: TraceListItem[];
  /**
   * The final turn, surfaced separately whenever the thread is truncated so
   * the latest exchange is always visible — even when the middle is hidden.
   * `null` when nothing is hidden (the head already includes it).
   */
  tail: TraceListItem | null;
  /** Turns hidden between `head` and `tail`. */
  hiddenCount: number;
}

/**
 * Slice a thread into a head window plus an always-visible tail. When the
 * thread is longer than `visibleCount`, the head holds the first
 * `visibleCount - 1` turns and the tail holds the last turn, with the
 * remainder counted as hidden. When it fits, `head` is the whole thread.
 */
export function windowTurns({
  traces,
  visibleCount,
}: {
  traces: TraceListItem[];
  visibleCount: number;
}): TurnsWindow {
  const total = traces.length;
  if (total <= visibleCount) {
    return { head: traces, tail: null, hiddenCount: 0 };
  }
  return {
    head: traces.slice(0, visibleCount - 1),
    tail: traces[total - 1] ?? null,
    hiddenCount: total - visibleCount,
  };
}

/**
 * Stateful turns window for an expanded conversation row. Starts truncated,
 * always keeps the last turn on screen, and lets the operator reveal more
 * turns (a page at a time, or all of them) without leaving the table.
 */
export function useTurnsWindow(traces: TraceListItem[]) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_TURNS);
  const window = windowTurns({ traces, visibleCount });
  const showMore = useCallback(
    () => setVisibleCount((c) => c + SHOW_MORE_STEP),
    [],
  );
  const showAll = useCallback(
    () => setVisibleCount(traces.length),
    [traces.length],
  );
  return {
    ...window,
    showMore,
    showAll,
    canShowMore: window.hiddenCount > 0,
  };
}
