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

/** One label and how much of the period it accounted for. */
export interface LabelShare {
  label: string;
  count: number;
  /** Fraction of the period's labelled results, 0 to 1. */
  share: number;
}

interface AveragedPerformance {
  monitorId: string;
  metric: "score" | "pass_rate";
  points: number[];
  current: number | null;
  previous: number | null;
}

interface LabelPerformance {
  monitorId: string;
  metric: "label";
  /** Ordered by how often each label occurred, most common first. */
  labels: LabelShare[];
  /** The leading label's share of the current period. */
  current: number | null;
  /** That same label's share of the previous period, or null if it had none. */
  previous: number | null;
}

export type OnlineEvaluationPerformance =
  | AveragedPerformance
  | LabelPerformance;

/**
 * How many labels the list's strip names before the tail is grouped.
 *
 * A strip 112 pixels wide stops being readable well before this, and a
 * classifier with a long tail would otherwise turn the column into a row of
 * slivers nobody can hit or read.
 */
const MAX_LABELS_SHOWN = 5;

/** The name the grouped tail is given. */
const OTHER_LABEL = "Other";

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

const bucketsIn = ({
  buckets,
  period,
}: {
  buckets: MonitorPerformanceBucket[];
  period: MonitorPerformancePeriod;
}): MonitorPerformanceBucket[] =>
  buckets.filter((bucket) => bucket.period === period);

const periodTotals = ({
  buckets,
  period,
  isGuardrail,
}: {
  buckets: MonitorPerformanceBucket[];
  period: MonitorPerformancePeriod;
  isGuardrail: boolean;
}): MetricTotal[] =>
  bucketsIn({ buckets, period }).map((bucket) =>
    totalFor({ bucket, isGuardrail }),
  );

/** Every label the period produced, and how often, across its days. */
const countLabels = (buckets: MonitorPerformanceBucket[]) => {
  const counts = new Map<string, number>();
  for (const bucket of buckets) {
    for (const [label, count] of Object.entries(bucket.labelCounts)) {
      counts.set(label, (counts.get(label) ?? 0) + count);
    }
  }
  return counts;
};

const sumOf = (counts: Map<string, number>): number =>
  [...counts.values()].reduce((total, count) => total + count, 0);

/**
 * The period's labels as shares, most common first, with everything past the
 * strip's capacity grouped so the shares still add up to the whole period.
 */
const toLabelShares = (counts: Map<string, number>): LabelShare[] => {
  const total = sumOf(counts);
  if (total === 0) return [];

  const ordered = [...counts.entries()].sort(
    ([leftLabel, leftCount], [rightLabel, rightCount]) =>
      rightCount - leftCount || leftLabel.localeCompare(rightLabel),
  );
  const shown = ordered.slice(0, MAX_LABELS_SHOWN);
  const remainder = ordered.slice(MAX_LABELS_SHOWN);

  const shares: LabelShare[] = shown.map(([label, count]) => ({
    label,
    count,
    share: count / total,
  }));

  if (remainder.length > 0) {
    const count = remainder.reduce((sum, [, value]) => sum + value, 0);
    shares.push({ label: OTHER_LABEL, count, share: count / total });
  }

  return shares;
};

/**
 * Whether this monitor's results can only be read as labels.
 *
 * A guardrail is always its pass rate, and a scoring evaluator is always its
 * score, even in a period where it happened to produce neither. Labels are
 * the reading of last resort, which is exactly the case a classifier is in:
 * every result carries one and nothing else.
 */
const readsAsLabels = ({
  buckets,
  isGuardrail,
}: {
  buckets: MonitorPerformanceBucket[];
  isGuardrail: boolean;
}): boolean => {
  if (isGuardrail) return false;
  const hasAverage = buckets.some((bucket) => bucket.scoreCount > 0);
  if (hasAverage) return false;
  return buckets.some((bucket) => Object.keys(bucket.labelCounts).length > 0);
};

const summarizeLabels = ({
  monitorId,
  buckets,
}: {
  monitorId: string;
  buckets: MonitorPerformanceBucket[];
}): LabelPerformance => {
  const labels = toLabelShares(
    countLabels(bucketsIn({ buckets, period: "current" })),
  );
  const leading = labels[0];

  const previousCounts = countLabels(
    bucketsIn({ buckets, period: "previous" }),
  );
  const previousTotal = sumOf(previousCounts);
  // A label absent from a period that HAD results held none of it, which is a
  // real reading of zero. A period with no results at all supports no
  // comparison, so it stays null and the row says so.
  const previous =
    leading && previousTotal > 0
      ? (previousCounts.get(leading.label) ?? 0) / previousTotal
      : null;

  return {
    monitorId,
    metric: "label",
    labels,
    current: leading?.share ?? null,
    previous,
  };
};

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

    if (
      readsAsLabels({
        buckets: monitorBuckets,
        isGuardrail: monitor.isGuardrail,
      })
    ) {
      return summarizeLabels({
        monitorId: monitor.id,
        buckets: monitorBuckets,
      });
    }

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
