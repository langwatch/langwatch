export { ClickHouseMetricProcessingAdapter } from "./adapters/clickhouse.metric-processing.adapter";
export { MetricRuntimeAdapter } from "./adapters/runtime.metric.adapter";
export {
  type MetricProcessingPipeline,
  resolveMetricCommandShardCount,
} from "./adapters/metric-processing.adapter";

/**
 * The OTLP METRIC signal's collection: one export request in, metric
 * correlations out. Was
 * `platform/app/src/server/app-layer/traces/metric-request-collection.service.ts`.
 */
export {
  MetricRequestCollectionService,
  type MetricRequestCollectionDeps,
  type MetricRequestCollectionResult,
} from "./services/metric-request-collection.service";
