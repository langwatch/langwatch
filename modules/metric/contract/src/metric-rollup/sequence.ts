import { METRIC_ROLLUP_INTERVAL_MS } from "../schemas/metric-processing/constants.ts";
import type { CanonicalMetricDataPoint } from "../schemas/metric-processing/metric-data-point.ts";

function compareOrdinal(left: string, right: string): number {
  if (left === right) return 0;

  return left < right ? -1 : 1;
}

function bigint(value: string | null | undefined): bigint {
  try {
    return BigInt(value ?? "0");
  } catch {
    return 0n;
  }
}

function toNumberValue(point: MetricRollupSourcePoint): number | null {
  if (point.valueType === "double") return point.valueDouble;
  if (point.valueType === "int" && point.valueInt !== null) {
    const value = Number(point.valueInt);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function floorBucket(timeUnixMs: number): number {
  return Math.floor(timeUnixMs / METRIC_ROLLUP_INTERVAL_MS) * METRIC_ROLLUP_INTERVAL_MS;
}

/**
 * The fields sequence decisions actually read. Successor seeks fetch only
 * these — never the megabyte-scale payload columns — so this type names the
 * contract for ordering and predecessor-dependency checks.
 */
export interface MetricSequencePoint {
  seriesId: CanonicalMetricDataPoint["seriesId"];
  pointId: CanonicalMetricDataPoint["pointId"];
  timeUnixMs: CanonicalMetricDataPoint["timeUnixMs"];
  timeUnixNano: CanonicalMetricDataPoint["timeUnixNano"];
  metricKind: CanonicalMetricDataPoint["metricKind"];
  aggregationTemporality: CanonicalMetricDataPoint["aggregationTemporality"];
}

/**
 * Fields the rollup fold reads (excludes attributes, schema, scope, flags, quantiles,
 * timestamps to avoid over-materializing). MetricRollupSourcePoint is assignable to
 * full point; type bounds only what callers must supply to the read.
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
function comparePoints(left: MetricSequencePoint, right: MetricSequencePoint): number {
  const leftNano = bigint(left.timeUnixNano);
  const rightNano = bigint(right.timeUnixNano);
  if (leftNano < rightNano) return -1;
  if (leftNano > rightNano) return 1;
  return compareOrdinal(left.pointId, right.pointId);
}

function isGap(
  previous: MetricRollupSourcePoint | undefined,
  current: MetricRollupSourcePoint,
): boolean {
  return !!previous && current.timeUnixMs - previous.timeUnixMs > METRIC_ROLLUP_INTERVAL_MS * 2;
}

function startsNewSequence(
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
 * Whether a point's rolled-up value is derived from its predecessor — what
 * lets a late insert change the *next* bucket. OTLP summaries carry no
 * temporality field yet are always cumulative, so temporality alone can't answer this.
 */
function usesPredecessor(point: MetricSequencePoint): boolean {
  return point.metricKind === "summary" || point.aggregationTemporality === "cumulative";
}

function pickPreviousPoint(
  all: MetricRollupSourcePoint[],
  index: number,
): MetricRollupSourcePoint | undefined {
  return index > 0 ? all[index - 1] : undefined;
}

export {
  bigint,
  comparePoints,
  floorBucket,
  isGap,
  toNumberValue,
  pickPreviousPoint,
  startsNewSequence,
  usesPredecessor,
};
