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
  QueryDriver,
  QueryKind,
  QueryRequest,
  QueryResult,
} from "./query";
export type { ClickHouseQueryClientOptions } from "./client";
export { ClickHouseQueryClient } from "./client";
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
export type { ConcurrencyLimiterOptions, LimiterStats } from "./rateLimit";
export {
  AcquireAbortedError,
  ConcurrencyLimiter,
  QueueFullError,
} from "./rateLimit";
export type {
  BackoffInput,
  TransientClassificationInput,
} from "./resilience";
export {
  isTransientClickHouseError,
  jitteredBackoffMs,
  QUERY_CAUSE_FIELD,
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
export { RetryPolicy, runWithRetry } from "./retry";
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
export { quietly } from "./observability";
export type {
  StatementLogSink,
  StatementMetrics,
  StatementOperation,
  StatementOutcome,
  StatementReporterOptions,
} from "./statementReporting";
export {
  guardedLogSink,
  guardedMetrics,
  StatementReporter,
} from "./statementReporting";
export type { VendorQueryMeta, VendorQueryType } from "./statementShape";
export type {
  VendorClientResilienceOptions,
  VendorStatementClient,
} from "./vendorClient";
export { VendorClientResilience } from "./vendorClient";
export {
  checkTenantScope,
  TenantGuard,
  TenantScopeError,
} from "./tenantGuard";
export type {
  QueryErrorDescriptor,
  QueryOutcome,
  SpanPort,
  TraceOptions,
  TracerPort,
} from "./tracing";
export {
  describeQueryError,
  QueryTracer,
  SPAN_ATTRIBUTES,
} from "./tracing";
