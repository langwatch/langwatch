export {
  OpsApp,
  OpsConfirmationRequiredError,
  type OpsAppInfrastructure,
  OpsImpersonatedOperatorRefusedError,
  OpsOperatorSessionRequiredError,
  OpsUnknownFeatureFlagError,
  type OpsAppDependencies,
  type OpsBadgeReading,
  type BugReportNotifier,
  type BugReportRateLimiter,
  type OpsCapability,
  type OpsEventLogWindowReader,
  type OpsEventExplorer,
  type OpsGrafanaLinks,
  type OpsPipelineRegistry,
  type OpsSystemMigrationRunner,
  type OpsProcessExplorer,
  type OpsProcessRef,
  type OpsReplayRunner,
} from "./app/ops.app.ts";
export { PrismaBugReportRepository } from "./repositories/prisma/prisma.bug-report.repository.ts";
export { BugReportInboxService } from "./services/bug-report-inbox.service.ts";
export type { BugReportRepository } from "./repositories/admin/bug-report.repository.ts";
export type { OpsRepositories } from "./repositories/ops.repositories.ts";
export { OpsOperations, type OpsOperationsOptions } from "./app/ops-operations.ts";
export { RedisOpsSnapshotRepository } from "./repositories/redis/redis.ops-snapshot.repository.ts";
export { DefaultOpsSnapshotService } from "./services/ops-snapshot-reader.service.ts";
export {
  RedisSchedulerWakeRepository as RedisSchedulerWakeAdapter,
  type SchedulerWakeRedis,
} from "./repositories/redis/redis.scheduler-wake.repository.ts";
export { OpsSnapshotRedisPort } from "./app/ops.app.ts";
export {
  ProcessAuditRepository,
  SchedulerAuditRepository,
  type ProcessControlAction,
} from "./repositories/process/ops-audit.repository.ts";
export { MemoryProcessAuditRepository } from "./repositories/memory/memory.process-audit.repository.ts";
export { MemorySchedulerAuditRepository } from "./repositories/memory/memory.scheduler-audit.repository.ts";
export { MemoryOpsStore } from "./repositories/memory/memory.ops.store.ts";
export type {
  SchedulerOpsRepository,
  ScheduledJobRecord,
} from "./repositories/process/scheduler-ops.repository.ts";
export { NoopSchedulerWakeService } from "./services/scheduler-wake.service.ts";
export { SchedulerWakePort } from "./app/ops.app.ts";
export {
  type AdminAccess,
  AdminAccessService,
  type AdminAccessServiceOptions,
} from "./services/admin-access.service.ts";
export { AdminAuditSink } from "./services/impersonation.service.ts";
export * from "./rules/ops-error-normalizer.rules.ts";
export * from "./rules/ops-redis-engine-cpu.rules.ts";
export { PrismaOpsWorkerRepository as OpsWorkerAdapter, type OpsWorkerAdapterOptions } from "./repositories/prisma/prisma.ops-worker.repository.ts";
export { AnomalyHardTierAlertPort } from "./app/ops.app.ts";
export { StorageStatsMetricsPort } from "./app/ops.app.ts";
export { OtelStorageStatsMetricsAdapter } from "./services/otel.storage-stats-metrics.service.ts";
export {
  StorageStatsCollectionService,
  type StorageStatsClickHouseClient,
  type StorageStatsCollectionHandle,
  type StorageStatsCollectionOptions,
  type StorageStatsInstance,
} from "./services/storage-stats-collection.service.ts";
export { QueuePayloadDecoderPort } from "./app/ops.app.ts";
export {
  UsageStatsErrorReporterPort,
  UsageStatsClickHouseClientPort,
  UsageStatsClickHouseClientResolverPort,
  UsageStatsTelemetryClientPort,
  type UsageStatsClickHouseQuery,
  type UsageStatsClickHouseQueryResult,
  type UsageStatsWorkerDatabase,
} from "./app/ops.app.ts";
export {
  OpsWorkerPort,
  type OpsWorkerHandle,
  type UsageStatsWorkerConfig,
} from "./app/ops.app.ts";

/** The operations explorers and the replay runner, moved off the application. */
export { EventExplorerService } from "./services/event-explorer.service.ts";
export {
  ManagerExplorerService,
  OVERDUE_PENDING_MS,
  OVERDUE_WAKE_MS,
} from "./services/manager-explorer.service.ts";
export { ReplayService } from "./services/replay.service.ts";
export { LOCK_REFRESH_INTERVAL_MS } from "./services/replay-lock-heartbeat.service.ts";
export { OpsMetricsCollectorService } from "./services/ops-metrics-collector.service.ts";
export { OpsQueueMetricsSourceRepository as OpsQueueMetricsSourcePort } from "./repositories/ops-queue-metrics-source.repository.ts";
export { QueueOpsMetricsSourceAdapter } from "./services/queue.ops-queue-metrics-source.service.ts";
export { RedisOpsSnapshotRedisRepository as IoredisOpsSnapshotRedisAdapter } from "./repositories/redis/redis.ops-snapshot-redis.repository.ts";
export { QueueService } from "./services/queue.service.ts";
export { QueueRedisRepository } from "./repositories/redis/queue.repository.ts";
export { RedisOpsMetricsRepository } from "./repositories/redis/redis.ops-metrics.repository.ts";
export { totalInFlight, type InFlightCounts } from "./rules/ops-in-flight.rules.ts";
export {
  OpsEventingIntrospectionPort,
  type OpsDejaViewProjection,
  type OpsProcessManagerMetadata,
  type OpsProjectionMetadata,
} from "./app/ops.app.ts";
export { EventingOpsIntrospectionAdapter } from "./services/eventing.ops-introspection.service.ts";
export { OpsReplayRuntimePort, type OpsReplayRuntime } from "./app/ops.app.ts";
export { MemoryEventExplorerRepository } from "./repositories/memory/memory.event-explorer.repository.ts";
export type {
  AggregateDiscoveryRow,
  EventExplorerRepository,
  RawEventRow,
} from "./repositories/observe/event-explorer.repository.ts";
export { MemoryProcessOpsRepository } from "./repositories/memory/memory.process-ops.repository.ts";
export type {
  ProcessNameCounts,
  ProcessOpsRepository,
} from "./repositories/process/process-ops.repository.ts";
export { MemoryReplayRepository } from "./repositories/memory/memory.replay.repository.ts";
export type { ReplayRepository } from "./repositories/process/replay.repository.ts";
export { ProcessOpsPrismaRepository } from "./repositories/prisma/prisma.process-ops.repository.ts";
export { PrismaProcessAuditRepository } from "./repositories/prisma/prisma.process-audit.repository.ts";
export { EventExplorerClickHouseRepository } from "./repositories/clickhouse/clickhouse.event-explorer.repository.ts";
export { OpsExplainClickHouseRepository } from "./repositories/clickhouse/clickhouse.ops-explain.repository.ts";
export type {
  OpsExplainClientResolution,
  OpsExplainClients,
} from "./repositories/observe/ops-explain.repository.ts";

