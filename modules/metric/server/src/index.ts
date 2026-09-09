export { metricServer } from "./metric.server.ts";
export { ClickHouseMetricProcessingAdapter } from "./adapters/clickhouse.metric-processing.adapter.ts";
export {
  type MetricProcessingPipeline,
  resolveMetricCommandShardCount,
} from "./adapters/metric-processing.adapter.ts";

/**
 * The OTLP METRIC signal's collection: one export request in, metric
 * correlations out. Was
 * `platform/app/src/server/app-layer/traces/metric-request-collection.service.ts`.
 */
export {
  MetricRequestCollectionService,
  type MetricRequestCollectionDeps,
  type MetricRequestCollectionResult,
} from "./services/metric-request-collection.service.ts";
