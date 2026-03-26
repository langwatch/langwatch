// Barrel re-export — all implementation has moved to ./clickhouse/
export {
  type ClickHouseErrorType,
  classifyClickHouseError,
  isTransientClickHouseError,
} from "./clickhouse/error-classification";

export { FailureRateMonitor } from "./clickhouse/failure-monitor";

export { createResilientClickHouseClient } from "./clickhouse/resilient-client";
