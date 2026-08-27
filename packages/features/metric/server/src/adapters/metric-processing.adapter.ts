import type { Command, CommandHandler } from "@langwatch/eventing";
import {
  type AppendStore,
  createTenantId,
  defineAggregate,
  defineCommandSchema,
  defineEvents,
  definePipeline,
  type EventSubscriberDefinition,
  EventUtils,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type {
  CanonicalMetricDataPoint,
  MetricDataPointReceivedEvent,
  MetricProcessingEvent,
  RecordMetricDataPointCommandData,
} from "@langwatch/metric-contract";
import {
  DEFAULT_METRIC_COMMAND_SHARDS,
  MAX_METRIC_COMMAND_SHARDS,
  METRIC_COMMAND_COALESCE_MAX_BATCH,
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
  METRIC_DATA_POINT_RECEIVED_EVENT_VERSION_LATEST,
  METRIC_PROCESSING_EVENT_TYPES,
  MIN_METRIC_COMMAND_SHARDS,
  RECORD_METRIC_DATA_POINT_COMMAND_TYPE,
  recordMetricDataPointCommandDataSchema,
} from "@langwatch/metric-contract";
import { MetricDataPointStorageMapProjection } from "../projections/metric-data-point-storage.projection";
import { MetricSeriesCatalogMapProjection } from "../projections/metric-series-catalog.projection";
import { MetricTimeRollupMapProjection } from "../projections/metric-time-rollup.projection";
import type { MetricDataPointRepository } from "../repositories/metric-data-point.repository";
import {
  MetricDataPointAppendStore,
  MetricSeriesCatalogAppendStore,
  MetricTimeRollupAppendStore,
} from "../stores/metric-projection/metric-projection.store";
import { sha256 } from "./metric-serialization.rules";

export interface MetricProcessingPipelineDeps {
  metricDataPointAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricSeriesCatalogAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricTimeRollupAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricCommandShardCount: number;
  /** Cross-pipeline dispatchers (e.g. coding-agent metric-facts, ADR-056). */
  subscribers?: EventSubscriberDefinition<MetricProcessingEvent>[];
}

export interface MetricProcessingAdapterOptions {
  repository: MetricDataPointRepository;
  defaultRetentionDays: number;
  metricCommandShardCount: number;
  subscribers?: EventSubscriberDefinition<MetricProcessingEvent>[];
}

export type MetricProcessingPipeline = StaticPipelineDefinition<
  MetricProcessingEvent,
  Record<string, Projection>,
  { name: "recordDataPoint"; payload: RecordMetricDataPointCommandData }
>;

function createMetricProcessingPipeline(
  deps: MetricProcessingPipelineDeps,
): MetricProcessingPipeline {
  let builder = definePipeline<MetricProcessingEvent>({
    name: "metric_processing",
    aggregate: defineAggregate({
      type: "metric",
      events: defineEvents(METRIC_PROCESSING_EVENT_TYPES),
    }),
  })
    .withClickHouseMapProjection(
      MetricDataPointStorageMapProjection.create({
        store: deps.metricDataPointAppendStore,
        shardCount: deps.metricCommandShardCount,
      }),
    )
    .withClickHouseMapProjection(
      MetricSeriesCatalogMapProjection.create({
        store: deps.metricSeriesCatalogAppendStore,
        shardCount: deps.metricCommandShardCount,
      }),
    )
    .withClickHouseMapProjection(
      MetricTimeRollupMapProjection.create({
        store: deps.metricTimeRollupAppendStore,
        shardCount: deps.metricCommandShardCount,
      }),
    );

  for (const subscriber of deps.subscribers ?? []) {
    builder = builder.withEventSubscriber(subscriber.name, subscriber);
  }

  return builder
    .withCommand("recordDataPoint", RecordMetricDataPointCommand, {
      getGroupKey: (payload) =>
        metricCommandGroupKey({
          pointId: payload.pointId,
          shardCount: deps.metricCommandShardCount,
        }),
      // ADR-066 pillar 2: a shard funnels many data points into one group, so a
      // backed-up shard appends one tiny insert per point. Coalesce its queued
      // points into one multi-row insert instead. Safe to fold: the handler
      // derives its event from its own command alone and never reads back a
      // same-batch append.
      coalesceMaxBatch: METRIC_COMMAND_COALESCE_MAX_BATCH,
    })
    .build();
}

export class MetricProcessingAdapter {
  private constructor(private readonly options: MetricProcessingAdapterOptions) {}

  static create(options: MetricProcessingAdapterOptions): MetricProcessingAdapter {
    return new MetricProcessingAdapter(options);
  }

  build(): MetricProcessingPipeline {
    const repository = this.options.repository;
    const retentionDays = this.options.defaultRetentionDays;

    return createMetricProcessingPipeline({
      metricDataPointAppendStore: MetricDataPointAppendStore.create(repository, retentionDays),
      metricSeriesCatalogAppendStore: MetricSeriesCatalogAppendStore.create(
        repository,
        retentionDays,
      ),
      metricTimeRollupAppendStore: MetricTimeRollupAppendStore.create(repository, retentionDays),
      metricCommandShardCount: this.options.metricCommandShardCount,
      subscribers: this.options.subscribers,
    });
  }
}

export { createMetricProcessingPipeline };

export class RecordMetricDataPointCommand implements CommandHandler<
  Command<RecordMetricDataPointCommandData>,
  MetricDataPointReceivedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_METRIC_DATA_POINT_COMMAND_TYPE,
    recordMetricDataPointCommandDataSchema,
    "Record one lossless canonical OpenTelemetry metric data point",
  );

  handle(command: Command<RecordMetricDataPointCommandData>): MetricDataPointReceivedEvent[] {
    const data = command.data;
    const event = EventUtils.createEvent<MetricDataPointReceivedEvent>({
      aggregateType: "metric",
      aggregateId: data.pointId,
      tenantId: createTenantId(command.tenantId),
      type: METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
      version: METRIC_DATA_POINT_RECEIVED_EVENT_VERSION_LATEST,
      data,
      metadata: {},
      occurredAt: data.occurredAt,
      // Tenant-scoped like every other command's. A PointId already hashes
      // its tenant transitively (via SeriesId), so a collision is not
      // reachable today — but nothing states that invariant at this layer,
      // and a dedup key that silently depends on it would suppress another
      // tenant's work the day it changes.
      idempotencyKey: `${command.tenantId}:${data.pointId}`,
    });
    return [event];
  }

  static getAggregateId(payload: RecordMetricDataPointCommandData): string {
    return payload.pointId;
  }

  static getSpanAttributes(
    payload: RecordMetricDataPointCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.metric.point_id": payload.pointId,
      "payload.metric.series_id": payload.seriesId,
      "payload.metric.name": payload.metricName,
      "payload.metric.kind": payload.metricKind,
    };
  }
}

