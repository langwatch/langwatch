/**
 * The online-evaluation results the seven-day trend is folded from.
 *
 * A ClickHouse read the process routes and composes; this feature states only
 * what it asks for. `previousPeriodStartMs` is resolved by the process too,
 * from the same helper the analytics page uses, so the comparison covers the
 * exact runs a reader sees when they open analytics.
 */
import type {
  MonitorPerformanceQuery,
  OnlineEvaluationPerformance,
} from "@langwatch/evaluation-contract";

export abstract class MonitorPerformancePort {
  abstract getMonitorPerformance(
    query: MonitorPerformanceQuery,
  ): Promise<OnlineEvaluationPerformance[]>;

  /** The start of the window the trend compares against. */
  abstract previousPeriodStartMs(
    range: Readonly<{ projectId: string; startMs: number; endMs: number }>,
  ): number;
}
