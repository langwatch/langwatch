import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

const EMPTY_SET: ReadonlySet<string> = new Set();

interface UseOverflowVisibilityOptions {
  /** Container whose right edge defines the visibility cutoff. */
  scrollerRef: RefObject<HTMLElement | null>;
  /**
   * The full ordered list of item ids that may render in the row. The
   * hook re-measures whenever this reference changes — pass a memoized
   * array (or just the source state) so we don't thrash.
   */
  items: readonly string[];
  /**
   * Currently active item, if any. The hook guarantees this id is
   * never hidden — when measurement would otherwise drop it, the last
   * visible item is sacrificed instead so the underline / highlight
   * still has a target.
   */
  activeId?: string | null;
  /**
   * Pixel headroom reserved on the right edge of the scroller for the
   * overflow trigger itself (plus any sibling chrome like a "+" button
   * that lives in the same row). Defaults to 56px — wide enough for
   * the trigger button + a comfortable hover ring.
   */
  reservePx?: number;
  /**
   * Attribute used to mark which descendants of the scroller are
   * measurable items. Default `data-overflow-id`; LensTabs uses
   * Chakra's `data-value` so it can keep its existing markup — pass
   * `"data-value"` when reusing the hook there.
   */
  attribute?: string;
}

/**
 * Generic first-fit overflow detector. Measures children of `scrollerRef`
 * marked with `data-overflow-id` (or a custom attribute), and returns the
 * set of ids whose right edge would land past
 * `containerRight - reservePx`. Those ids should be visually hidden by
 * the caller (display: none) and surfaced through an `OverflowMenu`.
 *
 * The active id is always force-visible: if it would otherwise overflow,
 * the trailing visible item is swapped into the hidden set instead.
 *
 * Two-phase to avoid measurement thrash:
 * 1. Whenever inputs change (items, active id, container resize) the
 *    hidden set is cleared so every item renders — the next layout
 *    pass has accurate widths to measure.
 * 2. `useLayoutEffect` picks the cutoff once, sets the hidden set, and
 *    exits early on subsequent renders so we don't oscillate.
 */
export function useOverflowVisibility({
  scrollerRef,
  items,
  activeId,
  reservePx = 56,
  attribute = "data-overflow-id",
}: UseOverflowVisibilityOptions): ReadonlySet<string> {
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [measureSeq, setMeasureSeq] = useState(0);

  // Reset on items / active-id change — the active item moving can
  // free up room or push another item over the edge.
  useEffect(() => {
    setHiddenIds(EMPTY_SET);
    setMeasureSeq((s) => s + 1);
  }, [items, activeId]);

  // Reset on container resize so a wider parent can re-show items.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      setHiddenIds(EMPTY_SET);
      setMeasureSeq((s) => s + 1);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [scrollerRef]);

  useLayoutEffect(() => {
    if (hiddenIds.size > 0) return;
    const root = scrollerRef.current;
    if (!root) return;

    const els = Array.from(
      root.querySelectorAll<HTMLElement>(`[${attribute}]`),
    );
    if (els.length === 0) return;

    const containerRect = root.getBoundingClientRect();
    const limit = containerRect.right - reservePx;

    const next = new Set<string>();
    const visibleIds: string[] = [];
    let cutoff = false;
    for (const el of els) {
      const id = el.getAttribute(attribute);
      if (!id) continue;
      if (cutoff) {
        next.add(id);
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.right > limit) {
        next.add(id);
        cutoff = true;
      } else {
        visibleIds.push(id);
      }
    }

    if (activeId && next.has(activeId) && visibleIds.length > 0) {
      const sacrifice = visibleIds[visibleIds.length - 1]!;
      next.delete(activeId);
      next.add(sacrifice);
    }

    if (next.size > 0) setHiddenIds(next);
  }, [measureSeq, hiddenIds, items, scrollerRef, activeId, attribute, reservePx]);

  return hiddenIds;
}
