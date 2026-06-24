/**
 * Shared row-parser for the slim + rollup ClickHouse timeseries reads
 * (ADR-034 Phase 3 app-layer module).
 *
 * Both repositories run the same query SHAPE — period / date / group_key
 * columns + one column per series alias — and emit the same `TimeseriesResult`
 * format the frontend consumes. The parsing logic was previously inlined in
 * `ClickHouseAnalyticsService.parseTimeseriesResults`; pulled out here so both
 * new repositories produce identical bucket shapes (which keeps the tripwire
 * comparison apples-to-apples).
 */

import { buildMetricAlias } from "~/server/analytics/clickhouse/metric-translator";
import type { SeriesInputType } from "~/server/analytics/registry";
import type {
  TimeseriesBucket,
  TimeseriesResult,
} from "~/server/analytics/types";

/**
 * Wire shape of a single row coming back from JSONEachRow for the slim /
 * rollup timeseries queries. ClickHouse fills in:
 *   - `period`: literal `"current" | "previous"` from the CASE clause
 *   - `date`: optional bucket boundary string when the query carries a
 *     `toStartOf…` expression; absent on `timeScale === undefined` and
 *     replaced with `"full"` on `timeScale === "full"` by the parser.
 *   - `group_key`: optional bucket key string when the query has GROUP BY
 *     on a dimension column.
 *   - One numeric (or null) column per series alias (`buildMetricAlias`).
 *
 * Kept as an indexed type because the series alias is dynamic — `unknown`
 * downstream is narrowed by the per-cell `typeof === "number" | "string"`
 * check before coercion via `Number()`.
 */
export interface AnalyticsTimeseriesRow {
  period?: "current" | "previous" | string;
  date?: string;
  group_key?: string | number | null;
  [aliasOrUnknownColumn: string]: unknown;
}

export interface ParseTimeseriesRowsParams {
  readonly rows: readonly AnalyticsTimeseriesRow[];
  readonly series: readonly SeriesInputType[];
  readonly groupBy?: string;
  readonly timeScale?: number | "full";
}

export function parseTimeseriesRows(
  params: ParseTimeseriesRowsParams,
): TimeseriesResult {
  const { rows, series, groupBy, timeScale } = params;

  const bucketMap: {
    previous: Map<string, TimeseriesBucket>;
    current: Map<string, TimeseriesBucket>;
  } = { previous: new Map(), current: new Map() };

  for (const row of rows) {
    const period = typeof row.period === "string" ? row.period : "";
    const dateKey =
      timeScale === "full"
        ? "full"
        : typeof row.date === "string"
          ? row.date
          : new Date().toISOString();

    const targetMap =
      period === "current" ? bucketMap.current : bucketMap.previous;
    let bucket = targetMap.get(dateKey);
    if (!bucket) {
      bucket = { date: dateKey };
      targetMap.set(dateKey, bucket);
    }

    if (groupBy && row.group_key !== undefined && row.group_key !== null) {
      const groupKey = String(row.group_key);
      if (!bucket[groupBy]) bucket[groupBy] = {};
      const groupData = bucket[groupBy] as Record<
        string,
        Record<string, number>
      >;
      if (!groupData[groupKey]) groupData[groupKey] = {};

      for (let i = 0; i < series.length; i++) {
        const s = series[i]!;
        const alias = buildMetricAlias(
          i,
          s.metric,
          s.aggregation,
          s.key,
          s.subkey,
        );
        const seriesName = buildSeriesName(s, i);
        const coerced = coerceNumber(row[alias]);
        if (coerced !== null) groupData[groupKey]![seriesName] = coerced;
      }
    } else {
      for (let i = 0; i < series.length; i++) {
        const s = series[i]!;
        const alias = buildMetricAlias(
          i,
          s.metric,
          s.aggregation,
          s.key,
          s.subkey,
        );
        const seriesName = buildSeriesName(s, i);
        const coerced = coerceNumber(row[alias]);
        if (coerced !== null) bucket[seriesName] = coerced;
      }
    }
  }

  const previousPeriod: TimeseriesBucket[] = [];
  for (const [_, bucket] of Array.from(bucketMap.previous.entries()).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    previousPeriod.push(bucket);
  }
  const currentPeriod: TimeseriesBucket[] = [];
  for (const [_, bucket] of Array.from(bucketMap.current.entries()).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    currentPeriod.push(bucket);
  }

  // Correction when previous has more buckets than current.
  const correctedPrevious = previousPeriod.slice(
    Math.max(0, previousPeriod.length - currentPeriod.length),
  );

  normalizeMetricKeys(correctedPrevious, currentPeriod, groupBy);

  return { previousPeriod: correctedPrevious, currentPeriod };
}

/** Build the result key name that matches the ES-shaped frontend contract. */
function buildSeriesName(series: SeriesInputType, index: number): string {
  const aggregation =
    series.aggregation === "terms" ? "cardinality" : series.aggregation;
  if (series.pipeline) {
    return `${index}/${series.metric}/${aggregation}/${series.pipeline.field}/${series.pipeline.aggregation}`;
  }
  if (series.key) {
    return `${index}/${series.metric}/${aggregation}/${series.key}`;
  }
  return `${index}/${series.metric}/${aggregation}`;
}

/**
 * Normalise metric keys across both periods. Ensures every bucket carries
 * every metric (with a 0 default) so the frontend can compute % change for
 * series that ClickHouse returned NULL for in one of the periods.
 *
 * Grouped: only fill in missing metric sub-keys for groups already present in
 * a bucket — do NOT spawn new groups from the other period, that would bleed
 * stale dimension values across periods.
 */
function normalizeMetricKeys(
  previousPeriod: TimeseriesBucket[],
  currentPeriod: TimeseriesBucket[],
  groupBy?: string,
): void {
  const allMetricKeys = new Set<string>();
  const allGroupedMetricSubKeys = new Set<string>();

  for (const bucket of [...previousPeriod, ...currentPeriod]) {
    for (const key of Object.keys(bucket)) {
      if (key === "date") continue;
      const value = bucket[key];
      if (
        groupBy &&
        key === groupBy &&
        typeof value === "object" &&
        value !== null
      ) {
        const groupData = value as Record<string, Record<string, number>>;
        for (const metrics of Object.values(groupData)) {
          for (const metricKey of Object.keys(metrics)) {
            allGroupedMetricSubKeys.add(metricKey);
          }
        }
      } else {
        allMetricKeys.add(key);
      }
    }
  }

  for (const bucket of [...previousPeriod, ...currentPeriod]) {
    for (const key of allMetricKeys) {
      if (bucket[key] === undefined) bucket[key] = 0;
    }
    if (groupBy && bucket[groupBy] && typeof bucket[groupBy] === "object") {
      const groupData = bucket[groupBy] as Record<
        string,
        Record<string, number>
      >;
      for (const groupKey of Object.keys(groupData)) {
        for (const metricKey of allGroupedMetricSubKeys) {
          if (groupData[groupKey]![metricKey] === undefined) {
            groupData[groupKey]![metricKey] = 0;
          }
        }
      }
    }
  }
}

/**
 * Coerce a raw ClickHouse cell value to a finite number. Returns `null` for
 * anything we can't safely round-trip — `undefined` / `null` / non-finite
 * results. ClickHouse JSONEachRow returns 64-bit integers as strings (JSON
 * numeric precision tops out at 2^53), so the `string` branch is the common
 * one for token / cost counts; `Number("…")` parses both decimal and
 * scientific notation correctly.
 */
function coerceNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    if (value.length === 0) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
