import { type NormalizedSpan, type TraceSummaryData } from "@langwatch/trace-contract";
import { isValidTimestamp } from "./span-timing.rules";

const SYNTHETIC_SPAN_NAMES: ReadonlySet<string> = new Set(["langwatch.track_event"]);

/**
 * Accumulates trace-level timing from individual spans.
 *
 * Computes the earliest `occurredAt` and the total wall-clock duration
 * that covers all spans seen so far.
 */
export class SpanTimingService {
  private constructor() {}

  static create(): SpanTimingService {
    return new SpanTimingService();
  }

  accumulateTiming({ state, span }: { state: TraceSummaryData; span: NormalizedSpan }): {
    occurredAt: number;
    totalDurationMs: number;
  } {
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
    const currentEnd = state.occurredAt > 0 ? state.occurredAt + state.totalDurationMs : 0;
    const totalDurationMs = Math.max(currentEnd, span.endTimeUnixMs) - occurredAt;

    return { occurredAt, totalDurationMs };
  }
}
