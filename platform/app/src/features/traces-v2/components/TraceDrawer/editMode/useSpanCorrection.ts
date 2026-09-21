import { useMemo } from "react";
import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import { changedSpanFields } from "~/server/traces/edit-overlay/applyTraceEditOverlayToViews";
import type { TraceEditSpanField } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";
import { useSpanDetailCanonical } from "../../../hooks/useSpanDetail";
import { useAppliedTraceEditPatch } from "../../../hooks/useTraceEditOverlay";

/**
 * Which of the open span's fields a correction changed, plus the span exactly
 * as captured so each one can show what it replaced.
 *
 * Empty whenever the correction is not being applied, either because the
 * reader asked for the captured trace or because a new correction is being
 * written: there is nothing corrected on screen to mark in either case.
 */
export function useSpanCorrection(spanId: string): {
  changedFields: TraceEditSpanField[];
  captured: SpanDetail | undefined;
} {
  const patch = useAppliedTraceEditPatch();
  const capturedQuery = useSpanDetailCanonical();

  const changedFields = useMemo(
    () => (patch ? changedSpanFields({ patch, spanId }) : []),
    [patch, spanId],
  );

  return { changedFields, captured: capturedQuery.data };
}
