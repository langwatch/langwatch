import {
  TraceWindowedReadMetricsPort,
  type TraceWindowedReadOutcome,
} from "@langwatch/trace-server";
import { incrementWindowedReadCount } from "~/server/clickhouse/metrics";

/** App-owned bridge from Trace's persistence metric port to process metrics. */
export class AppTraceWindowedReadMetricsAdapter extends TraceWindowedReadMetricsPort {
  private constructor() {
    super();
  }

  static create(): AppTraceWindowedReadMetricsAdapter {
    return new AppTraceWindowedReadMetricsAdapter();
  }

  record(input: { table: string; outcome: TraceWindowedReadOutcome }): void {
    incrementWindowedReadCount(input.table, input.outcome);
  }
}
