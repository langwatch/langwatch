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
export type {
  AbortSignalLike,
  InsertRequest,
  QueryDriver,
  QueryKind,
  QueryRequest,
  QueryResult,
} from "./query.ts";
export type { ClickHouseQueryClientOptions } from "./client.ts";
export {
  CLICKHOUSE_COLUMNS_QUERY,
  CLICKHOUSE_COLUMNS_REFRESH_MS,
  ClickHouseColumns,
} from "./present-columns.ts";
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
  ClickHouseShutdownService,
} from "./connection.ts";
export type {
  ClickHouseClientCreationInput,
  ClickHouseCloseableClient,
  ClickHouseConnectionServiceOptions,
  ClickHouseInstance,
} from "./connection.ts";
export {
  ClickHouseManagedClientService,
  ClickHouseManagedClientLogger,
  ClickHouseManagedClientTelemetry,
  ClickHouseOverloadErrorFactory,
  ClickHouseStatementAdmission,
  ClickHouseVendorClientFactory,
  createVendorClientResiliencePolicy,
  createResilientVendorClient,
  DEFAULT_CLICKHOUSE_SETTINGS,
  READ_BACK_FOLD_INSERT_SETTINGS,
  withClickHouseDefaultQuerySettings,
  withClickHouseStatementLimit,
  withClickHouseTenantScope,
  DEFAULT_CLICKHOUSE_IDLE_SOCKET_TTL_MS,
  DEFAULT_CLICKHOUSE_REQUEST_TIMEOUT_MS,
  DEFAULT_MIN_STATEMENT_QUEUE_DEPTH,
  DEFAULT_STATEMENT_QUEUE_DEPTH_PER_SLOT,
  DEFAULT_STATEMENT_LANE_RESERVE_SHARE,
  DEFAULT_STATEMENT_WAIT_TIMEOUT_MS,
  statementLaneCaps,
} from "./managed-client.ts";
export type {
  ClickHouseLaneStats,
  ClickHouseManagedClientOptions,
  ClickHouseStatementAdmissionOptions,
  ClickHouseStatementLane,
  ClickHouseStatementLimitOptions,
  ClickHouseStatementOperation,
  ClickHouseVendorClient,
  ClickHouseVendorClientOptions,
  UnscopedStatementDeclaration,
} from "./managed-client.ts";
export type { RoutableStatementClient } from "./routingDriver.ts";
export { routingDriver } from "./routingDriver.ts";
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
export type {
  RetryAttemptNotice,
  RetryNotice,
  RetryOptions,
  RunWithRetryOptions,
} from "./retry.ts";
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
export {
  StatementReporter,
  type StatementLogSink,
  type StatementMetrics,
  type StatementOutcome,
} from "./statementReporting.ts";
export type { VendorQueryType } from "./statementShape.ts";
export type { VendorClientResilienceOptions, VendorStatementClient } from "./vendorClient.ts";
export {
  VendorClientPolicy,
  VendorClientResilience,
  VendorClientResiliencePolicy,
} from "./vendorClient.ts";
export {
  checkInsertTenantScope,
  checkStatementTenantScope,
  checkTenantScope,
  describeTenantScopeViolation,
  tableNamedBy,
  TenantGuard,
  TenantScopeError,
} from "./tenantGuard.ts";
export type { QueryErrorDescriptor, QueryOutcome, Span, TraceOptions, Tracer } from "./tracing.ts";
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

/** The ClickHouse schema migration task — goose runner, TTL reconciliation,
 * and the `@langwatch/task` catalogue entry that runs both. */
export {
  ClickHouseSchemaLock,
  DEFAULT_CLICKHOUSE_SCHEMA_LOCK_PATH,
  type ClickHouseSchemaLockOptions,
} from "./schema-lock.ts";

/** Every time-partitioned table's prunable columns — the one map the cold-scan
 * detector and the analytics-server JOIN bound guard both read, so they can't
 * drift apart. */
export { detectColdScan } from "./coldScanDetector.ts";
export { TIME_PARTITIONED_TABLES } from "./timePartitionedTables.ts";

/** The partition-window read policy (ADR-068): one hinted attempt, a graceful
 * widening, and exactly one counted outcome. Shared so trace and scenario reads
 * prune and report identically instead of each carrying their own copy. */
export {
  DEFAULT_PARTITION_WINDOW_MS,
  RESOLVER_RECENT_WINDOW_MS,
  queryWindowed,
  setWindowedReadMetrics,
} from "./windowedRead.ts";
export type {
  QueryWindowedOptions,
  WindowFallback,
  WindowFragment,
  WindowedReadMetrics,
  WindowedReadOutcome,
} from "./windowedRead.ts";
export type {
  ClickHouseClientResolver,
  ReadResource,
  StatementScopeViolation,
  TenantScopeTimeColumn,
} from "./authorized-reads.ts";
export {
  AuthorizedClickHouse,
  expandFragment,
  expandStatement,
  fenceExpression,
  fenceFor,
  HAND_WRITTEN_TENANT_PREDICATE,
  ownProjectIdOf,
  PROOF_BEARING_PERMISSIONS,
  singleTenantOf,
  StatementScopeError,
  TenantReaderClientUnavailableError,
  TenantScopedReader,
  tenantScope,
  tenantScopeKey,
  tenantSet,
} from "./authorized-reads.ts";
