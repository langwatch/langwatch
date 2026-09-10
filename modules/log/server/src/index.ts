export { LogApp } from "./app/log.app.ts";
export type { LogInfrastructure } from "./app/log.app.ts";
export { logServer } from "./log.server.ts";
export { CanonicalLogAdapter } from "./services/canonical-log.service.ts";
export { ClickhouseLogProcessingRepository } from "./repositories/clickhouse/clickhouse.log-processing.repository.ts";
export type { LogProcessingPipeline } from "./services/log-processing.service.ts";
export { ClickhouseLogRepository } from "./repositories/clickhouse/clickhouse.log.repository.ts";

/**
 * The OTLP LOG signal's collection: one export request in, canonical records
 * and their trace contributions out. Was
 * `platform/app/src/server/app-layer/traces/log-request-collection.service.ts`.
 */
export type { LogTraceIoExtractor, LogTraceIo } from "./app/log.infrastructure.ts";
export {
  LogRequestCollectionService,
  type LogRequestCollectionDeps,
  type LogRequestCollectionResult,
} from "./services/log-request-collection.service.ts";
