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
import {
  isZeroWhenAbsentSeries,
  type SeriesInputType,
} from "~/server/analytics/registry";
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

/** Whatever a `TimeseriesBucket`'s index signature accepts as a value. */
type TimeseriesBucketValue =
  | number
  | string
  | Record<string, Record<string, number>>;

/**
 * Apply one row's coerced series values onto a write target — either the
 * bucket itself (ungrouped) or a group's sub-object (grouped). Split out of
 * `parseTimeseriesRows` so the grouped/ungrouped branches share one series
 * loop instead of two copies.
 */
function applySeriesToTarget(
  row: AnalyticsTimeseriesRow,
  series: readonly SeriesInputType[],
  target: Record<string, TimeseriesBucketValue>,
): void {
  for (let i = 0; i < series.length; i++) {
    const s = series[i]!;
    const alias = buildMetricAlias({
      index: i,
      metric: s.metric,
      aggregation: s.aggregation,
      key: s.key,
      subkey: s.subkey,
    });
    const seriesName = buildSeriesName(s, i);
    const coerced = coerceNumber(row[alias]);
    if (coerced !== null) target[seriesName] = coerced;
  }
}

/**
 * Rows without a date column (shouldn't happen on bucketed queries) share one
 * stable sentinel bucket — a per-row timestamp would split same-period rows
 * and break tripwire comparison on the bucket key.
 */
function bucketDateKey(
  row: AnalyticsTimeseriesRow,
  timeScale: number | "full" | undefined,
): string {
  if (timeScale === "full") return "full";
  return typeof row.date === "string" ? row.date : "";
}

function getOrCreateBucket(
  targetMap: Map<string, TimeseriesBucket>,
  dateKey: string,
): TimeseriesBucket {
  let bucket = targetMap.get(dateKey);
  if (!bucket) {
    bucket = { date: dateKey };
    targetMap.set(dateKey, bucket);
  }
  return bucket;
}

function applyRowToBucket({
  row,
  bucket,
  series,
  groupBy,
}: {
  row: AnalyticsTimeseriesRow;
  bucket: TimeseriesBucket;
  series: readonly SeriesInputType[];
  groupBy?: string;
}): void {
  if (groupBy && row.group_key !== undefined && row.group_key !== null) {
    const groupKey = String(row.group_key);
    if (!bucket[groupBy]) bucket[groupBy] = {};
    const groupData = bucket[groupBy] as Record<string, Record<string, number>>;
    if (!groupData[groupKey]) groupData[groupKey] = {};
    applySeriesToTarget(row, series, groupData[groupKey]!);
  } else {
    applySeriesToTarget(row, series, bucket);
  }
}

function sortedBuckets(map: Map<string, TimeseriesBucket>): TimeseriesBucket[] {
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, bucket]) => bucket);
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
    const dateKey = bucketDateKey(row, timeScale);
    const targetMap =
      period === "current" ? bucketMap.current : bucketMap.previous;
    const bucket = getOrCreateBucket(targetMap, dateKey);
    applyRowToBucket({ row, bucket, series, groupBy });
  }

  const previousPeriod = sortedBuckets(bucketMap.previous);
  const currentPeriod = sortedBuckets(bucketMap.current);

  // Correction when previous has more buckets than current.
  const correctedPrevious = previousPeriod.slice(
    Math.max(0, previousPeriod.length - currentPeriod.length),
  );

  normalizeMetricKeys({
    previousPeriod: correctedPrevious,
    currentPeriod,
    series,
    groupBy,
  });

  return { previousPeriod: correctedPrevious, currentPeriod };
}

/**
 * Build the result key name that matches the ES-shaped frontend contract.
 * Exported as the single encoder for bucket keys — consumers reading values
 * back out of a `TimeseriesResult` (e.g. the graph-trigger evaluator) must
 * derive their lookup key here, NOT from a stored series identifier: stored
 * trigger identifiers use `{index}/{key|metric}/{aggregation}` while result
 * buckets are keyed `{queryIndex}/{metric}/{aggregation}[/{key}]` with
 * `terms` rewritten to `cardinality`.
 */
