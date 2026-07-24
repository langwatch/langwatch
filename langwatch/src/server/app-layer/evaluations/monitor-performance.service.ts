import type {
  FindMonitorPerformanceParams,
  MonitorPerformanceBucket,
  MonitorPerformancePeriod,
  MonitorPerformanceRepository,
} from "./repositories/monitor-performance.repository";

export interface PerformanceMonitor {
  id: string;
  isGuardrail: boolean;
}

export interface OnlineEvaluationPerformance {
  monitorId: string;
  metric: "score" | "pass_rate";
  points: number[];
  current: number | null;
  previous: number | null;
}

interface MetricTotal {
  sum: number;
  count: number;
}

const totalFor = ({
  bucket,
  isGuardrail,
}: {
  bucket: MonitorPerformanceBucket;
  isGuardrail: boolean;
}): MetricTotal =>
  isGuardrail
    ? { sum: bucket.passSum, count: bucket.passCount }
    : { sum: bucket.scoreSum, count: bucket.scoreCount };

const average = (totals: MetricTotal[]): number | null => {
  const sum = totals.reduce((value, total) => value + total.sum, 0);
  const count = totals.reduce((value, total) => value + total.count, 0);
  return count > 0 ? sum / count : null;
};

const periodTotals = ({
  buckets,
  period,
  isGuardrail,
}: {
  buckets: MonitorPerformanceBucket[];
  period: MonitorPerformancePeriod;
  isGuardrail: boolean;
}): MetricTotal[] =>
  buckets
    .filter((bucket) => bucket.period === period)
    .map((bucket) => totalFor({ bucket, isGuardrail }));

export const summarizeMonitorPerformance = ({
  monitors,
  buckets,
}: {
  monitors: PerformanceMonitor[];
  buckets: MonitorPerformanceBucket[];
}): OnlineEvaluationPerformance[] => {
  const bucketsByEvaluator = new Map<string, MonitorPerformanceBucket[]>();
  for (const bucket of buckets) {
    const evaluatorBuckets = bucketsByEvaluator.get(bucket.evaluatorId) ?? [];
    evaluatorBuckets.push(bucket);
    bucketsByEvaluator.set(bucket.evaluatorId, evaluatorBuckets);
  }

  return monitors.map((monitor) => {
    const monitorBuckets = bucketsByEvaluator.get(monitor.id) ?? [];
    const currentTotals = periodTotals({
      buckets: monitorBuckets,
      period: "current",
      isGuardrail: monitor.isGuardrail,
    });
    const previousTotals = periodTotals({
      buckets: monitorBuckets,
      period: "previous",
      isGuardrail: monitor.isGuardrail,
    });

    return {
      monitorId: monitor.id,
      metric: monitor.isGuardrail ? "pass_rate" : "score",
      points: currentTotals
        .filter((total) => total.count > 0)
        .map((total) => total.sum / total.count),
      current: average(currentTotals),
      previous: average(previousTotals),
    };
  });
};

export class MonitorPerformanceService {
  constructor(private readonly repository: MonitorPerformanceRepository) {}

  async getPerformance({
    monitors,
    ...query
  }: Omit<FindMonitorPerformanceParams, "evaluatorIds"> & {
    monitors: PerformanceMonitor[];
  }): Promise<OnlineEvaluationPerformance[]> {
    const buckets = await this.repository.findBuckets({
      ...query,
      evaluatorIds: monitors.map((monitor) => monitor.id),
    });
    return summarizeMonitorPerformance({ monitors, buckets });
  }
}
