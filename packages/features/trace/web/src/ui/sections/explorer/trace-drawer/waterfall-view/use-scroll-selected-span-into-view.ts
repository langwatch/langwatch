import type { Virtualizer } from "@tanstack/react-virtual";
import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import type { SpanTreeNode } from "@langwatch/trace-contract";
import { ancestorSpanIds } from "./tree";
import type { FlatRow } from "./types";

/**
 * Brings the selected span's row into view.
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
  }, [selectedSpanId, rows, spans, virtualizer, setCollapsedIds, setExpandedGroups, groupKeyOf]);
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
    (row) => row.kind === "group" && row.spans.some((span) => span.spanId === selectedSpanId),
  );
  if (foldedInto?.kind !== "group") return;

  const groupKey = groupKeyOf(foldedInto);
  setExpandedGroups((previous) =>
    previous.has(groupKey) ? previous : new Set(previous).add(groupKey),
  );
}