/** Public intake for the reports customers' coding agents file. */
export {
  BugReportIntakeService,
  BugReportRateLimitedError,
} from "./services/bug-report-intake.service.ts";
export {
  SlackBugReportNotifierAdapter,
  type OpsSlackAlertTransport,
  type SlackBugReportNotifierConfig,
} from "./services/slack.bug-report-notifier.service.ts";

// The system-migration ops model, its cohort policy and the Prisma/Redis
// implementations of the runner's repository interfaces. All were
// `platform/app/src/server/app-layer/system-migrations/`; the generic runner
// stays in `@langwatch/system-migrations`.
export {
  SystemMigrationsService,
  type MigrationEnrollmentRecord,
  type SystemMigrationEnrollmentStore,
  type SystemMigrationStateReader,
} from "./services/system-migrations.service.ts";
export {
  migrationRunsOnThisInstallation,
  organizationMigrates,
} from "./rules/ops-system-migration-cohort.rules.ts";
export {
  OpsSystemMigrations,
  UserStartupMigrationsUnsupportedError,
  type OpsSystemMigrationsOptions,
} from "./app/ops-system-migrations.ts";
// The state rows on their own, for a reader that is not the runner: the
// identity write gate decides a user's fork from the backfill's record.
export { PrismaSystemMigrationStateRepository } from "./repositories/prisma/prisma.system-migration-state.repository.ts";
export { NullOrganizationDataplaneAdapter } from "./services/null.organization-dataplane.service.ts";
export { RoutingTableOrganizationDataplaneAdapter } from "./services/routing-table.organization-dataplane.service.ts";
export {
  type OrganizationDataplane,
  OrganizationDataplanePort,
} from "./app/ops.app.ts";
export {
  type OrganizationCohortAdmission,
  SystemMigrationCohortService,
} from "./services/system-migration-cohort.service.ts";
export { SystemMigrationsPassTask } from "./tasks/system-migrations-pass.task.ts";
export {
  ProcessManagerPurgeTask,
  purgeProcessManagerTables,
  type ProcessManagerPurgeOptions,
  type ProcessManagerPurgeReport,
} from "./tasks/process-manager-purge.task.ts";
export { PrismaProcessManagerPurgeRepository } from "./repositories/prisma/prisma.process-manager-purge.repository.ts";
export type {
  ProcessManagerPurgeRepository,
  ProcessManagerPurgeTarget,
} from "./repositories/process/process-manager-purge.repository.ts";

// The transport declarations the process mounts. Each is inert: it names its
// routes or procedures, the access each is reached behind, and the facts the
// mounting process must bind - and nothing about how this process runs.
export {
  adminRest,
  adminActor,
  adminAuthSession,
  type AdminRestPorts,
} from "./transport/admin.rest.ts";
export { opsBugReportRest, bugReportCredential } from "./transport/ops-bug-report.rest.ts";
export { opsClickHouseExplainRest } from "./transport/ops-clickhouse-explain.rest.ts";
export { opsOperatorFact } from "./transport/ops-operator.trpc.ts";
export { opsDashboardTrpcTransport } from "./transport/ops-dashboard.trpc.ts";
export { opsQueueTrpcTransport } from "./transport/ops-queue.trpc.ts";
export { opsProcessTrpcTransport } from "./transport/ops-process.trpc.ts";
export { opsEventLogTrpcTransport } from "./transport/ops-event-log.trpc.ts";
export { opsPlatformTrpcTransport } from "./transport/ops-platform.trpc.ts";
export { opsBugReportTrpcTransport } from "./transport/ops-bug-report.trpc.ts";

// The operator-only ClickHouse EXPLAIN endpoint: the pure query guards and the
// decision about which client an EXPLAIN is allowed to reach.
export { CLICKHOUSE_GUARDRAILS } from "./rules/ops-clickhouse-guardrails.rules.ts";
export { OpsClickHouseRuntime } from "./repositories/clickhouse/clickhouse.ops-explain.repository.ts";
export {
  buildExplainQuery,
  findOpsConnection,
  redactQueryForAudit,
  stripCommentsAndStrings,
  type OpsExplainBuild,
} from "./rules/ops-clickhouse-explain.rules.ts";
export {
  type OpsExplainOutcome,
  OpsExplainService,
} from "./services/ops-clickhouse-explain.service.ts";
export { opsServer } from "./ops.server.ts";
