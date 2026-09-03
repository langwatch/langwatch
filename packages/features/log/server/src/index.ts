export { CanonicalLogAdapter } from "./adapters/canonical-log.adapter";
export { ClickHouseLogProcessingAdapter } from "./adapters/clickhouse.log-processing.adapter";
export type { LogProcessingPipeline } from "./adapters/log-processing.adapter";
export { LogRuntimeAdapter } from "./adapters/runtime.log.adapter";

/**
 * The OTLP LOG signal's collection: one export request in, canonical records
 * and their trace contributions out. Was
 * `platform/app/src/server/app-layer/traces/log-request-collection.service.ts`.
 */
export {
  LogRequestCollectionService,
  type LogRequestCollectionDeps,
  type LogRequestCollectionResult,
} from "./services/log-request-collection.service";
