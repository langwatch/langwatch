import { definePipeline } from "../..";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { EventSubscriberDefinition } from "../../subscribers/eventSubscriber.types";
import { metricCommandGroupKey } from "./canonical/shards";
import { RecordMetricDataPointCommand } from "./commands/recordMetricDataPointCommand";
import { MetricDataPointStorageMapProjection } from "./projections/metricDataPointStorage.mapProjection";
import { MetricSeriesCatalogMapProjection } from "./projections/metricSeriesCatalog.mapProjection";
import { MetricTimeRollupMapProjection } from "./projections/metricTimeRollup.mapProjection";
import type { CanonicalMetricDataPoint } from "./schemas/metricDataPoint";
import type { MetricProcessingEvent } from "./schemas/events";

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
  let builder = definePipeline<MetricProcessingEvent>()
    .withName("metric_processing")
    .withAggregateType("metric")
    .withMapProjection(
      "metricDataPointStorage",
      new MetricDataPointStorageMapProjection({
        store: deps.metricDataPointAppendStore,
        shardCount: deps.metricCommandShardCount,
      }),
    )
    .withMapProjection(
      "metricSeriesCatalog",
      new MetricSeriesCatalogMapProjection({
        store: deps.metricSeriesCatalogAppendStore,
        shardCount: deps.metricCommandShardCount,
      }),
    )
    .withMapProjection(
      "metricTimeRollup",
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
    })
    .build();
}
