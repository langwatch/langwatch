import {
  accumulateSpanTiming,
  type NormalizedSpan,
  type TraceSummaryData,
} from "@langwatch/trace-contract";

/**
 * Accumulates trace-level timing from individual spans: the earliest
 * `occurredAt` and the total wall-clock duration covering all spans seen
 * so far. The rule is the contract's `accumulateSpanTiming`.
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
    return accumulateSpanTiming({ state, span });
  }
}
