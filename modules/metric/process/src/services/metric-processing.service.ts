import {
  type Command,
  type CommandHandler,
  type AppendStore,
  createTenantId,
  defineAggregate,
  defineCommandSchema,
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
  METRIC_COMMAND_COALESCE_MAX_BATCH,
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
  METRIC_DATA_POINT_RECEIVED_EVENT_VERSION_LATEST,
  RECORD_METRIC_DATA_POINT_COMMAND_TYPE,
  recordMetricDataPointCommandDataSchema,
  metricDataPointReceivedEventSchema,
} from "@langwatch/metric-contract";

import { MetricDataPointStorageMapProjection } from "../eventing/metric-data-point-storage.projection.ts";
import { MetricSeriesCatalogMapProjection } from "../eventing/metric-series-catalog.projection.ts";
import { MetricTimeRollupMapProjection } from "../eventing/metric-time-rollup.projection.ts";
import type { MetricDataPointAppendRepository } from "../repositories/metric-data-point-append.repository.ts";
import { metricCommandGroupKey } from "../rules/metric-command-lanes.rules.ts";
import {
  MetricDataPointAppendStore,
  MetricSeriesCatalogAppendStore,
  MetricTimeRollupAppendStore,
} from "../stores/metric-projection/metric-projection.store.ts";

export interface MetricProcessingPipelineDeps {
  metricDataPointAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricSeriesCatalogAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricTimeRollupAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricCommandShardCount: number;
  /** Cross-pipeline dispatchers (e.g. coding-agent metric-facts, ADR-056). */
  subscribers?: EventSubscriberDefinition<MetricProcessingEvent>[];
}

export interface MetricProcessingServiceOptions {
  repository: MetricDataPointAppendRepository;
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
  let builder = definePipeline({
    name: "metric_processing",
    aggregate: defineAggregate({
      type: "metric",
    }),
  })
    .withEvents([metricDataPointReceivedEventSchema])
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

export class MetricProcessingService {
  private constructor(private readonly options: MetricProcessingServiceOptions) {}

  static create(options: MetricProcessingServiceOptions): MetricProcessingService {
    return new MetricProcessingService(options);
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
