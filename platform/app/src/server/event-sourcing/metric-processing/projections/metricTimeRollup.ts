import { type AppendStore, createMapExecutor } from "@langwatch/event-sourcing";
import type { MetricDataPointReceivedEvent } from "../aggregate";
import { metricMapGroupKey } from "../groupKeys";
import type { CanonicalMetricDataPoint } from "../schema";

/**
 * Recomputes the 30-second rollup buckets a new point affects, from the
 * authoritative raw points — never from an accumulator carried in the row.
 * The `map` function here only threads the event's canonical point through;
 * the actual read (fetch neighbouring points), recompute (`rollup/`) and
 * whole-bucket write happen inside the injected store's `writeBatch`, because
 * `createMapExecutor`'s `map` is a pure, synchronous, no-I/O function
 * (ADR-098 §2) and this projection's read-modify-write is neither. See
 * `mountDescriptors.ts` for why this is mounted as `map` + `replace`.
 *
 * Sharded by `seriesId`, for the same reason as `metricSeriesCatalog`: two
 * concurrent recomputes of the same series' buckets would each read stale
 * neighbours and one write would silently lose the other's contribution.
 */
export const METRIC_TIME_ROLLUP_PROJECTION = "metricTimeRollup";

export interface MetricTimeRollupDeps {
  readonly store: AppendStore<CanonicalMetricDataPoint>;
}

export function createMetricTimeRollupProjection(deps: MetricTimeRollupDeps) {
  return createMapExecutor<
    MetricDataPointReceivedEvent,
    CanonicalMetricDataPoint
  >({
    store: deps.store,
    projectionName: METRIC_TIME_ROLLUP_PROJECTION,
    map: (event) => event.data,
  });
}

export function metricTimeRollupGroupKey(args: {
  tenantId: string;
  point: CanonicalMetricDataPoint;
  shardCount: number;
}) {
  return metricMapGroupKey({
    tenantId: args.tenantId,
    projectionName: METRIC_TIME_ROLLUP_PROJECTION,
    identity: args.point.seriesId,
    shardCount: args.shardCount,
  });
}
