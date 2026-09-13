import { compareOrdinal } from "../../../utils/compareOrdinal";
import { METRIC_ROLLUP_INTERVAL_MS } from "../schemas/constants";
import type { CanonicalMetricDataPoint } from "../schemas/metricDataPoint";

export function bigint(value: string | null | undefined): bigint {
  try {
    return BigInt(value ?? "0");
  } catch {
    return 0n;
  }
}

export function numberValue(point: MetricRollupSourcePoint): number | null {
  if (point.valueType === "double") return point.valueDouble;
  if (point.valueType === "int" && point.valueInt !== null) {
    const value = Number(point.valueInt);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

export function floorBucket(timeUnixMs: number): number {
  return (
    Math.floor(timeUnixMs / METRIC_ROLLUP_INTERVAL_MS) *
    METRIC_ROLLUP_INTERVAL_MS
  );
}

/**
 * The fields sequence decisions actually read. Successor seeks fetch only
 * these — never the megabyte-scale payload columns — so the type names the
 * contract: anything with these fields can participate in ordering and
 * predecessor-dependency checks.
 */
export type MetricSequencePoint = Pick<
  CanonicalMetricDataPoint,
  | "seriesId"
  | "pointId"
  | "timeUnixMs"
  | "timeUnixNano"
  | "metricKind"
  | "aggregationTemporality"
>;

/**
 * The fields the rollup fold actually reads, on top of the ordering fields a
 * seek needs. Naming them is what lets the authoritative read stop asking for
 * the rest: attributes, schema urls, scope identity, flags, quantiles and the
 * accounting timestamps are stored on every point and read by none of the
 * builders below, yet `FINAL` materialised all of them for every row a seek
 * scanned — the megabytes-per-granule that pushed the reads over the server's
 * memory cap (`while reading column PointAttributesJson`).
 *
 * `MetricRollupSourcePoint` stays assignable to this, so a caller holding a
 * whole point still folds; the type only bounds what a caller *must* supply,
 * and so what a read has to fetch.
 */
export type MetricRollupSourcePoint = MetricSequencePoint &
  Pick<
    CanonicalMetricDataPoint,
    | "tenantId"
    | "metricName"
    | "metricUnit"
    | "isMonotonic"
    | "startTimeUnixNano"
    | "valueType"
    | "valueInt"
    | "valueDouble"
    | "count"
    | "sum"
    | "min"
    | "max"
    | "explicitBounds"
    | "bucketCounts"
    | "exponentialScale"
    | "exponentialZeroThreshold"
    | "zeroCount"
    | "positiveOffset"
    | "positiveBucketCounts"
    | "negativeOffset"
    | "negativeBucketCounts"
  >;

/** Mirrors the ClickHouse ORDER BY, which collates PointId by bytes. */
export function comparePoints(
  left: MetricSequencePoint,
  right: MetricSequencePoint,
): number {
  const leftNano = bigint(left.timeUnixNano);
  const rightNano = bigint(right.timeUnixNano);
  if (leftNano < rightNano) return -1;
  if (leftNano > rightNano) return 1;
  return compareOrdinal(left.pointId, right.pointId);
}

export function isGap(
  previous: MetricRollupSourcePoint | undefined,
  current: MetricRollupSourcePoint,
): boolean {
  return (
    !!previous &&
    current.timeUnixMs - previous.timeUnixMs > METRIC_ROLLUP_INTERVAL_MS * 2
  );
}

export function startsNewSequence(
  previous: MetricRollupSourcePoint | undefined,
  current: MetricRollupSourcePoint,
): boolean {
  return (
    !previous ||
    previous.startTimeUnixNano !== current.startTimeUnixNano ||
    bigint(current.timeUnixNano) <= bigint(previous.timeUnixNano) ||
    isGap(previous, current)
  );
}

/**
 * Whether a point's rolled-up value is derived from its predecessor, which is
 * what makes a late insert able to change the *next* bucket. OTLP summaries
 * carry no temporality field yet are always cumulative, so temporality alone
 * cannot answer this.
 */
export function usesPredecessor(point: MetricSequencePoint): boolean {
  return (
    point.metricKind === "summary" ||
    point.aggregationTemporality === "cumulative"
  );
}

export function previousPoint(
  all: MetricRollupSourcePoint[],
  index: number,
): MetricRollupSourcePoint | undefined {
  return index > 0 ? all[index - 1] : undefined;
}
