import type {
  CanonicalMetricDataPoint,
  MetricRollupRow,
} from "../schemas/metricDataPoint";
import { type BucketEntry, resetOrGap } from "./row";
import { bigint, previousPoint, startsNewSequence } from "./sequence";

/**
 * OTLP summaries are cumulative even though they carry no temporality field.
 * Count and sum become interval deltas; quantiles are not aggregatable and so
 * never enter a rollup.
 */
function resolveSummaryPointContribution({
  row,
  point,
  index,
  all,
}: {
  row: MetricRollupRow;
  point: CanonicalMetricDataPoint;
  index: number;
  all: CanonicalMetricDataPoint[];
}): { count: bigint; sum: number | null } {
  const currentCount = bigint(point.count);
  const previous = previousPoint(all, index);
  const starts = startsNewSequence(previous, point);
  const compatible = previous?.metricKind === "summary";
  const previousCount = compatible ? bigint(previous.count) : 0n;
  const countDelta = currentCount - previousCount;
  if (!compatible || starts || countDelta < 0n) {
    resetOrGap({ row, previous, current: point });
    return { count: currentCount, sum: point.sum };
  }
  return {
    count: countDelta,
    sum:
      point.sum !== null && previous.sum !== null
        ? point.sum - previous.sum
        : null,
  };
}

export function buildSummaryRow({
  row,
  entries,
  all,
}: {
  row: MetricRollupRow;
  entries: BucketEntry[];
  all: CanonicalMetricDataPoint[];
}): void {
  let count = 0n;
  let sum = 0;
  let hasSum = false;

  for (const { point, index } of entries) {
    const contribution = resolveSummaryPointContribution({
      row,
      point,
      index,
      all,
    });
    count += contribution.count;
    if (contribution.sum !== null) {
      sum += contribution.sum;
      hasSum = true;
    }
  }

  row.count = count.toString();
  row.sum = hasSum ? sum : null;
}
