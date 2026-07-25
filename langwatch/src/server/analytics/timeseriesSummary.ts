// The single canonical encoder for `getTimeseries` bucket keys (ADR-034
// app-layer module). Reused, not re-implemented, so every reader stays tied to
// how the app-layer wrote the value. Pure helper; safe client-side.
import { buildSeriesName } from "../app-layer/analytics/repositories/_timeseries-row-parser";
import type { SeriesInputType } from "./registry";
import type { TimeseriesBucket } from "./types";

/**
 * Reads one series' value back out of a `getTimeseries` `currentPeriod`. The
 * lookup key is derived from `buildSeriesName` (`{index}/{metric}/{aggregation}`,
 * `index` = the series' position in the request) rather than re-spelled at the
 * call site, so it cannot drift and reordering the request's series cannot
 * silently swap two numbers. Returns `undefined` when that metric never appears
 * in any bucket, so a missing signal degrades to an omitted cell rather than a
 * fabricated 0. With `timeScale: "full"` there is a single bucket, so the sum is
 * a passthrough of that one value.
 */
export function readSummaryMetric({
  buckets,
  series,
  metric,
  aggregation,
}: {
  buckets: TimeseriesBucket[] | undefined;
  series: SeriesInputType[];
  metric: string;
  aggregation: string;
}): number | undefined {
  if (!buckets) return undefined;
  const index = series.findIndex(
    (s) => s.metric === metric && s.aggregation === aggregation,
  );
  if (index < 0) return undefined;
  const key = buildSeriesName(series[index]!, index);
  let sum = 0;
  let seen = false;
  for (const bucket of buckets) {
    const raw = bucket[key];
    if (typeof raw === "number") {
      sum += raw;
      seen = true;
    }
  }
  return seen ? sum : undefined;
}
