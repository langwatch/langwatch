import type { InsightRunOutcome, InsightRunReason } from "@langwatch/insight-contract";
import {
  counter,
  type CounterHandle,
  histogram,
  type HistogramHandle,
} from "@langwatch/observability/metrics";

export const INSIGHT_DAILY_RUN_TOTAL_METRIC_NAME = "insight_daily_run_total";
export const INSIGHT_DAILY_RUN_DURATION_METRIC_NAME = "insight_daily_run_duration_milliseconds";
export const INSIGHT_BOARD_HEALTH_CHECK_METRIC_NAME = "insight_board_health_check_total";

/** What the board check counts: each widget's health, or `off` once for a check run nowhere. */
export type BoardHealthCheckResult =
  | "healthy"
  | "error"
  | "no_data"
  | "platform"
  | "unchecked"
  | "off";

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
      counter({
        name: INSIGHT_BOARD_HEALTH_CHECK_METRIC_NAME,
        description: "Widgets the daily run's board check read, by result",
      }),
    );
  }

  private constructor(
    private readonly runs: CounterHandle,
    private readonly duration: HistogramHandle,
    private readonly boardHealth: CounterHandle,
  ) {}

  /** Labelled by the result alone, never a project, a person, a board or a widget. */
  boardHealthChecked({ result }: { result: BoardHealthCheckResult }): void {
    this.boardHealth.inc({ result });
  }

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
