import type { AnalyticsEvaluationReadMetrics } from "@langwatch/analytics-contract";
import { incrementWindowedReadCount } from "~/server/clickhouse/metrics";

/** App transport adapter for the shared ClickHouse windowed-read metric. */
export class AppEvaluationAnalyticsReadMetrics implements AnalyticsEvaluationReadMetrics {
  static create(): AppEvaluationAnalyticsReadMetrics {
    return new AppEvaluationAnalyticsReadMetrics();
  }

  private constructor() {}

  record(input: {
    table: "evaluation_analytics";
    outcome: "hit" | "windowed_empty" | "unwindowed" | "error";
  }): void {
    incrementWindowedReadCount(input.table, input.outcome);
  }
}
