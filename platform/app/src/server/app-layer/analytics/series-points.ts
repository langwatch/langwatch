import type { TimeseriesBucket } from "~/server/analytics/types";

/**
 * Reading numeric points back out of a `TimeseriesResult`.
 *
 * A timeseries bucket is a date plus one entry per requested series, keyed by
 * the `buildSeriesName` encoding (`{index}/{metric}/{agg}[/{key}]`). When the
 * query carries a `groupBy`, the values nest one level deeper instead:
 *
 *   { [groupBy]: { [groupKey]: { [seriesKey]: number } } }
 *
 * Both the graph-alert evaluator (which needs a single series' history to
 * compare against a threshold) and scheduled reports (which need every series
 * on a graph to draw a chart) read buckets this way, so the readers live here
 * rather than inside either caller.
 *
 * A single value per bucket is read from an UNGROUPED result. Per-group values
 * cannot be added back into one: that sums averages, percentiles, minimums and
 * maximums, and counts a row once per group for an array grouping. A reader
 * that needs one value per bucket queries without `groupBy` instead.
 */

export interface SeriesPoint {
  timestamp: string;
  value: number;
}

/**
 * Read one series' per-bucket values out of an ungrouped timeseries period.
 * Buckets missing the key contribute 0, matching the cron's long-standing
 * `calculateCurrentValue` behaviour.
 */
export function extractSeriesPoints(
  dataPoints: TimeseriesBucket[],
  bucketKey: string,
): SeriesPoint[] {
  return dataPoints.map((entry) => {
    const value = entry[bucketKey];
    return {
      timestamp: entry.date,
      value: typeof value === "number" ? value : 0,
    };
  });
}

/**
 * Collapse a grouped period into one total per group — the shape a pie chart
 * needs. Groups are returned largest-first so a caller that caps the segment
 * count keeps the segments that matter. Empty when the period is ungrouped.
 */
export function extractGroupTotals(
  dataPoints: TimeseriesBucket[],
  bucketKey: string,
  groupBy: string,
): Array<{ label: string; value: number }> {
  const totals = new Map<string, number>();
  for (const entry of dataPoints) {
    const groups = groupsOf(entry, groupBy);
    if (!groups) continue;
    for (const [label, metrics] of Object.entries(groups)) {
      const value = metrics[bucketKey];
      if (typeof value !== "number") continue;
      totals.set(label, (totals.get(label) ?? 0) + value);
    }
  }
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Window aggregation matching the cron's behaviour: additive aggregations sum
 * across buckets, everything else averages. `bucketCount` is the raw period
 * length, which preserves the cron's "no buckets at all → 0".
 */
export function aggregateSeriesValues(
  values: number[],
  aggregation: string,
  bucketCount: number,
): number {
  if (bucketCount === 0 || values.length === 0) return 0;
  if (
    aggregation === "cardinality" ||
    aggregation === "terms" ||
    aggregation === "count"
  ) {
    return values.reduce((a, b) => a + b, 0);
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function groupsOf(
  entry: TimeseriesBucket,
  groupBy: string,
): Record<string, Record<string, number>> | undefined {
  const groupData = entry[groupBy];
  if (
    typeof groupData !== "object" ||
    groupData === null ||
    Array.isArray(groupData)
  ) {
    return undefined;
  }
  return groupData as Record<string, Record<string, number>>;
}
