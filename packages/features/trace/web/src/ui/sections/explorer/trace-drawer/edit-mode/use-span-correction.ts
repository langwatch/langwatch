import { useMemo } from "react";
import type { SpanDetail } from "@langwatch/trace-contract";
import { changedSpanFields } from "../../../../../model/traces/edit-overlay/apply-trace-edit-overlay-to-views";
import type { TraceEditSpanField } from "@langwatch/trace-contract";
import { useSpanDetailCanonical } from "../../hooks/use-span-detail";
import { useAppliedTraceEditPatch } from "../../hooks/use-trace-edit-overlay";

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
