import {
  TraceWindowedReadMetrics,
  type TraceWindowedReadOutcome,
} from "../../app/trace.infrastructure.ts";

/** Discards windowed-read outcomes where the process reports no metrics. */
export class NullTraceWindowedReadMetricsAdapter implements TraceWindowedReadMetrics {
  static create(): NullTraceWindowedReadMetricsAdapter {
    return new NullTraceWindowedReadMetricsAdapter();
  }

  record(_input: { table: string; outcome: TraceWindowedReadOutcome }): void {
    void _input;
  }
}
