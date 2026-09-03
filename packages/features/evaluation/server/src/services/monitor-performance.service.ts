/**
 * The monitors page's seven-day trend, and nothing else.
 *
 * Split out of {@link EvaluationService} for the reason
 * `ClickHouseEvaluationRepository`'s own export comment gives about the runs
 * read: a caller that wants ONE read must not have to synthesise an evaluator
 * executor, an input resolver and a whole workflow capability it never
 * touches. The API process is exactly that caller — the monitors surface asks
 * for a trend and never executes an evaluation — so what it composes is this,
 * not the service around it.
 *
 * The SUMMARY lives here rather than at the caller. Which bucket counts
 * towards a guardrail's pass rate and which towards an evaluator's mean score,
 * and what an empty window answers, are facts about what the trend MEANS; a
 * process that folded the buckets itself would be a second definition of the
 * number a customer reads.
 */
import {
  monitorPerformanceQuerySchema,
  onlineEvaluationPerformanceSchema,
  type MonitorPerformanceQuery,
  type OnlineEvaluationPerformance,
} from "@langwatch/evaluation-contract";
import type {
  MonitorPerformanceBucket,
  MonitorPerformanceRepository,
} from "../repositories/monitor-performance.repository";

export class MonitorPerformanceService {
  static create(options: { repository: MonitorPerformanceRepository }): MonitorPerformanceService {
    return new MonitorPerformanceService(options.repository);
  }

  private constructor(private readonly repository: MonitorPerformanceRepository) {}

  /** The current and previous window for each monitor, as the page charts them. */
  async getMonitorPerformance(
    input: MonitorPerformanceQuery,
  ): Promise<OnlineEvaluationPerformance[]> {
    const query = monitorPerformanceQuerySchema.parse(input);
    const buckets = await this.repository.findBuckets({
      tenantId: query.tenantId,
      evaluatorIds: query.monitors.map((monitor) => monitor.id),
      previousStartMs: query.previousStartMs,
      currentStartMs: query.currentStartMs,
      endMs: query.endMs,
      timeZone: query.timeZone,
    });

    return this.summarize(query.monitors, buckets).map((value) =>
      onlineEvaluationPerformanceSchema.parse(value),
    );
  }

  private summarize(
    monitors: MonitorPerformanceQuery["monitors"],
    buckets: MonitorPerformanceBucket[],
  ): OnlineEvaluationPerformance[] {
    const bucketsByEvaluator = new Map<string, MonitorPerformanceBucket[]>();
    for (const bucket of buckets) {
      const evaluatorBuckets = bucketsByEvaluator.get(bucket.evaluatorId) ?? [];
      evaluatorBuckets.push(bucket);
      bucketsByEvaluator.set(bucket.evaluatorId, evaluatorBuckets);
    }

    return monitors.map((monitor) => {
      const monitorBuckets = bucketsByEvaluator.get(monitor.id) ?? [];
      const current = monitorBuckets
        .filter((bucket) => bucket.period === "current")
        .map((bucket) => this.metricTotal(bucket, monitor.isGuardrail));
      const previous = monitorBuckets
        .filter((bucket) => bucket.period === "previous")
        .map((bucket) => this.metricTotal(bucket, monitor.isGuardrail));

      return {
        monitorId: monitor.id,
        metric: monitor.isGuardrail ? "pass_rate" : "score",
        points: current.filter((total) => total.count > 0).map((total) => total.sum / total.count),
        current: this.average(current),
        previous: this.average(previous),
      };
    });
  }

  private metricTotal(
    bucket: MonitorPerformanceBucket,
    isGuardrail: boolean,
  ): { sum: number; count: number } {
    return isGuardrail
      ? { sum: bucket.passSum, count: bucket.passCount }
      : { sum: bucket.scoreSum, count: bucket.scoreCount };
  }

  private average(totals: Array<{ sum: number; count: number }>): number | null {
    const sum = totals.reduce((value, total) => value + total.sum, 0);
    const count = totals.reduce((value, total) => value + total.count, 0);

    return count > 0 ? sum / count : null;
  }
}
