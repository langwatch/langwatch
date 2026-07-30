import {
  type AggregateEvent,
  type AppendStore,
  ConfigurationError,
  createMapExecutor,
  defineMapProjection,
  type GroupKey,
  type MapProjection,
  type Metrics,
  type Mount,
  validateMount,
} from "@langwatch/event-sourcing";
import { metric } from "./aggregate";
import type { CanonicalMetricDataPoint } from "./schema";
import { DEFAULT_METRIC_SHARD_COUNT, metricShardLabel } from "./shards";

/**
 * Canonical OTLP metric ingestion: one immutable, content-addressed event per
 * data point, and three `map` projections mounted on it — never a `fold`,
 * because a point has no lifetime to accumulate (ADR-098, ADR-105;
 * specs/otlp/metric-processing-pipeline.feature).
 */

export { metric } from "./aggregate";
export type { PreparedMetricPoint } from "./canonical/buildPoint";
export { buildPoint } from "./canonical/buildPoint";
export type {
  PiiRedactionLevel,
  RedactionService,
} from "./canonical/redaction";
export {
  MAX_CANONICAL_METRIC_PAYLOAD_BYTES,
  METRIC_MAP_COALESCE_MAX_BATCH,
  METRIC_ROLLUP_INTERVAL_MS,
} from "./constants";
export type { MetricPreparationResult } from "./prepareMetricDataPoints";
export { prepareMetricDataPoints } from "./prepareMetricDataPoints";
export {
  affectedRollupBuckets,
  buildMetricRollups,
} from "./rollup/buildRollups";
export type {
  AggregationTemporality,
  CanonicalMetricDataPoint,
  MetricKind,
  MetricRollupRow,
  MetricTraceCorrelation,
} from "./schema";
export {
  canonicalMetricDataPointSchema,
  metricKindSchema,
} from "./schema";
export {
  clampMetricShardCount,
  DEFAULT_METRIC_SHARD_COUNT,
  MAX_METRIC_SHARD_COUNT,
  MIN_METRIC_SHARD_COUNT,
  metricShardLabel,
  resolveMetricShardCount,
} from "./shards";

/** The canonical row: one event in, one row out. */
export const metricDataPointStorage = defineMapProjection({
  name: "metricDataPointStorage",
  aggregate: metric,
  handle: { dataPointReceived: (data): CanonicalMetricDataPoint => data },
});

/**
 * Per-series metadata (resource, scope, description, unit), kept out of the hot
 * row. The store dedups on `(TenantId, SeriesId)` with `LastSeenAt` as the
 * version, so a late point cannot overwrite a newer observation.
 */
export const metricSeriesCatalog = defineMapProjection({
  name: "metricSeriesCatalog",
  aggregate: metric,
  handle: { dataPointReceived: (data): CanonicalMetricDataPoint => data },
});

/**
 * The 30-second buckets a new point affects, recomputed whole from the
 * authoritative raw points rather than accumulated. The read, recompute
 * (`rollup/`) and whole-bucket write happen inside the injected store, because
 * a map's own function is pure and synchronous by contract (ADR-098 §2).
 */
export const metricTimeRollup = defineMapProjection({
  name: "metricTimeRollup",
  aggregate: metric,
  handle: { dataPointReceived: (data): CanonicalMetricDataPoint => data },
});

/**
 * `store` is a fact about the ClickHouse table's merge strategy (ADR-099), not
 * about which store interface the executor runs on: a map never reads its store
 * back, so all three run on an `AppendStore` regardless. `metric_data_points`
 * collapses on a content-addressed `PointId`, while `metric_series` and
 * `metric_time_rollups` elect a winner between competing versions of one row.
 */
export const metricProcessingMounts = {
  metricDataPointStorage: {
    projection: "map",
    store: "append",
    scope: "partition",
    collapse: "batch",
  },
  metricSeriesCatalog: {
    projection: "map",
    store: "replace",
    scope: "partition",
    collapse: "batch",
  },
  metricTimeRollup: {
    projection: "map",
    store: "replace",
    scope: "partition",
    collapse: "batch",
  },
} as const satisfies Record<string, Mount>;

