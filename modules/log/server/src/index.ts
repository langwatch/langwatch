export { LogApp } from "./app/log.app.ts";
export type { LogInfrastructure } from "./app/log.app.ts";
export { logServer } from "./log.server.ts";
export { CanonicalLogAdapter } from "./adapters/canonical-log.adapter.ts";
export { ClickhouseLogProcessingRepository as ClickHouseLogProcessingAdapter } from "./repositories/clickhouse/clickhouse.log-processing.repository.ts";
export type { LogProcessingPipeline } from "./adapters/log-processing.adapter.ts";
export { ClickhouseLogRepository as LogRuntimeAdapter } from "./repositories/clickhouse/clickhouse.log.repository.ts";

/**
 * The OTLP LOG signal's collection: one export request in, canonical records
 * and their trace contributions out. Was
 * `platform/app/src/server/app-layer/traces/log-request-collection.service.ts`.
 */
export { LogTraceIoPort, type LogTraceIo } from "./ports/log-trace-io.port.ts";
export {
  LogRequestCollectionService,
  type LogRequestCollectionDeps,
  type LogRequestCollectionResult,
} from "./services/log-request-collection.service.ts";
