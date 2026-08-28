import { useMemo } from "react";
import type { SpanTreeNode } from "@langwatch/trace-contract";
import { expandDeletedSpanIds } from "~/server/traces/edit-overlay/applyTraceEditOverlay";
import { changedSpanFields } from "~/server/traces/edit-overlay/applyTraceEditOverlayToViews";
import { useTraceEditOverlay } from "../../../hooks/useTraceEditOverlay";
import { useDrawerStore, useTraceEditStore } from "@langwatch/trace-web";

const NO_MARKS = {
  correctedSpanIds: new Set<string>(),
  deletedByCorrectionSpanIds: new Set<string>(),
};

/**
 * Which rows a stored correction changed, and which ones it removed.
 *
 * The removed set belongs to the corrected trace, which is where a reader goes
 * to see what the correction did: those rows are kept on screen and struck
 * through rather than dropped, because a row that simply vanished reads as one
 * that was never captured. The captured trace is the trace as it arrived and
 * carries no marks about removal at all. While the correction is being written
 * the editing marks already say what is going away, so there is nothing left
 * to mark.
 *
 * The changed set is the rows whose values the correction replaces, and only
 * those: it promises a captured value the reader can go and compare, which a
 * removal has none of.
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
