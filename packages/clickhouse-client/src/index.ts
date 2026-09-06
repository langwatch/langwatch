export type {
  DecideVendorLogInput,
  EmittedLevel,
  EmitVendorLogInput,
  VendorLogDecision,
  VendorLogLevel,
  VendorLogRecord,
  VendorLogger,
  VendorLogSink,
} from "./logging.ts";
export {
  decideVendorLog,
  emitVendorLog,
  vendorLoggerClassFor,
  VENDOR_CAUSE_FIELD,
} from "./logging.ts";
export type { AbortSignalLike, QueryDriver, QueryKind, QueryRequest, QueryResult } from "./query.ts";
export type { ClickHouseQueryClientOptions } from "./client.ts";
export { ClickHouseQueryClient } from "./client.ts";
export {
  ClickHouseConfigService,
  DuplicatePrivateClickHouseRouteError,
  InvalidClickHouseConfigurationError,
} from "./config.ts";
export type {
  ClickHouseConfiguration,
  ClickHouseConfigurationInput,
  ClickHousePrivateRouteConfiguration,
  ClickHouseSharedConfiguration,
} from "./config.ts";
export {
  ClickHouseClientFactory,
  ClickHouseConnection,
  ClickHouseConnectionClosedError,
  ClickHouseConnectionService,
  ClickHouseNotConfiguredError,
} from "./connection.ts";
export type {
  ClickHouseClientCreationInput,
  ClickHouseCloseableClient,
  ClickHouseConnectionServiceOptions,
  ClickHouseInstance,
} from "./connection.ts";
export { ClickHouseShutdownService } from "./shutdown.ts";
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
  withClickHouseTenantScope,
  DEFAULT_CLICKHOUSE_IDLE_SOCKET_TTL_MS,
  DEFAULT_CLICKHOUSE_REQUEST_TIMEOUT_MS,
  DEFAULT_MIN_STATEMENT_QUEUE_DEPTH,
  DEFAULT_STATEMENT_QUEUE_DEPTH_PER_SLOT,
  DEFAULT_STATEMENT_WAIT_TIMEOUT_MS,
} from "./managed-client.ts";
export type {
  ClickHouseManagedClientOptions,
  ClickHouseStatementLimitOptions,
  ClickHouseStatementOperation,
  ClickHouseVendorClient,
  ClickHouseVendorClientOptions,
  UnscopedStatementDeclaration,
} from "./managed-client.ts";
export type { PoolSizeSource, PoolSizingDecision, PoolSizingInput } from "./pool.ts";
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
} from "./pool.ts";
export type { ConcurrencyLimiterOptions, LimiterStats } from "./rateLimit.ts";
export { AcquireAbortedError, ConcurrencyLimiter, QueueFullError } from "./rateLimit.ts";
export type { BackoffInput, TransientClassificationInput } from "./resilience.ts";
export {
  isTransientClickHouseError,
  jitteredBackoffMs,
  QUERY_CAUSE_FIELD,
  RETRY_CAUSE_FIELD,
  retryNoticeLevel,
  TRANSIENT_HTTP_STATUSES,
  TRANSIENT_NETWORK_CODES,
} from "./resilience.ts";
export type { RetryAttemptNotice, RetryNotice, RetryOptions, RunWithRetryOptions } from "./retry.ts";
export { RetryPolicy, runWithRetry } from "./retry.ts";
export type {
  RoutingTable,
  TenantDirectory,
  TenantRoute,
  TenantRouter,
  TenantRouterOptions,
} from "./tenancy.ts";
export {
  createTenantRouter,
  DuplicateRouteError,
  PLATFORM_TENANT,
  PRIVATE_ROUTE_ENV_PREFIX,
  parseRoutingTable,
  UnknownTenantError,
} from "./tenancy.ts";
export type { TenantGuardOptions, TenantScopeViolation } from "./tenantGuard.ts";
export type { StatementLogSink, StatementMetrics, StatementOutcome } from "./statementReporting.ts";
export type { VendorQueryType } from "./statementShape.ts";
export type { VendorClientResilienceOptions, VendorStatementClient } from "./vendorClient.ts";
export {
  VendorClientPolicy,
  VendorClientResilience,
  VendorClientResiliencePolicy,
} from "./vendorClient.ts";
export {
  checkStatementTenantScope,
  checkTenantScope,
  describeTenantScopeViolation,
  tableNamedBy,
  TenantGuard,
  TenantScopeError,
} from "./tenantGuard.ts";
export type {
  QueryErrorDescriptor,
  QueryOutcome,
  SpanPort,
  TraceOptions,
  TracerPort,
} from "./tracing.ts";
export { describeQueryError, QueryTracer, SPAN_ATTRIBUTES } from "./tracing.ts";
export type {
  RetentionDaysProvider,
  RetentionFloorLogger,
  RetentionFloorQuery,
  RetentionFloorServiceOptions,
} from "./retentionFloor.ts";
export {
  DEFAULT_RETENTION_CACHE_MAX_ENTRIES,
  DEFAULT_RETENTION_CACHE_TTL_MS,
  DEFAULT_RETENTION_FLOOR_MARGIN_MS,
  RetentionFloorService,
} from "./retentionFloor.ts";

/** The per-query and per-insert settings every non-analytics statement carries.
 * Was `platform/app/src/server/clickhouse/queryDefaults.ts`. */
export { DEFAULT_CLICKHOUSE_SETTINGS, READ_BACK_FOLD_INSERT_SETTINGS } from "./queryDefaults.ts";

/** The `CLICKHOUSE_URL__<label>__<org>` private-route key grammar.
 * Was `platform/app/src/server/clickhouse/privateRouteKey.ts`. */
export * from "./privateRouteKey.ts";

/** The ClickHouse schema migration task — goose runner, TTL reconciliation,
 * and the `@langwatch/task` catalogue entry that runs both. */
export {
  ClickHouseSchemaLock,
  DEFAULT_CLICKHOUSE_SCHEMA_LOCK_PATH,
  type ClickHouseSchemaLockOptions,
} from "./schema-lock.ts";
export { ClickHouseMigrateTask } from "./tasks/clickhouse-migrate.task.ts";
export { parseConnectionUrl } from "./tasks/goose.migration-runner.ts";
export type { ClickHouseConfig } from "./tasks/goose.migration-runner.ts";

/** Every time-partitioned table's prunable columns — the one map the
 * trace-server cold-scan detector and the analytics-server JOIN bound guard
 * both read, so they can't drift apart. */
export { TIME_PARTITIONED_TABLES } from "./timePartitionedTables.ts";