/** Refuses an illegal mount at composition, not on the first delivery (ADR-106). */
export function assertMetricProcessingMountsAreLegal(): void {
  for (const [projection, mount] of Object.entries(metricProcessingMounts)) {
    const violations = validateMount(mount);
    if (violations.length > 0) {
      throw new ConfigurationError(
        `metric-processing's ${projection} mount is illegal: ${violations
          .map((v) => `${v.rule} — ${v.message}`)
          .join("; ")}`,
        { pipeline: "metric_processing", projection, violations },
      );
    }
  }
}

export function metricMapGroupKey(args: {
  tenantId: string;
  projectionName: string;
  identity: string;
  shardCount: number;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: args.projectionName },
    scope: { kind: "partition", parts: ["metric", metricShardLabel(args)] },
  };
}

/** Keyed on the point itself: nothing else names the same measurement. */
export function metricDataPointStorageGroupKey(args: {
  tenantId: string;
  point: CanonicalMetricDataPoint;
  shardCount: number;
}): GroupKey {
  return metricMapGroupKey({
    tenantId: args.tenantId,
    projectionName: metricDataPointStorage.name,
    identity: metric.id(args.point),
    shardCount: args.shardCount,
  });
}

/**
 * Keyed on the series, not the point: this projection's write is a
 * read-modify-write over the series, and two concurrent writers would compute
 * conflicting versions of the same row.
 */
export function metricSeriesCatalogGroupKey(args: {
  tenantId: string;
  point: CanonicalMetricDataPoint;
  shardCount: number;
}): GroupKey {
  return metricMapGroupKey({
    tenantId: args.tenantId,
    projectionName: metricSeriesCatalog.name,
    identity: args.point.seriesId,
    shardCount: args.shardCount,
  });
}

/** Keyed on the series for the same reason as `metricSeriesCatalogGroupKey`. */
export function metricTimeRollupGroupKey(args: {
  tenantId: string;
  point: CanonicalMetricDataPoint;
  shardCount: number;
}): GroupKey {
  return metricMapGroupKey({
    tenantId: args.tenantId,
    projectionName: metricTimeRollup.name,
    identity: args.point.seriesId,
    shardCount: args.shardCount,
  });
}

/**
 * Sharded rather than aggregate-scoped: no two commands ever share a
 * content-addressed aggregate id, so there is nothing for a per-aggregate lane
 * to protect and one lane per point would be unbounded (ADR-100 decision 4).
 */
export function metricCommandGroupKey(args: {
  tenantId: string;
  point: CanonicalMetricDataPoint;
  shardCount?: number;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: "recordDataPoint" },
    scope: {
      kind: "partition",
      parts: [
        "metric-cmd",
        metricShardLabel({
          identity: metric.id(args.point),
          shardCount: args.shardCount ?? DEFAULT_METRIC_SHARD_COUNT,
        }),
      ],
    },
  };
}

/**
 * The stores cross from the composition root (ADR-102 decision 6) because this
 * pipeline's three tables are written by repositories the app already owns.
 */
export interface MetricProcessingDeps {
  readonly metricDataPointStore: AppendStore<CanonicalMetricDataPoint>;
  readonly metricSeriesCatalogStore: AppendStore<CanonicalMetricDataPoint>;
  readonly metricTimeRollupStore: AppendStore<CanonicalMetricDataPoint>;
  readonly metrics?: Metrics;
}

export function createMetricProcessingProjections(deps: MetricProcessingDeps) {
  assertMetricProcessingMountsAreLegal();

  const executor = (
    projection: MapProjection<CanonicalMetricDataPoint>,
    store: AppendStore<CanonicalMetricDataPoint>,
  ) =>
    createMapExecutor<AggregateEvent, CanonicalMetricDataPoint>({
      store,
      projectionName: projection.name,
      map: projection.map,
      metrics: deps.metrics,
    });

  return {
    metricDataPointStorage: executor(
      metricDataPointStorage,
      deps.metricDataPointStore,
    ),
    metricSeriesCatalog: executor(
      metricSeriesCatalog,
      deps.metricSeriesCatalogStore,
    ),
    metricTimeRollup: executor(metricTimeRollup, deps.metricTimeRollupStore),
  };
}
