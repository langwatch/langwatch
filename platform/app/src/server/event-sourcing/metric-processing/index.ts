import { type ClickHouseClient, clickhouseAppend } from "@langwatch/clickhouse";
import {
  ConfigurationError,
  definePipeline,
  validateMount,
  type AppendStore,
  type GroupKey,
  type Mount,
} from "@langwatch/event-sourcing";
import { METRIC_PIPELINE_NAME, METRIC_PIPELINE_PREFIX, metricProcessingEvents } from "./events";
import {
  stampPoints,
  toDataPointRow,
  toMetricDataPointStorageRow,
} from "./metricDataPointStorage.projection";
import { toMetricSeriesCatalogRow, toSeriesRow } from "./metricSeriesCatalog.projection";
import { toMetricTimeRollupRow } from "./metricTimeRollup.projection";
import { recordDataPoint } from "./recordDataPoint.command";
import { createMetricTimeRollupStore } from "./rollupStore";
import { canonicalMetricDataPointSchema, type CanonicalMetricDataPoint } from "./schema";
import { DEFAULT_METRIC_SHARD_COUNT, metricShardLabel } from "./shards";
import { metricDataPointsTable, metricSeriesTable } from "./table";

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
          identity: args.point.pointId,
          shardCount: args.shardCount ?? DEFAULT_METRIC_SHARD_COUNT,
        }),
      ],
    },
  };
}

/** A bounded hashed shard, so a delivery's writes coalesce (ADR-100 decision 2). */
export function metricMapGroupKey(args: {
  tenantId: string;
  projectionName: string;
  identity: string;
  shardCount?: number;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: args.projectionName },
    scope: {
      kind: "partition",
      parts: ["metric", metricShardLabel({ identity: args.identity, shardCount: args.shardCount ?? DEFAULT_METRIC_SHARD_COUNT })],
    },
  };
}

export function metricDataPointStorageGroupKey(args: {
  tenantId: string;
  point: CanonicalMetricDataPoint;
  shardCount?: number;
}): GroupKey {
  return metricMapGroupKey({
    tenantId: args.tenantId,
    projectionName: "metricDataPointStorage",
    identity: args.point.pointId,
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
  shardCount?: number;
}): GroupKey {
  return metricMapGroupKey({
    tenantId: args.tenantId,
    projectionName: "metricSeriesCatalog",
    identity: args.point.seriesId,
    shardCount: args.shardCount,
  });
}

/** Keyed on the series for the same reason as `metricSeriesCatalogGroupKey`. */
export function metricTimeRollupGroupKey(args: {
  tenantId: string;
  point: CanonicalMetricDataPoint;
  shardCount?: number;
}): GroupKey {
  return metricMapGroupKey({
    tenantId: args.tenantId,
    projectionName: "metricTimeRollup",
    identity: args.point.seriesId,
    shardCount: args.shardCount,
  });
}

/**
 * A point has no lifetime to accumulate, so nothing here reads its own prior
 * state back — every projection is a map, and `store` is whichever interface
 * the injected store actually implements.
 */
export function metricMount(store: AppendStore<CanonicalMetricDataPoint>): Mount {
  return {
    projection: "map",
    store: store.kind,
    scope: "partition",
    collapse: "batch",
  };
}

/** Refuses an illegal mount at composition, not on the first delivery (ADR-106). */
function assertMountIsLegal(projection: string, mount: Mount): Mount {
  const violations = validateMount(mount);
  if (violations.length > 0) {
    throw new ConfigurationError(
      `metric-processing's ${projection} mount is illegal: ${violations
        .map((v) => `${v.rule} — ${v.message}`)
        .join("; ")}`,
      { pipeline: METRIC_PIPELINE_NAME, projection, violations },
    );
  }
  return mount;
}

function createMetricDataPointStore(
  client: ClickHouseClient,
): AppendStore<CanonicalMetricDataPoint> {
  const points = clickhouseAppend({ client, table: metricDataPointsTable, toRow: toDataPointRow });
  return {
    kind: "append",
    async writeBatch(batch, context) {
      await points.writeBatch(stampPoints(batch, context.retentionDays), context);
    },
  };
}

function createMetricSeriesCatalogStore(
  client: ClickHouseClient,
): AppendStore<CanonicalMetricDataPoint> {
  const series = clickhouseAppend({ client, table: metricSeriesTable, toRow: toSeriesRow });
  return {
    kind: "append",
    async writeBatch(batch, context) {
      // `LastSeenAt` is the engine version, so only the newest point per series
      // can win: collapsing here writes one row per series rather than one per
      // point, and leaves the merge nothing to undo.
      const latest = new Map<string, CanonicalMetricDataPoint>();
      for (const point of batch) {
        const current = latest.get(point.seriesId);
        if (!current || point.timeUnixMs > current.timeUnixMs) {
          latest.set(point.seriesId, point);
        }
      }
      await series.writeBatch(stampPoints([...latest.values()], context.retentionDays), context);
    },
  };
}

export function createMetricProcessingPipeline(deps: { readonly client: ClickHouseClient }) {
  const dataPointStore = createMetricDataPointStore(deps.client);
  const seriesStore = createMetricSeriesCatalogStore(deps.client);
  const rollupStore = createMetricTimeRollupStore(deps.client);
  assertMountIsLegal("metricDataPointStorage", metricMount(dataPointStore));
  assertMountIsLegal("metricSeriesCatalog", metricMount(seriesStore));
  assertMountIsLegal("metricTimeRollup", metricMount(rollupStore));

  return definePipeline(METRIC_PIPELINE_NAME)
    .prefix(METRIC_PIPELINE_PREFIX)
    .events(metricProcessingEvents)
    .withCommand("recordDataPoint", {
      input: canonicalMetricDataPointSchema,
      handle: recordDataPoint,
    })
    .withMap("metricDataPointStorage", {
      on: { dataPointReceived: toMetricDataPointStorageRow },
      store: dataPointStore,
    })
    .withMap("metricSeriesCatalog", {
      on: { dataPointReceived: toMetricSeriesCatalogRow },
      store: seriesStore,
    })
    .withMap("metricTimeRollup", {
      on: { dataPointReceived: toMetricTimeRollupRow },
      store: rollupStore,
    })
    .build();
}
