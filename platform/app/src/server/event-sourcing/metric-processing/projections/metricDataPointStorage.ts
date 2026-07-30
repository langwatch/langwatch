import { type AppendStore, createMapExecutor } from "@langwatch/event-sourcing";
import {
  type MetricDataPointReceivedEvent,
  metricAggregateId,
} from "../aggregate";
import { metricMapGroupKey } from "../groupKeys";
import type { CanonicalMetricDataPoint } from "../schema";

/**
 * Writes the canonical row, one event in, one row out. See
 * `mountDescriptors.ts` for why this is mounted as `map` + `append`.
 */
export const METRIC_DATA_POINT_STORAGE_PROJECTION = "metricDataPointStorage";

export interface MetricDataPointStorageDeps {
  readonly store: AppendStore<CanonicalMetricDataPoint>;
}

export function createMetricDataPointStorageProjection(
  deps: MetricDataPointStorageDeps,
) {
  return createMapExecutor<
    MetricDataPointReceivedEvent,
    CanonicalMetricDataPoint
  >({
    store: deps.store,
    projectionName: METRIC_DATA_POINT_STORAGE_PROJECTION,
    map: (event) => event.data,
  });
}

export function metricDataPointStorageGroupKey(args: {
  tenantId: string;
  point: CanonicalMetricDataPoint;
  shardCount: number;
}) {
  return metricMapGroupKey({
    tenantId: args.tenantId,
    projectionName: METRIC_DATA_POINT_STORAGE_PROJECTION,
    // The aggregate id, extracted once via `metricAggregateId` — never
    // re-derived as `point.pointId` at a second call site that could drift
    // from it.
    identity: metricAggregateId(args.point),
    shardCount: args.shardCount,
  });
}
