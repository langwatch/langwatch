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

export function numberValue(point: CanonicalMetricDataPoint): number | null {
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

/** Mirrors the ClickHouse ORDER BY, which collates PointId by bytes. */
export function comparePoints(
  left: CanonicalMetricDataPoint,
  right: CanonicalMetricDataPoint,
): number {
  const leftNano = bigint(left.timeUnixNano);
  const rightNano = bigint(right.timeUnixNano);
  if (leftNano < rightNano) return -1;
  if (leftNano > rightNano) return 1;
  return compareOrdinal(left.pointId, right.pointId);
}

export function isGap(
  previous: CanonicalMetricDataPoint | undefined,
  current: CanonicalMetricDataPoint,
): boolean {
  return (
    !!previous &&
    current.timeUnixMs - previous.timeUnixMs > METRIC_ROLLUP_INTERVAL_MS * 2
  );
}

export function startsNewSequence(
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
export function usesPredecessor(point: CanonicalMetricDataPoint): boolean {
  return (
    point.metricKind === "summary" ||
    point.aggregationTemporality === "cumulative"
  );
}

export function previousPoint(
  all: CanonicalMetricDataPoint[],
  index: number,
): CanonicalMetricDataPoint | undefined {
  return index > 0 ? all[index - 1] : undefined;
}
