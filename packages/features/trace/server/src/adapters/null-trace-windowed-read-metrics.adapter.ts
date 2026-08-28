import {
  TraceWindowedReadMetricsPort,
  type TraceWindowedReadOutcome,
} from "../ports/trace-windowed-read-metrics.port";

/** Discards windowed-read outcomes where the process reports no metrics. */
export class NullTraceWindowedReadMetricsAdapter extends TraceWindowedReadMetricsPort {
  record(_input: { table: string; outcome: TraceWindowedReadOutcome }): void {
    void _input;
  }
}
