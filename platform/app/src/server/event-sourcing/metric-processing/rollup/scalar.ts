import type { CanonicalMetricDataPoint, MetricRollupRow } from "../schema";
import { addStats, type BucketEntry, resetOrGap } from "./row";
import { numberValue, previousPoint, startsNewSequence } from "./sequence";

export function buildGaugeRow(args: {
  row: MetricRollupRow;
  entries: BucketEntry[];
}): void {
  const { row, entries } = args;
  for (const { point } of entries) {
    const value = numberValue(point);
    addStats(row, value);
    // A valueless point (valueType "none") must not clobber the last
    // observed gauge value — but a genuine 0 reading (numberValue returns
    // 0, not null) always does, exactly like any other value.
    if (value !== null) row.gaugeLast = value;
  }
}

export function buildSumRow(args: {
  row: MetricRollupRow;
  entries: BucketEntry[];
  all: CanonicalMetricDataPoint[];
}): void {
  const { row, entries, all } = args;
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
      point.isMonotonic === true &&
      previousValue !== null &&
      current < previousValue;
    if (starts || decreased || previousValue === null) {
      resetOrGap({ row, previous, current: point });
      addStats(row, current);
    } else {
      addStats(row, current - previousValue);
    }
  }
}