export function buildSeriesName(
  series: SeriesInputType,
  index: number,
): string {
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
 * True when `key` is the `groupBy` dimension's own bucket entry — its value
 * is the per-group-value sub-object, not a metric.
 */
function isGroupDimensionEntry(
  groupBy: string | undefined,
  key: string,
  value: TimeseriesBucketValue,
): value is Record<string, Record<string, number>> {
  return (
    Boolean(groupBy) &&
    key === groupBy &&
    typeof value === "object" &&
    value !== null
  );
}

function addGroupedSubKeys(
  groupData: Record<string, Record<string, number>>,
  target: Set<string>,
): void {
  for (const metrics of Object.values(groupData)) {
    for (const metricKey of Object.keys(metrics)) {
      target.add(metricKey);
    }
  }
}

/**
 * Scan every bucket's observed keys, splitting top-level metric keys from
 * grouped metric sub-keys (nested inside the `groupBy` dimension's
 * per-group-value objects). Split out of `normalizeMetricKeys`.
 */
function collectObservedMetricKeys(
  buckets: readonly TimeseriesBucket[],
  groupBy: string | undefined,
): { allMetricKeys: Set<string>; allGroupedMetricSubKeys: Set<string> } {
  const allMetricKeys = new Set<string>();
  const allGroupedMetricSubKeys = new Set<string>();

  for (const bucket of buckets) {
    for (const key of Object.keys(bucket)) {
      if (key === "date") continue;
      const value = bucket[key];
      if (isGroupDimensionEntry(groupBy, key, value)) {
        addGroupedSubKeys(value, allGroupedMetricSubKeys);
      } else {
        allMetricKeys.add(key);
      }
    }
  }

  return { allMetricKeys, allGroupedMetricSubKeys };
}

function zeroFillTopLevel(
  bucket: TimeseriesBucket,
  topLevelFillKeys: Set<string>,
  zeroFillableKeys: Set<string>,
): void {
  for (const key of topLevelFillKeys) {
    if (bucket[key] === undefined && zeroFillableKeys.has(key)) {
      bucket[key] = 0;
    }
  }
}

function zeroFillGroupData(
  groupData: Record<string, Record<string, number>>,
  groupedFillKeys: Set<string>,
  zeroFillableKeys: Set<string>,
): void {
  for (const groupKey of Object.keys(groupData)) {
    for (const metricKey of groupedFillKeys) {
      if (
        groupData[groupKey]![metricKey] === undefined &&
        zeroFillableKeys.has(metricKey)
      ) {
        groupData[groupKey]![metricKey] = 0;
      }
    }
  }
}

/**
 * Default a bucket's zero-fillable additive keys (top-level + grouped) to 0
 * when absent. Split out of `normalizeMetricKeys`.
 */
function zeroFillBucket({
  bucket,
  topLevelFillKeys,
  groupedFillKeys,
  zeroFillableKeys,
  groupBy,
}: {
  bucket: TimeseriesBucket;
  topLevelFillKeys: Set<string>;
  groupedFillKeys: Set<string>;
  zeroFillableKeys: Set<string>;
  groupBy?: string;
}): void {
  zeroFillTopLevel(bucket, topLevelFillKeys, zeroFillableKeys);
  if (groupBy && bucket[groupBy] && typeof bucket[groupBy] === "object") {
    const groupData = bucket[groupBy] as Record<string, Record<string, number>>;
    zeroFillGroupData(groupData, groupedFillKeys, zeroFillableKeys);
  }
}

/**
 * Normalise metric keys across both periods. Ensures every bucket carries
 * every ADDITIVE metric (with a 0 default) so the frontend can compute %
 * change for series that ClickHouse returned NULL for in one of the periods.
 * Non-additive series (avg / min / max / percentiles) are only ever absent
 * when there was no data, so they are left absent rather than defaulted to a
 * fabricated 0 — see `isZeroWhenAbsentSeries`.
 *
 * Grouped: only fill in missing metric sub-keys for groups already present in
 * a bucket — do NOT spawn new groups from the other period, that would bleed
 * stale dimension values across periods.
 */
function normalizeMetricKeys({
  previousPeriod,
  currentPeriod,
  series,
  groupBy,
}: {
  previousPeriod: TimeseriesBucket[];
  currentPeriod: TimeseriesBucket[];
  series: readonly SeriesInputType[];
  groupBy?: string;
}): void {
  const zeroFillableKeys = new Set<string>();
  series.forEach((s, i) => {
    if (isZeroWhenAbsentSeries(s)) zeroFillableKeys.add(buildSeriesName(s, i));
  });

  const allBuckets = [...previousPeriod, ...currentPeriod];
  const { allMetricKeys, allGroupedMetricSubKeys } = collectObservedMetricKeys(
    allBuckets,
    groupBy,
  );

  // Additive keys default even when the value was NULL in every row — the
  // observed-key sets alone would leave such a series absent everywhere. On a
  // grouped query the series values live inside the group sub-objects, so the
  // top level only fills what was observed there.
  const topLevelFillKeys = groupBy
    ? allMetricKeys
    : new Set([...allMetricKeys, ...zeroFillableKeys]);
  const groupedFillKeys = new Set([
    ...allGroupedMetricSubKeys,
    ...zeroFillableKeys,
  ]);

  for (const bucket of allBuckets) {
    zeroFillBucket({
      bucket,
      topLevelFillKeys,
      groupedFillKeys,
      zeroFillableKeys,
      groupBy,
    });
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
