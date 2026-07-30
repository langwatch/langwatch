import type { CanonicalMetricDataPoint } from "./schema";

/**
 * The map's whole job: the event's payload already is the row the rollup
 * store recomputes buckets from (ADR-105 decision 5). The read-modify-write
 * itself lives in `rollupStore.ts`, because a map's own function is pure and
 * synchronous by contract (ADR-098 §2).
 */
export function toMetricTimeRollupRow(
  data: CanonicalMetricDataPoint,
): CanonicalMetricDataPoint {
  return data;
}
