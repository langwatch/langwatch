export {
  OpsApp,
  OpsConfirmationRequiredError,
  OpsImpersonatedOperatorRefusedError,
  OpsOperatorSessionRequiredError,
  OpsUnknownFeatureFlagError,
  type OpsAppDependencies,
  type OpsBadgeReading,
  type OpsCapability,
  type OpsEventExplorer,
  type OpsOperator,
  type OpsProcessExplorer,
  type OpsProcessRef,
  type OpsReplayRunner,
} from "./app/ops.app";
export {
  BugReportTrpcApi,
  BUG_REPORTS_NO_PERMISSION,
  type BugReportTrpcContext,
  type BugReportTrpcPorts,
} from "./transport/api-trpc/bug-report.api";
export { BugReportRepositoryPort } from "./ports/bug-report.port";
export { PrismaBugReportRepository } from "./repositories/prisma/prisma.bug-report.repository";
export { BugReportInboxService, type BugReportListing } from "./services/bug-report-inbox.service";
export {
  OpsTrpcApi,
  type OpsScope,
  type OpsTrpcContext,
  type OpsTrpcPorts,
} from "./transport/api-trpc/ops.api";
export {
  PostgresOpsAdapter,
  type PostgresOpsAdapterOptions,
} from "./adapters/postgres.ops.adapter";
export {
  RedisOpsSnapshotAdapter,
  type RedisOpsSnapshotAdapterOptions,
} from "./adapters/redis.ops-snapshot.adapter";
export {
  RedisSchedulerWakeAdapter,
  type SchedulerWakeRedis,
} from "./adapters/redis.scheduler-wake.adapter";
export { OpsSnapshotRedisPort } from "./ports/ops-snapshot-redis.port";
export { NoopSchedulerAuditSink, SchedulerAuditSinkPort } from "./ports/scheduler-audit-sink.port";
export type {
  SchedulerOpsRepository,
  ScheduledJobRecord,
} from "./repositories/scheduler-ops.repository";
export { NoopSchedulerWakeService, SchedulerWakeService } from "./services/scheduler-wake.service";
export {
  type AdminAccess,
  AdminAccessService,
  type AdminAccessServiceOptions,
} from "./services/admin-access.service";
export { AdminAuditSink } from "./services/impersonation.service";
export * from "./rules/ops-error-normalizer.rules";
export * from "./rules/ops-redis-engine-cpu.rules";
export { OpsWorkerAdapter, type OpsWorkerAdapterOptions } from "./adapters/ops-worker.adapter";
export { AnomalyHardTierAlertPort } from "./ports/anomaly-hard-tier-alert.port";
export { StorageStatsMetricsPort } from "./ports/storage-stats-metrics.port";
export { OtelStorageStatsMetricsAdapter } from "./adapters/otel.storage-stats-metrics.adapter";
export {
  StorageStatsCollectionService,
  type StorageStatsClickHouseClient,
  type StorageStatsCollectionHandle,
  type StorageStatsCollectionOptions,
  type StorageStatsInstance,
} from "./services/storage-stats-collection.service";
export { QueuePayloadDecoderPort } from "./ports/queue-payload-decoder.port";
export {
  UsageStatsErrorReporterPort,
  UsageStatsClickHouseClientPort,
  UsageStatsClickHouseClientResolverPort,
  UsageStatsTelemetryClientPort,
  type UsageStatsClickHouseQuery,
  type UsageStatsClickHouseQueryResult,
  type UsageStatsWorkerDatabase,
} from "./ports/usage-stats-worker.port";
export {
  OpsWorkerPort,
  type OpsWorkerHandle,
  type UsageStatsWorkerConfig,
} from "./ports/ops-worker.port";

