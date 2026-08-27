import type {
  CanonicalMetricDataPoint,
  MetricRollupRow,
} from "../schemas/metric-processing/metric-data-point";
import { addStats, type BucketEntry, resetOrGap } from "./rollup-row";
import { numberValue, previousPoint, startsNewSequence } from "./sequence";

function buildGaugeRow({ row, entries }: { row: MetricRollupRow; entries: BucketEntry[] }): void {
  for (const { point } of entries) {
    const value = numberValue(point);
    addStats(row, value);
    // A valueless point must not clobber the last observed gauge value.
    if (value !== null) row.gaugeLast = value;
  }
}

function buildSumRow({
  row,
  entries,
  all,
}: {
  row: MetricRollupRow;
  entries: BucketEntry[];
  all: CanonicalMetricDataPoint[];
}): void {
  for (const { point, index } of entries) {
    const current = numberValue(point);
    if (current === null) continue;
    if (point.aggregationTemporality !== "cumulative") {
      addStats(row, current);
      continue;
    }
    const previous = previousPoint(all, index);
    const starts = startsNewSequence(previous, point);
    const previousValue = previous ? numberValue(previous) : null;
    const decreased =
      point.isMonotonic === true && previousValue !== null && current < previousValue;
    if (starts || decreased || previousValue === null) {
      resetOrGap({ row, previous, current: point });
      addStats(row, current);
    } else {
      addStats(row, current - previousValue);
    }
  }
}

export { buildGaugeRow, buildSumRow };
