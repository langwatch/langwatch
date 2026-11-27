import type { Authorization } from "@langwatch/authorization";

import type {
  LiveTraceEvaluationAnalyticsRow,
  TraceEvaluationAnalyticsWrite,
} from "../rules/trace-evaluation-analytics.rules.ts";

/** Private persistence capability for the trace_evaluation_analytics collapsing table. */
export abstract class TraceEvaluationAnalyticsRepository {
  /** Inserts one tenant's retractions and states; a batch mixing tenants is refused. */
  abstract insertRows(input: { writes: readonly TraceEvaluationAnalyticsWrite[] }): Promise<void>;

  /**
   * The traces' row groups whose signs do not sum to zero, read through the proof's fence; each
   * group's signSum shows an orphan or doubled row. `occurredAtFromMs` bounds the evaluation
   * time, so the read prunes partitions.
   */
  abstract findLiveRows(input: {
    authorization: Authorization;
    traceIds: readonly string[];
    occurredAtFromMs: number;
  }): Promise<LiveTraceEvaluationAnalyticsRow[]>;
}