function clampMetricCommandShardCount(value: number): number {
  if (!Number.isFinite(value)) return MIN_METRIC_COMMAND_SHARDS;
  return Math.min(
    MAX_METRIC_COMMAND_SHARDS,
    Math.max(MIN_METRIC_COMMAND_SHARDS, Math.trunc(value)),
  );
}

function resolveMetricCommandShardCount(value: string | undefined): number {
  if (!value) return DEFAULT_METRIC_COMMAND_SHARDS;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? clampMetricCommandShardCount(parsed)
    : DEFAULT_METRIC_COMMAND_SHARDS;
}

/** Spreads a point across a bounded set of ordered lanes by its PointId. */
function metricCommandGroupKey({
  pointId,
  shardCount,
}: {
  pointId: string;
  shardCount: number;
}): string {
  const count = BigInt(clampMetricCommandShardCount(shardCount));
  const lane = BigInt(`0x${sha256(pointId).slice(0, 16)}`) % count;
  return `metric:${lane}`;
}

/**
 * Routes map work across bounded lanes while keeping the same logical identity
 * serialized. Point storage uses PointId; series catalog and rollups use
 * SeriesId so concurrent points cannot race updates for one series.
 */
function metricMapGroupKey({
  identity,
  shardCount,
}: {
  identity: string;
  shardCount: number;
}): string {
  const count = BigInt(clampMetricCommandShardCount(shardCount));
  const lane = BigInt(`0x${sha256(identity).slice(0, 16)}`) % count;
  return `metric-map:${lane}`;
}

export {
  clampMetricCommandShardCount,
  metricCommandGroupKey,
  metricMapGroupKey,
  resolveMetricCommandShardCount,
};
