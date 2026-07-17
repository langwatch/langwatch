import { definePipeline } from "../..";
import type { AppendStore } from "../../projections/mapProjection.types";
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
}

export function createMetricProcessingPipeline(
  deps: MetricProcessingPipelineDeps,
) {
  return definePipeline<MetricProcessingEvent>()
    .withName("metric_processing")
    .withAggregateType("metric")
    .withMapProjection(
      "metricDataPointStorage",
      new MetricDataPointStorageMapProjection({
        store: deps.metricDataPointAppendStore,
      }),
    )
    .withMapProjection(
      "metricSeriesCatalog",
      new MetricSeriesCatalogMapProjection({
        store: deps.metricSeriesCatalogAppendStore,
      }),
    )
    .withMapProjection(
      "metricTimeRollup",
      new MetricTimeRollupMapProjection({
        store: deps.metricTimeRollupAppendStore,
      }),
    )
    .withCommand("recordDataPoint", RecordMetricDataPointCommand, {
      getGroupKey: (payload) =>
        metricCommandGroupKey({
          pointId: payload.pointId,
          shardCount: deps.metricCommandShardCount,
        }),
    })
    .build();
}
