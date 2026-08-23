import {
  type AppendStore,
  defineAggregate,
  defineEvents,
  definePipeline,
  type EventSubscriberDefinition,
} from "@langwatch/eventing";
import { metricCommandGroupKey } from "./canonical/shards";
import { RecordMetricDataPointCommand } from "./commands/recordMetricDataPointCommand";
import { MetricDataPointStorageMapProjection } from "./projections/metricDataPointStorage.mapProjection";
import { MetricSeriesCatalogMapProjection } from "./projections/metricSeriesCatalog.mapProjection";
import { MetricTimeRollupMapProjection } from "./projections/metricTimeRollup.mapProjection";
import {
  METRIC_COMMAND_COALESCE_MAX_BATCH,
  METRIC_PROCESSING_EVENT_TYPES,
} from "./schemas/constants";
import type { MetricProcessingEvent } from "./schemas/events";
import type { CanonicalMetricDataPoint } from "./schemas/metricDataPoint";

export interface MetricProcessingPipelineDeps {
  metricDataPointAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricSeriesCatalogAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricTimeRollupAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricCommandShardCount: number;
  /** Cross-pipeline dispatchers (e.g. coding-agent metric-facts, ADR-056). */
  subscribers?: EventSubscriberDefinition<MetricProcessingEvent>[];
}

export function createMetricProcessingPipeline(
  deps: MetricProcessingPipelineDeps,
) {
  let builder = definePipeline<MetricProcessingEvent>({
    name: "metric_processing",
    aggregate: defineAggregate({
      type: "metric",
      events: defineEvents(METRIC_PROCESSING_EVENT_TYPES),
    }),
  })
    .withClickHouseMapProjection(
      new MetricDataPointStorageMapProjection({
        store: deps.metricDataPointAppendStore,
        shardCount: deps.metricCommandShardCount,
      }),
    )
    .withClickHouseMapProjection(
      new MetricSeriesCatalogMapProjection({
        store: deps.metricSeriesCatalogAppendStore,
        shardCount: deps.metricCommandShardCount,
      }),
    )
    .withClickHouseMapProjection(
      new MetricTimeRollupMapProjection({
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
