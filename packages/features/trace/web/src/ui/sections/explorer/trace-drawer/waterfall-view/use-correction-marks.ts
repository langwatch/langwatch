import { useMemo } from "react";
import type { SpanTreeNode } from "@langwatch/trace-contract";
import { expandDeletedSpanIds } from "@langwatch/trace-contract";
import { changedSpanFields } from "../../../../../model/traces/edit-overlay/apply-trace-edit-overlay-to-views";
import { useTraceEditOverlay } from "../../hooks/use-trace-edit-overlay";
import { useDrawerStore, useTraceEditStore } from "../../../../../index";

const NO_MARKS = {
  correctedSpanIds: new Set<string>(),
  deletedByCorrectionSpanIds: new Set<string>(),
};

/**
 * Which rows a stored correction changed, and which ones it removed.
 */
export function useCorrectionMarks(spans: SpanTreeNode[]): {
  correctedSpanIds: Set<string>;
  deletedByCorrectionSpanIds: Set<string>;
} {
  const overlay = useTraceEditOverlay();
  const overlayView = useTraceEditStore((s) => s.overlayView);
  const basePatch = useTraceEditStore((s) => s.basePatch);
  const isEditing = useDrawerStore((s) => s.isEditing);
  // While editing, the correction the session builds on is the one that counts:
  // a row it already changed still reads as edited, so a second pass never looks
  // like it lost the first one. It is adopted a beat after editing starts, and
  // the read it comes from stands in until then.
  const patch = isEditing ? (basePatch ?? overlay.data?.patch) : overlay.data?.patch;

  return useMemo(() => {
    if (!patch) return NO_MARKS;
    const correctedSpanIds = new Set(
      spans
        .map((span) => span.spanId)
        .filter((spanId) => changedSpanFields({ patch, spanId }).length > 0),
    );
    const deletedByCorrectionSpanIds =
      !isEditing && overlayView === "edited"
        ? expandDeletedSpanIds({
            links: spans.map((span) => ({
              id: span.spanId,
              parentId: span.parentSpanId,
            })),
            deletedSpanIds: patch.deletedSpanIds,
          })
        : new Set<string>();
    return { correctedSpanIds, deletedByCorrectionSpanIds };
  }, [patch, isEditing, overlayView, spans]);
}
