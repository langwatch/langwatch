import type {
  CanonicalMetricDataPoint,
  MetricRollupRow,
} from "../schemas/metricDataPoint";
import { resetOrGap, type BucketEntry } from "./row";
import { bigint, previousPoint, startsNewSequence } from "./sequence";

/**
 * OTLP summaries are cumulative even though they carry no temporality field.
 * Count and sum become interval deltas; quantiles are not aggregatable and so
 * never enter a rollup.
 */
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
    const currentCount = bigint(point.count);
    const previous = previousPoint(all, index);
    const starts = startsNewSequence(previous, point);
    const compatible = previous?.metricKind === "summary";
    const previousCount = compatible ? bigint(previous.count) : 0n;
    const countDelta = currentCount - previousCount;
    if (!compatible || starts || countDelta < 0n) {
      resetOrGap({ row, previous, current: point });
      count += currentCount;
      if (point.sum !== null) {
        sum += point.sum;
        hasSum = true;
      }
    } else {
      count += countDelta;
      if (point.sum !== null && previous.sum !== null) {
        sum += point.sum - previous.sum;
        hasSum = true;
      }
    }
  }

  row.count = count.toString();
  row.sum = hasSum ? sum : null;
}
