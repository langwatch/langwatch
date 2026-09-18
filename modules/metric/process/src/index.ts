export { metricServer } from "./metric.server.ts";
export type { MetricProcessingPipeline } from "./services/metric-processing.service.ts";

// Restored: these names have consumers outside this module.
export { ClickhouseMetricProcessingRepository } from "./repositories/clickhouse/clickhouse.metric-processing.repository.ts";
export { resolveMetricCommandShardCount } from "./services/metric-processing.service.ts";
