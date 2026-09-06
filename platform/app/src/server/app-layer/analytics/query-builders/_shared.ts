/**
 * Internal helpers shared by the slim + rollup timeseries SQL builders
 * (ADR-034 Phase 3 app-layer module). Both builders need the same
 * `toStartOf…` bucket function over different time columns; centralising
 * keeps bucket boundaries identical between the two destination tables
 * (and identical to the legacy `trace_summaries` builder for parity).
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 31;

export function validateTimeZone(tz: string): string {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/**
 * Build a ClickHouse date-bucket function over a given column for a given
 * timeScale (in minutes) and timezone. Mirrors the legacy builder's logic
 * exactly so the bucket boundaries match the trace_summaries path.
 */
export function dateTrunc(
  column: string,
  timeScaleMinutes: number,
  timeZone: string,
): string {
  const tz = validateTimeZone(timeZone);
  if (timeScaleMinutes <= 1) {
    return `toStartOfMinute(${column}, '${tz}')`;
  } else if (timeScaleMinutes < MINUTES_PER_DAY) {
    if (timeScaleMinutes % MINUTES_PER_HOUR === 0) {
      const hours = timeScaleMinutes / MINUTES_PER_HOUR;
      return `toStartOfInterval(${column}, INTERVAL ${hours} HOUR, '${tz}')`;
    }
    return `toStartOfInterval(${column}, INTERVAL ${timeScaleMinutes} MINUTE, '${tz}')`;
  } else {
    const days = Math.floor(timeScaleMinutes / MINUTES_PER_DAY);
    if (days === 1) return `toStartOfDay(${column}, '${tz}')`;
    if (days <= DAYS_PER_WEEK)
      return `toStartOfInterval(${column}, INTERVAL ${days} DAY, '${tz}')`;
    if (days <= DAYS_PER_MONTH) return `toStartOfWeek(${column}, 1, '${tz}')`;
    return `toStartOfMonth(${column}, '${tz}')`;
  }
}

export function hasFilterValues(
  v:
    | string[]
    | Record<string, string[]>
    | Record<string, Record<string, string[]>>
    | undefined,
): boolean {
  if (v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v !== "object") return false;
  for (const inner of Object.values(v)) {
    if (Array.isArray(inner) && inner.length > 0) return true;
    if (typeof inner === "object" && inner !== null) {
      for (const vv of Object.values(inner)) {
        if (Array.isArray(vv) && vv.length > 0) return true;
      }
    }
  }
  return false;
}

export function collectStringValues(
  value:
    | string[]
    | Record<string, string[]>
    | Record<string, Record<string, string[]>>,
): string[] {
  if (Array.isArray(value)) return value;
  const out: string[] = [];
  for (const inner of Object.values(value)) {
    if (Array.isArray(inner)) {
      out.push(...inner);
      continue;
    }
    if (typeof inner === "object" && inner !== null) {
      for (const v of Object.values(inner)) {
        if (Array.isArray(v)) out.push(...v);
      }
    }
  }
  return out;
}

/**
 * Percentile aggregations recognised by both slim + eval-slim builders.
 * ClickHouse's `quantileExact(<level>)` takes a fraction in [0, 1].
 */
export function isPercentile(
  agg: "median" | "p90" | "p95" | "p99" | (string & {}),
): boolean {
  return agg === "median" || agg === "p90" || agg === "p95" || agg === "p99";
}

/**
 * Timeseries safety-net: when the (endDate - startDate) / timeScale bucket
 * count would exceed MAX_TIMESERIES_BUCKETS, or when `timeScale` is
 * undefined, coerce the query to a daily bucket so the response stays
 * bounded. Extracted from the analytics service + both legacy shims
 * (simp5012-003 — they were triplicated verbatim; drift would surface as
 * a false tripwire alarm).
 */
export const MAX_TIMESERIES_BUCKETS = 1000;
const MS_PER_MINUTE = 1000 * 60;

export function adjustTimeScaleForBucketCap(params: {
  timeScale: number | "full" | undefined;
  startDate: Date;
  endDate: Date;
}): number | "full" | undefined {
  const { timeScale, startDate, endDate } = params;
  if (typeof timeScale === "number") {
    const totalMinutes =
      (endDate.getTime() - startDate.getTime()) / MS_PER_MINUTE;
    const estimatedBuckets = totalMinutes / timeScale;
    if (estimatedBuckets > MAX_TIMESERIES_BUCKETS) {
      return MINUTES_PER_DAY;
    }
    return timeScale;
  }
  if (timeScale === undefined) {
    // Match the legacy default (daily granularity ⇔ ES 1d interval).
    return MINUTES_PER_DAY;
  }
  return timeScale;
}

export function percentileFor(agg: string): number {
  switch (agg) {
    case "median":
      return 0.5;
    case "p90":
      return 0.9;
    case "p95":
      return 0.95;
    case "p99":
      return 0.99;
    default:
      throw new Error(`Not a percentile aggregation: ${agg}`);
  }
}
