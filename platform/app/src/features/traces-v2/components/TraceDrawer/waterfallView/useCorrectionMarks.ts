import { useMemo } from "react";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { expandDeletedSpanIds } from "~/server/traces/edit-overlay/applyTraceEditOverlay";
import { overlayTouchesSpan } from "~/server/traces/edit-overlay/applyTraceEditOverlayToViews";
import { useTraceEditOverlay } from "../../../hooks/useTraceEditOverlay";
import { useDrawerStore } from "../../../stores/drawerStore";
import { useTraceEditStore } from "../../../stores/traceEditStore";

const NO_MARKS = {
  correctedSpanIds: new Set<string>(),
  deletedByCorrectionSpanIds: new Set<string>(),
};

/**
 * Which rows a stored correction changed, and which ones it removed.
 *
 * The removed set is only populated while the reader is on the captured trace:
 * on the corrected one those rows are already gone, and while the correction is
 * being written the editing marks already say what is going away, so there is
 * nothing left to mark.
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
  const patch = isEditing
    ? (basePatch ?? overlay.data?.patch)
    : overlay.data?.patch;

  return useMemo(() => {
    if (!patch) return NO_MARKS;
    const correctedSpanIds = new Set(
      spans
        .map((span) => span.spanId)
        .filter((spanId) => overlayTouchesSpan({ patch, spanId })),
    );
    const deletedByCorrectionSpanIds =
      !isEditing && overlayView === "original"
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
