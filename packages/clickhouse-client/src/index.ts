export type {
  DecideVendorLogInput,
  EmittedLevel,
  EmitVendorLogInput,
  VendorLogDecision,
  VendorLogLevel,
  VendorLogRecord,
  VendorLogger,
  VendorLogSink,
} from "./logging";
export {
  decideVendorLog,
  emitVendorLog,
  vendorLoggerClassFor,
  VENDOR_CAUSE_FIELD,
} from "./logging";
export type { AbortSignalLike, QueryDriver, QueryKind, QueryRequest, QueryResult } from "./query";
export type { ClickHouseQueryClientOptions } from "./client";
export { ClickHouseQueryClient } from "./client";
export {
  ClickHouseConfigService,
  DuplicatePrivateClickHouseRouteError,
  InvalidClickHouseConfigurationError,
} from "./config";
export type {
  ClickHouseConfiguration,
  ClickHouseConfigurationInput,
  ClickHousePrivateRouteConfiguration,
  ClickHouseSharedConfiguration,
} from "./config";
export {
  ClickHouseClientFactory,
  ClickHouseConnection,
  ClickHouseConnectionClosedError,
  ClickHouseConnectionService,
  ClickHouseNotConfiguredError,
} from "./connection";
export type {
  ClickHouseClientCreationInput,
  ClickHouseCloseableClient,
  ClickHouseConnectionServiceOptions,
  ClickHouseInstance,
} from "./connection";
export { ClickHouseShutdownService } from "./shutdown";
export {
  ClickHouseManagedClientService,
  ClickHouseManagedClientLogger,
  ClickHouseManagedClientTelemetry,
  ClickHouseOverloadErrorFactory,
  ClickHouseVendorClientFactory,
  createVendorClientResiliencePolicy,
  createResilientVendorClient,
  withClickHouseDefaultQuerySettings,
  withClickHouseStatementLimit,
  DEFAULT_CLICKHOUSE_IDLE_SOCKET_TTL_MS,
  DEFAULT_CLICKHOUSE_REQUEST_TIMEOUT_MS,
  DEFAULT_MIN_STATEMENT_QUEUE_DEPTH,
  DEFAULT_STATEMENT_QUEUE_DEPTH_PER_SLOT,
  DEFAULT_STATEMENT_WAIT_TIMEOUT_MS,
} from "./managed-client";
export type {
  ClickHouseManagedClientOptions,
  ClickHouseStatementLimitOptions,
  ClickHouseStatementOperation,
  ClickHouseVendorClient,
  ClickHouseVendorClientOptions,
} from "./managed-client";
export type { PoolSizeSource, PoolSizingDecision, PoolSizingInput } from "./pool";
export {
  DEFAULT_CLIENTS_PER_PROCESS,
  DEFAULT_SERVER_MAX_CONCURRENT_QUERIES,
  DEFAULT_SERVER_NODES,
  deriveFleetPoolCeiling,
  FALLBACK_POOL_SIZE,
  FLEET_SAFETY_FACTOR,
  MAX_POOL_SIZE,
  MIN_POOL_SIZE,
  poolSizingFromEnv,
  resolvePoolSize,
} from "./pool";
export type { ConcurrencyLimiterOptions, LimiterStats } from "./rateLimit";
export { AcquireAbortedError, ConcurrencyLimiter, QueueFullError } from "./rateLimit";
export type { BackoffInput, TransientClassificationInput } from "./resilience";
export {
  isTransientClickHouseError,
  jitteredBackoffMs,
  QUERY_CAUSE_FIELD,
  RETRY_CAUSE_FIELD,
  retryNoticeLevel,
  TRANSIENT_HTTP_STATUSES,
  TRANSIENT_NETWORK_CODES,
} from "./resilience";
export type { RetryAttemptNotice, RetryNotice, RetryOptions, RunWithRetryOptions } from "./retry";
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
export type { StatementLogSink, StatementMetrics, StatementOutcome } from "./statementReporting";
export type { VendorQueryType } from "./statementShape";
export type { VendorClientResilienceOptions, VendorStatementClient } from "./vendorClient";
export {
  VendorClientPolicy,
  VendorClientResilience,
  VendorClientResiliencePolicy,
} from "./vendorClient";
export { checkTenantScope, TenantGuard, TenantScopeError } from "./tenantGuard";
export type {
  QueryErrorDescriptor,
  QueryOutcome,
  SpanPort,
  TraceOptions,
  TracerPort,
} from "./tracing";
export { describeQueryError, QueryTracer, SPAN_ATTRIBUTES } from "./tracing";
export type {
  RetentionDaysProvider,
  RetentionFloorLogger,
  RetentionFloorQuery,
  RetentionFloorServiceOptions,
} from "./retentionFloor";
export {
  DEFAULT_RETENTION_CACHE_MAX_ENTRIES,
  DEFAULT_RETENTION_CACHE_TTL_MS,
  DEFAULT_RETENTION_FLOOR_MARGIN_MS,
  RetentionFloorService,
} from "./retentionFloor";

/** The per-query and per-insert settings every non-analytics statement carries.
 * Was `platform/app/src/server/clickhouse/queryDefaults.ts`. */
export { DEFAULT_CLICKHOUSE_SETTINGS, READ_BACK_FOLD_INSERT_SETTINGS } from "./queryDefaults";

/** The `CLICKHOUSE_URL__<label>__<org>` private-route key grammar.
 * Was `platform/app/src/server/clickhouse/privateRouteKey.ts`. */
export * from "./privateRouteKey";

/** The ClickHouse schema migration task — goose runner, TTL reconciliation,
 * and the `@langwatch/task` catalogue entry that runs both. */
export { ClickHouseMigrateTask } from "./tasks/clickhouse-migrate.task";
export { parseConnectionUrl } from "./tasks/goose.migration-runner";
export type { ClickHouseConfig } from "./tasks/goose.migration-runner";

/** Every time-partitioned table's prunable columns — the one map the
 * trace-server cold-scan detector and the analytics-server JOIN bound guard
 * both read, so they can't drift apart. */
export { TIME_PARTITIONED_TABLES } from "./timePartitionedTables";
