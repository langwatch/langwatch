import type { SpanDetail, TraceEditSpanField } from "@langwatch/trace-contract";
import { useMemo } from "react";

import { useAppliedTraceEditPatch } from "../../../../../behavior/explorer/use-trace-edit-overlay.ts";
import { useSpanDetailCanonical } from "../../../../../features/span/behavior/use-span-detail.ts";
import { changedSpanFields } from "../../../../../model/traces/edit-overlay/apply-trace-edit-overlay-to-views.ts";

/**
 * Which of the open span's fields a correction changed, plus the span exactly as
 * captured so each one can show what it replaced.
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
