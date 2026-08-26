import { compareOrdinal } from "@langwatch/eventing";
import { METRIC_ROLLUP_INTERVAL_MS } from "@langwatch/telemetry-contract";
import type { CanonicalMetricDataPoint } from "@langwatch/telemetry-contract";

function bigint(value: string | null | undefined): bigint {
  try {
    return BigInt(value ?? "0");
  } catch {
    return 0n;
  }
}

function numberValue(point: CanonicalMetricDataPoint): number | null {
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
 * these — never the megabyte-scale payload columns — so the type names the
 * contract: anything with these fields can participate in ordering and
 * predecessor-dependency checks.
 */
export interface MetricSequencePoint {
  seriesId: CanonicalMetricDataPoint["seriesId"];
  pointId: CanonicalMetricDataPoint["pointId"];
  timeUnixMs: CanonicalMetricDataPoint["timeUnixMs"];
  timeUnixNano: CanonicalMetricDataPoint["timeUnixNano"];
  metricKind: CanonicalMetricDataPoint["metricKind"];
  aggregationTemporality: CanonicalMetricDataPoint["aggregationTemporality"];
}

/** Mirrors the ClickHouse ORDER BY, which collates PointId by bytes. */
function comparePoints(left: MetricSequencePoint, right: MetricSequencePoint): number {
  const leftNano = bigint(left.timeUnixNano);
  const rightNano = bigint(right.timeUnixNano);
  if (leftNano < rightNano) return -1;
  if (leftNano > rightNano) return 1;
  return compareOrdinal(left.pointId, right.pointId);
}

function isGap(
  previous: CanonicalMetricDataPoint | undefined,
  current: CanonicalMetricDataPoint,
): boolean {
  return (
    !!previous && current.timeUnixMs - previous.timeUnixMs > METRIC_ROLLUP_INTERVAL_MS * 2
  );
}

function startsNewSequence(
  previous: CanonicalMetricDataPoint | undefined,
  current: CanonicalMetricDataPoint,
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
function usesPredecessor(point: MetricSequencePoint): boolean {
  return point.metricKind === "summary" || point.aggregationTemporality === "cumulative";
}

function previousPoint(
  all: CanonicalMetricDataPoint[],
  index: number,
): CanonicalMetricDataPoint | undefined {
  return index > 0 ? all[index - 1] : undefined;
}

export class MetricRollupSequenceAdapter {
  private constructor() {}

  static create(): MetricRollupSequenceAdapter {
    return new MetricRollupSequenceAdapter();
  }
}

export {
  bigint,
  comparePoints,
  floorBucket,
  isGap,
  numberValue,
  previousPoint,
  startsNewSequence,
  usesPredecessor,
};
