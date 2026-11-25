import { type RefObject, useEffect, useLayoutEffect, useState } from "react";

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
   * Currently active item, if any. The hook guarantees this id is never hidden — when
   * measurement would otherwise drop it, the last visible item is sacrificed instead so
   * the underline / highlight still has a target.
   */
  activeId?: string | null;
  /**
   * Pixel headroom reserved on the right edge of the scroller for the overflow trigger
   * itself (plus any sibling chrome like a "+" button that lives in the same row).
   * Defaults to 56px — wide enough for the trigger button + a comfortable hover ring.
   */
  reservePx?: number;
  /**
   * Attribute used to mark which descendants of the scroller are measurable items.
   * Default `data-overflow-id`; LensTabs uses Chakra's `data-value` so it can keep its
   * existing markup — pass `"data-value"` when reusing the hook there.
   */
  attribute?: string;
  /**
   * Re-runs the measurement whenever this value changes.
   */
  remeasureKey?: string | number;
}

interface MeasureOverflowArgs {
  root: HTMLElement;
  attribute: string;
  reservePx: number;
  activeId?: string | null;
}

/** Splits the items, in order, at the first one whose right edge passes `limit`. */
function splitAtLimit({
  els,
  attribute,
  limit,
  activeId,
}: {
  els: HTMLElement[];
  attribute: string;
  limit: number;
  activeId?: string | null;
}): { next: Set<string>; visible: { id: string; right: number }[]; activeWidth: number } {
  const next = new Set<string>();
  const visible: { id: string; right: number }[] = [];
  let activeWidth = 0;
  for (const el of els) {
    const id = el.getAttribute(attribute);
    if (!id) continue;
    const rect = el.getBoundingClientRect();
    if (id === activeId) activeWidth = rect.width;
    if (next.size > 0 || rect.right > limit) next.add(id);
    else visible.push({ id, right: rect.right });
  }
  return { next, visible, activeWidth };
}

/** Measures which marked descendants of `root` fall past the overflow cutoff. */
function measureOverflow({
  root,
  attribute,
  reservePx,
  activeId,
}: MeasureOverflowArgs): ReadonlySet<string> | null {
  const els = Array.from(root.querySelectorAll<HTMLElement>(`[${attribute}]`));
  if (els.length === 0) return null;

  const containerRect = root.getBoundingClientRect();
  // A row with no width is not laid out — it is `display: none`, or not in
  // the document yet. Measuring it would put every item past the cutoff and
  // collapse the whole row; the resize observer re-measures once it has a
  // size.
  if (containerRect.width === 0) return null;
  const limit = containerRect.right - reservePx;

  const { next, visible, activeWidth } = splitAtLimit({ els, attribute, limit, activeId });

  // A hidden active item takes the place of the last visible ones, as many as its width
  // needs, so it is never shown clipped.
  if (activeId && next.has(activeId) && visible.length > 0) {
    next.delete(activeId);
    let used = visible.at(-1)?.right ?? containerRect.left;
    while (visible.length > 0 && used + activeWidth > limit) {
      const sacrifice = visible.pop();
      if (sacrifice) next.add(sacrifice.id);
      used = visible.at(-1)?.right ?? containerRect.left;
    }
  }

  return next.size > 0 ? next : null;
}

/**
 * Generic first-fit overflow detector. Measures children of `scrollerRef` marked with
 * `data-overflow-id` (or a custom attribute), and returns the set of ids whose right
 * edge would land past `containerRight - reservePx`.
 */
export function useOverflowVisibility({
  scrollerRef,
  items,
  activeId,
  reservePx = 56,
  attribute = "data-overflow-id",
  remeasureKey,
}: UseOverflowVisibilityOptions): ReadonlySet<string> {
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [measureSeq, setMeasureSeq] = useState(0);

  // Reset on items / active-id change — the active item moving can
  // free up room or push another item over the edge.
  useEffect(() => {
    setHiddenIds(EMPTY_SET);
    setMeasureSeq((s) => s + 1);
  }, [items, activeId, remeasureKey]);

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

    const next = measureOverflow({ root, attribute, reservePx, activeId });
    if (next) setHiddenIds(next);
  }, [measureSeq, hiddenIds, items, scrollerRef, activeId, attribute, reservePx]);

  return hiddenIds;
}
