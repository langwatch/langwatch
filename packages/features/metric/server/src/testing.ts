export { point } from "./fixtures/metric.fixture";
export { CanonicalMetricAdapter } from "./adapters/canonical-metric.adapter";
export { canonicalAttributes } from "./adapters/metric-attributes.rules";
export { stableStringify } from "./adapters/metric-serialization.rules";
export { MetricService } from "./services/metric.service";
export type { MetricClickHouseClient } from "./repositories/clickhouse/clickhouse.metric-data-point-append.repository";
