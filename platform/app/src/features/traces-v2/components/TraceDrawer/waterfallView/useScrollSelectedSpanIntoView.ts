import type { Virtualizer } from "@tanstack/react-virtual";
import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { ancestorSpanIds } from "./tree";
import type { FlatRow } from "./types";

/**
 * Brings the selected span's row into view.
 *
 * Selecting a span is not the same as showing it. A comment, a header chip or
 * an error pill can select a span hundreds of rows down a virtualized list, and
 * without this the reader is told the span is selected while looking at a part
 * of the tree that does not hold it. A row already fully on screen is left
 * where it is: `auto` scrolls the shortest distance that reveals it, and
 * nothing at all when there is no distance to travel.
 *
 * A row can also be folded away rather than merely off screen, under a
 * collapsed parent or inside a folded group of repeated siblings. Unfolding
 * what hides it changes `rows`, and this same effect then finds the row and
 * scrolls to it. A span the trace does not carry unfolds nothing and leaves the
 * state untouched, so there is no loop to fall into.
 */
export function useScrollSelectedSpanIntoView({
  selectedSpanId,
  rows,
  spans,
  virtualizer,
  setCollapsedIds,
  setExpandedGroups,
  groupKeyOf,
}: {
  selectedSpanId: string | null | undefined;
  rows: FlatRow[];
  spans: SpanTreeNode[];
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  setCollapsedIds: Dispatch<SetStateAction<Set<string>>>;
  setExpandedGroups: Dispatch<SetStateAction<Set<string>>>;
  groupKeyOf: (row: Extract<FlatRow, { kind: "group" }>) => string;
}) {
  useEffect(() => {
    if (!selectedSpanId) return;

    const index = rows.findIndex(
      (row) => row.kind === "span" && row.node.span.spanId === selectedSpanId,
    );
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: "auto" });
      return;
    }

    unfoldWhateverHides({
      selectedSpanId,
      rows,
      spans,
      setCollapsedIds,
      setExpandedGroups,
      groupKeyOf,
    });
    // The effect re-runs on the rows that unfolding produces, and scrolls then.
  }, [
    selectedSpanId,
    rows,
    spans,
    virtualizer,
    setCollapsedIds,
    setExpandedGroups,
    groupKeyOf,
  ]);
}

/** Opens the collapsed parents and the folded sibling group hiding a span. */
function unfoldWhateverHides({
  selectedSpanId,
  rows,
  spans,
  setCollapsedIds,
  setExpandedGroups,
  groupKeyOf,
}: {
  selectedSpanId: string;
  rows: FlatRow[];
  spans: SpanTreeNode[];
  setCollapsedIds: Dispatch<SetStateAction<Set<string>>>;
  setExpandedGroups: Dispatch<SetStateAction<Set<string>>>;
  groupKeyOf: (row: Extract<FlatRow, { kind: "group" }>) => string;
}) {
  const hiddenBy = new Set(ancestorSpanIds({ spans, spanId: selectedSpanId }));
  if (hiddenBy.size > 0) {
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      for (const id of hiddenBy) next.delete(id);
      return next.size === previous.size ? previous : next;
    });
  }

  const foldedInto = rows.find(
    (row) =>
      row.kind === "group" &&
      row.spans.some((span) => span.spanId === selectedSpanId),
  );
  if (foldedInto?.kind !== "group") return;

  const groupKey = groupKeyOf(foldedInto);
  setExpandedGroups((previous) =>
    previous.has(groupKey) ? previous : new Set(previous).add(groupKey),
  );
}
