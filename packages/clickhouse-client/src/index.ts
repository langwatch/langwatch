export type {
  DecideVendorLogInput,
  EmittedLevel,
  EmitVendorLogInput,
  VendorLogDecision,
  VendorLogLevel,
  VendorLogRecord,
  VendorLogSink,
} from "./logging";
export {
  decideVendorLog,
  emitVendorLog,
  VENDOR_CAUSE_FIELD,
} from "./logging";
export type {
  AbortSignalLike,
  QueryExecutor,
  QueryKind,
  QueryMiddleware,
  QueryRequest,
  QueryResult,
} from "./pipeline";
export { compose } from "./pipeline";
export type {
  PoolSizeSource,
  PoolSizingDecision,
  PoolSizingInput,
} from "./pool";
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
  ConcurrencyLimiter,
  ConcurrencyLimiterOptions,
  LimiterStats,
} from "./rateLimit";
export {
  AcquireAbortedError,
  createConcurrencyLimiter,
  QueueFullError,
  rateLimit,
} from "./rateLimit";
export type {
  BackoffInput,
  TransientClassificationInput,
} from "./resilience";
export {
  isTransientClickHouseError,
  jitteredBackoffMs,
  RETRY_CAUSE_FIELD,
  retryNoticeLevel,
  TRANSIENT_HTTP_STATUSES,
  TRANSIENT_NETWORK_CODES,
} from "./resilience";
export type {
  RetryAttemptNotice,
  RetryNotice,
  RetryOptions,
  RunWithRetryOptions,
} from "./retry";
export { retry, runWithRetry } from "./retry";
export type {
  RoutingTable,
  TenantDirectory,
  TenantRoute,
  TenantRouter,
  TenantRouterOptions,
} from "./tenancy";
export {
  createTenantRouter,
  DuplicateRouteError,
  PRIVATE_ROUTE_ENV_PREFIX,
  parseRoutingTable,
  UnknownTenantError,
} from "./tenancy";
export type { TenantGuardOptions, TenantScopeViolation } from "./tenantGuard";
export { checkTenantScope, TenantScopeError, tenantGuard } from "./tenantGuard";
export type {
  QueryOutcome,
  SpanPort,
  TraceOptions,
  TracerPort,
} from "./tracing";
export { SPAN_ATTRIBUTES, trace } from "./tracing";
