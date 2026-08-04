import { useMemo } from "react";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import {
  expandDeletedSpanIds,
  overlayTouchesSpan,
} from "~/server/traces/edit-overlay/applyTraceEditOverlay";
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
 * on the corrected one those rows are already gone, so there is nothing to
 * mark.
 */
export function useCorrectionMarks(spans: SpanTreeNode[]): {
  correctedSpanIds: Set<string>;
  deletedByCorrectionSpanIds: Set<string>;
} {
  const overlay = useTraceEditOverlay();
  const overlayView = useTraceEditStore((s) => s.overlayView);
  const isEditing = useDrawerStore((s) => s.editing);
  const patch = overlay.data?.patch;

  return useMemo(() => {
    if (!patch || isEditing) return NO_MARKS;
    const correctedSpanIds = new Set(
      spans
        .map((span) => span.spanId)
        .filter((spanId) => overlayTouchesSpan({ patch, spanId })),
    );
    const deletedByCorrectionSpanIds =
      overlayView === "original"
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
