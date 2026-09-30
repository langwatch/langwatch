import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { SYNTHETIC_SPAN_NAMES } from "~/server/tracer/constants";
import type { NormalizedSpan } from "../../schemas/spans";
import { isStorableSpanTimeMs } from "../../utils/storableSpanTime";

/**
 * Validates whether a timestamp value is usable: an epoch-ms instant storage can
 * actually hold. Delegates to {@link isStorableSpanTimeMs} so "usable timing" and
 * "storable time" are one rule — a value past the `DateTime64(3)` ceiling is no
 * more usable as `min(start)` / `max(end)` than it is as a stored column, and
 * `TraceSummaryData.occurredAt` accumulated here is what the trace summary's own
 * KSUID is minted from downstream.
 */
export const isValidTimestamp = (ts: number | undefined | null): ts is number =>
  isStorableSpanTimeMs(ts);

/**
 * Accumulates trace-level timing from individual spans.
 *
 * Computes the earliest `occurredAt` and the total wall-clock duration
 * that covers all spans seen so far.
 */
export class SpanTimingService {
  accumulateTiming({
    state,
    span,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
  }): { occurredAt: number; totalDurationMs: number } {
    if (
      SYNTHETIC_SPAN_NAMES.has(span.name) ||
      !isValidTimestamp(span.startTimeUnixMs) ||
      !isValidTimestamp(span.endTimeUnixMs)
    ) {
      return {
        occurredAt: state.occurredAt,
        totalDurationMs: state.totalDurationMs,
      };
    }

    const occurredAt =
      state.occurredAt > 0
        ? Math.min(state.occurredAt, span.startTimeUnixMs)
        : span.startTimeUnixMs;
    const currentEnd =
      state.occurredAt > 0 ? state.occurredAt + state.totalDurationMs : 0;
    const totalDurationMs =
      Math.max(currentEnd, span.endTimeUnixMs) - occurredAt;

    return { occurredAt, totalDurationMs };
  }
}
