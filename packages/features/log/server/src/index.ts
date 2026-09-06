export { CanonicalLogAdapter } from "./adapters/canonical-log.adapter.ts";
export { ClickHouseLogProcessingAdapter } from "./adapters/clickhouse.log-processing.adapter.ts";
export type { LogProcessingPipeline } from "./adapters/log-processing.adapter.ts";
export { LogRuntimeAdapter } from "./adapters/runtime.log.adapter.ts";

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
