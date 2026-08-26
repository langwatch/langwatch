import {
  type AppendStore,
  defineAggregate,
  defineEvents,
  definePipeline,
  type EventSubscriberDefinition,
} from "@langwatch/eventing";
import { metricCommandGroupKey } from "./metric-shards.adapter";
import { RecordMetricDataPointCommand } from "./record-metric-data-point.adapter";
import { MetricDataPointStorageMapProjection } from "../projections/metric-data-point-storage.projection";
import { MetricSeriesCatalogMapProjection } from "../projections/metric-series-catalog.projection";
import { MetricTimeRollupMapProjection } from "../projections/metric-time-rollup.projection";
import {
  METRIC_COMMAND_COALESCE_MAX_BATCH,
  METRIC_PROCESSING_EVENT_TYPES,
} from "@langwatch/telemetry-contract";
import type { MetricProcessingEvent } from "./telemetry-event.adapter";
import type { CanonicalMetricDataPoint } from "@langwatch/telemetry-contract";
import type { MetricDataPointAppendPort } from "../ports/telemetry-repositories.port";
import {
  MetricDataPointAppendStore,
  MetricSeriesCatalogAppendStore,
  MetricTimeRollupAppendStore,
} from "../stores/metric-projection/metric-projection.store";

export interface MetricProcessingPipelineDeps {
  metricDataPointAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricSeriesCatalogAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricTimeRollupAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricCommandShardCount: number;
  /** Cross-pipeline dispatchers (e.g. coding-agent metric-facts, ADR-056). */
  subscribers?: EventSubscriberDefinition<MetricProcessingEvent>[];
}

export interface MetricProcessingAdapterOptions {
  repository: MetricDataPointAppendPort;
  defaultRetentionDays: number;
  metricCommandShardCount: number;
  subscribers?: EventSubscriberDefinition<MetricProcessingEvent>[];
}

function createMetricProcessingPipeline(deps: MetricProcessingPipelineDeps) {
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

  build(): ReturnType<typeof createMetricProcessingPipeline> {
    const repository = this.options.repository;
    const retentionDays = this.options.defaultRetentionDays;

    return createMetricProcessingPipeline({
      metricDataPointAppendStore: MetricDataPointAppendStore.create(
        repository,
        retentionDays,
      ),
      metricSeriesCatalogAppendStore: MetricSeriesCatalogAppendStore.create(
        repository,
        retentionDays,
      ),
      metricTimeRollupAppendStore: MetricTimeRollupAppendStore.create(
        repository,
        retentionDays,
      ),
      metricCommandShardCount: this.options.metricCommandShardCount,
      subscribers: this.options.subscribers,
    });
  }
}

export { createMetricProcessingPipeline };
