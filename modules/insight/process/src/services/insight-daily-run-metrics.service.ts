import type { InsightRunOutcome, InsightRunReason } from "@langwatch/insight-contract";
import {
  counter,
  type CounterHandle,
  histogram,
  type HistogramHandle,
} from "@langwatch/observability/metrics";

export const INSIGHT_DAILY_RUN_TOTAL_METRIC_NAME = "insight_daily_run_total";
export const INSIGHT_DAILY_RUN_DURATION_METRIC_NAME = "insight_daily_run_duration_milliseconds";

/** The `reason` of a run that ended with none: a label is never empty. */
const NO_REASON = "none";

/**
 * How daily runs end, pushed over OTLP: one count per recorded outcome and how long the run
 * took. The labels are the outcome and its reason alone, never a project, a person or a board.
 */
export class InsightDailyRunMetricsService {
  static create(): InsightDailyRunMetricsService {
    return new InsightDailyRunMetricsService(
      counter({
        name: INSIGHT_DAILY_RUN_TOTAL_METRIC_NAME,
        description: "Daily insights runs by outcome and reason",
      }),
      histogram({
        name: INSIGHT_DAILY_RUN_DURATION_METRIC_NAME,
        description: "Duration of one daily insights run, the wait for Langy included",
      }),
    );
  }

  private constructor(
    private readonly runs: CounterHandle,
    private readonly duration: HistogramHandle,
  ) {}

  /** A run that was lost and recorded by the one that replaced it has no duration to give. */
  settled({
    outcome,
    reason,
    durationMs,
  }: {
    outcome: InsightRunOutcome;
    reason: InsightRunReason | null;
    durationMs?: number;
  }): void {
    this.runs.inc({ outcome, reason: reason ?? NO_REASON });
    if (durationMs !== undefined) this.duration.observe(durationMs, { outcome });
  }
}
