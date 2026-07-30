import { type AppendStore, createMapExecutor } from "@langwatch/event-sourcing";
import type { MetricDataPointReceivedEvent } from "../aggregate";
import { metricMapGroupKey } from "../groupKeys";
import type { CanonicalMetricDataPoint } from "../schema";

/**
 * Keeps per-series metadata (resource, scope, description, unit) out of the
 * hot row. The store dedups on `(TenantId, SeriesId)` with `LastSeenAt` as
 * the version, so a late point cannot overwrite a newer observation — see
 * `mountDescriptors.ts` for why this is mounted as `map` + `replace`.
 *
 * Sharded by `seriesId` (not `pointId`): the store's own dedup/version
 * resolution for one series must never race two concurrent writers, and
 * routing every point of a series through the same lane is what prevents
 * that, the same way it does for `metricTimeRollup`.
 */
export const METRIC_SERIES_CATALOG_PROJECTION = "metricSeriesCatalog";

export interface MetricSeriesCatalogDeps {
  readonly store: AppendStore<CanonicalMetricDataPoint>;
}

export function createMetricSeriesCatalogProjection(
  deps: MetricSeriesCatalogDeps,
) {
  return createMapExecutor<
    MetricDataPointReceivedEvent,
    CanonicalMetricDataPoint
  >({
    store: deps.store,
    projectionName: METRIC_SERIES_CATALOG_PROJECTION,
    map: (event) => event.data,
  });
}

export function metricSeriesCatalogGroupKey(args: {
  tenantId: string;
  point: CanonicalMetricDataPoint;
  shardCount: number;
}) {
  return metricMapGroupKey({
    tenantId: args.tenantId,
    projectionName: METRIC_SERIES_CATALOG_PROJECTION,
    identity: args.point.seriesId,
    shardCount: args.shardCount,
  });
}
