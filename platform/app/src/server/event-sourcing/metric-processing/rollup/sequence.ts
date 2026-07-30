import { compareOrdinal } from "../canonical/ordinal";
import { METRIC_ROLLUP_INTERVAL_MS } from "../constants";
import type { CanonicalMetricDataPoint } from "../schema";

export function bigint(value: string | null | undefined): bigint {
  try {
    return BigInt(value ?? "0");
  } catch {
    return 0n;
  }
}

/** A point's scalar value read for rollup purposes — `0` is a real value. */
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

/** Mirrors the ClickHouse `ORDER BY`, which collates `PointId` by bytes. */
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
 * what lets a late insert change the *next* bucket too. OTLP summaries carry
 * no temporality field yet are always cumulative, so temporality alone cannot
 * answer this.
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
