import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";

/**
 * Validates whether a timestamp value is usable (positive, finite number).
 */
export const isValidTimestamp = (ts: number | undefined | null): ts is number =>
  typeof ts === "number" && ts > 0 && Number.isFinite(ts);

/** Span names that represent synthetic events, not real execution, and must be excluded from timing. */
const SYNTHETIC_SPAN_NAMES = new Set(["langwatch.track_event"]);

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
