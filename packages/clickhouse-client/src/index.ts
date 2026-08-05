export {
  DEFAULT_CLIENTS_PER_PROCESS,
  DEFAULT_SERVER_MAX_CONCURRENT_QUERIES,
  deriveFleetPoolCeiling,
  FALLBACK_POOL_SIZE,
  FLEET_SAFETY_FACTOR,
  MAX_POOL_SIZE,
  MIN_POOL_SIZE,
  poolSizingFromEnv,
  resolvePoolSize,
} from "./pool";
export type {
  PoolSizeSource,
  PoolSizingDecision,
  PoolSizingInput,
} from "./pool";

export {
  decideVendorLog,
  emitVendorLog,
  VENDOR_CAUSE_FIELD,
} from "./logging";
export type {
  DecideVendorLogInput,
  EmitVendorLogInput,
  EmittedLevel,
  VendorLogDecision,
  VendorLogLevel,
  VendorLogRecord,
  VendorLogSink,
} from "./logging";

export {
  isTransientClickHouseError,
  jitteredBackoffMs,
  RETRY_CAUSE_FIELD,
  retryNoticeLevel,
  TRANSIENT_HTTP_STATUSES,
  TRANSIENT_NETWORK_CODES,
} from "./resilience";
export type {
  BackoffInput,
  TransientClassificationInput,
} from "./resilience";