/** The operations explorers and the replay runner, moved off the application. */
export { EventExplorerService } from "./services/event-explorer.service";
export {
  ManagerExplorerService,
  OVERDUE_PENDING_MS,
  OVERDUE_WAKE_MS,
} from "./services/manager-explorer.service";
export { LOCK_REFRESH_INTERVAL_MS, ReplayService } from "./services/replay.service";
export { OpsMetricsCollectorService } from "./services/ops-metrics-collector.service";
export { totalInFlight, type InFlightCounts } from "./rules/ops-in-flight.rules";
export {
  OpsEventingIntrospectionPort,
  type OpsDejaViewProjection,
  type OpsProcessManagerMetadata,
  type OpsProjectionMetadata,
} from "./ports/eventing-introspection.port";
export { EventingOpsIntrospectionAdapter } from "./adapters/eventing.ops-introspection.adapter";
export { OpsReplayRuntimePort, type OpsReplayRuntime } from "./ports/replay-runtime.port";
export { NullEventExplorerRepository } from "./adapters/null.event-explorer.adapter";
export type {
  AggregateDiscoveryRow,
  EventExplorerRepository,
  RawEventRow,
} from "./repositories/event-explorer.repository";
export { NullProcessOpsRepository } from "./adapters/null.process-ops.adapter";
export type {
  ProcessNameCounts,
  ProcessOpsRepository,
} from "./repositories/process-ops.repository";
export { NullReplayRepository } from "./adapters/null.replay.adapter";
export type { ReplayRepository } from "./repositories/replay.repository";
export { ProcessOpsPrismaRepository } from "./repositories/prisma/prisma.process-ops.repository";
export { EventExplorerClickHouseRepository } from "./repositories/clickhouse/clickhouse.event-explorer.repository";
export { OpsExplainClickHouseRepository } from "./repositories/clickhouse/clickhouse.ops-explain.repository";
export {
  OpsExplainClientResolver,
  type OpsExplainClientResolution,
} from "./repositories/ops-explain.repository";

/** Public intake for the reports customers' coding agents file. */
export {
  BugReportIntakeService,
  BugReportRateLimitedError,
  type SubmitBugReportInput,
} from "./services/bug-report-intake.service";
export { BugReportNotifierPort, SilentBugReportNotifier } from "./ports/bug-report-notifier.port";
export { BugReportRateLimiterPort } from "./ports/bug-report-rate-limiter.port";
export {
  SlackBugReportNotifierAdapter,
  type OpsSlackAlertTransport,
  type SlackBugReportNotifierConfig,
} from "./adapters/slack.bug-report-notifier.adapter";

// The system-migration ops model, its cohort policy and the Prisma/Redis
// implementations of the runner's repository interfaces. All were
// `platform/app/src/server/app-layer/system-migrations/`; the generic runner
// stays in `@langwatch/system-migrations`.
export {
  SystemMigrationsService,
  type MigrationEnrollmentRecord,
  type SystemMigrationEnrollmentStore,
  type SystemMigrationStateReader,
} from "./services/system-migrations.service";
export {
  migrationRunsOnThisInstallation,
  organizationMigrates,
} from "./rules/ops-system-migration-cohort.rules";
export {
  PostgresSystemMigrationsAdapter,
  type PostgresSystemMigrationsAdapterOptions,
} from "./adapters/postgres.system-migrations.adapter";
export { SystemMigrationsPassTask } from "./tasks/system-migrations-pass.task";
export {
  ProcessManagerPurgeTask,
  purgeProcessManagerTables,
  type ProcessManagerPurgeOptions,
  type ProcessManagerPurgeReport,
} from "./tasks/process-manager-purge.task";
export { PostgresProcessManagerPurgeAdapter } from "./adapters/postgres.process-manager-purge.adapter";
export type {
  ProcessManagerPurgeRepository,
  ProcessManagerPurgeTarget,
} from "./repositories/process-manager-purge.repository";

// The back-office REST transport: impersonation, and the React Admin resource
// operations. Its two session reads are ports, because who is acting and which
// auth row they are acting on are the deployment's facts, not this feature's.
export {
  createAdminRestApp,
  type AdminRestActor,
  type AdminRestPorts,
  type AdminRestSessionPorts,
} from "./transport/api-rest/admin.api";

// The public issue-report intake, `POST /api/bug-reports`. Its optional
// project credential is a port: reading one off a request is the deployment's
// published precedence, and a second reading here is how the two would drift.
export {
  createBugReportsRestApp,
  type BugReportRestCredentialReader,
  type BugReportRestPorts,
} from "./transport/api-rest/bug-report.api";

// The operator-only ClickHouse EXPLAIN endpoint: the pure query guards and the
// decision about which client an EXPLAIN is allowed to reach.
export {
  ALLOWED_EXPLAIN_TYPES,
  buildExplainQuery,
  CLICKHOUSE_GUARDRAILS,
  explainBodySchema,
  type ExplainType,
  OpsClickHouseRuntime,
  type ParseResult,
  parseOpsConnection,
  redactQueryForAudit,
  stripCommentsAndStrings,
} from "./adapters/ops-clickhouse-explain.adapter";
export {
  type OpsExplainOutcome,
  OpsExplainService,
} from "./services/ops-clickhouse-explain.service";
export {
  createOpsClickHouseExplainRestApp,
  type OpsClickHouseExplainRestPorts,
} from "./transport/api-rest/ops-clickhouse-explain.api";
