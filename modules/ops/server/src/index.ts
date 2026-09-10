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
export type { BugReportRepository } from "./repositories/bug-report.repository.ts";
export type { OpsRepositories } from "./repositories/ops.repositories.ts";
export { OpsOperations, type OpsOperationsOptions } from "./app/ops-operations.ts";
export {
  RedisOpsSnapshotAdapter,
  type RedisOpsSnapshotAdapterOptions,
} from "./adapters/redis.ops-snapshot.adapter.ts";
export {
  RedisSchedulerWakeAdapter,
  type SchedulerWakeRedis,
} from "./adapters/redis.scheduler-wake.adapter.ts";
export { OpsSnapshotRedisPort } from "./ports/ops-snapshot-redis.port.ts";
export {
  ProcessAuditSink,
  SchedulerAuditSink,
  type ProcessControlAction,
} from "./repositories/ops-audit.repository.ts";
export { MemoryProcessAuditRepository } from "./repositories/memory/memory.process-audit.repository.ts";
export { MemorySchedulerAuditRepository } from "./repositories/memory/memory.scheduler-audit.repository.ts";
export { MemoryOpsStore } from "./repositories/memory/memory.ops.store.ts";
export type {
  SchedulerOpsRepository,
  ScheduledJobRecord,
} from "./repositories/scheduler-ops.repository.ts";
export { NoopSchedulerWakeService } from "./services/scheduler-wake.service.ts";
export { SchedulerWakePort } from "./ports/scheduler-wake.port.ts";
export {
  type AdminAccess,
  AdminAccessService,
  type AdminAccessServiceOptions,
} from "./services/admin-access.service.ts";
export { AdminAuditSink } from "./services/impersonation.service.ts";
export * from "./rules/ops-error-normalizer.rules.ts";
export * from "./rules/ops-redis-engine-cpu.rules.ts";
export { OpsWorkerAdapter, type OpsWorkerAdapterOptions } from "./adapters/ops-worker.adapter.ts";
export { AnomalyHardTierAlertPort } from "./ports/anomaly-hard-tier-alert.port.ts";
export { StorageStatsMetricsPort } from "./ports/storage-stats-metrics.port.ts";
export { OtelStorageStatsMetricsAdapter } from "./adapters/otel.storage-stats-metrics.adapter.ts";
export {
  StorageStatsCollectionService,
  type StorageStatsClickHouseClient,
  type StorageStatsCollectionHandle,
  type StorageStatsCollectionOptions,
  type StorageStatsInstance,
} from "./services/storage-stats-collection.service.ts";
export { QueuePayloadDecoderPort } from "./ports/queue-payload-decoder.port.ts";
export {
  UsageStatsErrorReporterPort,
  UsageStatsClickHouseClientPort,
  UsageStatsClickHouseClientResolverPort,
  UsageStatsTelemetryClientPort,
  type UsageStatsClickHouseQuery,
  type UsageStatsClickHouseQueryResult,
  type UsageStatsWorkerDatabase,
} from "./ports/usage-stats-worker.port.ts";
export {
  OpsWorkerPort,
  type OpsWorkerHandle,
  type UsageStatsWorkerConfig,
} from "./ports/ops-worker.port.ts";

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
export { OpsQueueMetricsSourcePort } from "./ports/ops-queue-metrics-source.port.ts";
export { QueueOpsMetricsSourceAdapter } from "./adapters/queue.ops-queue-metrics-source.adapter.ts";
export { IoredisOpsSnapshotRedisAdapter } from "./adapters/ioredis.ops-snapshot-redis.adapter.ts";
export { QueueService } from "./services/queue.service.ts";
export { QueueRedisRepository } from "./repositories/redis/queue.repository.ts";
export { RedisOpsMetricsRepository } from "./repositories/redis/redis.ops-metrics.repository.ts";
export { totalInFlight, type InFlightCounts } from "./rules/ops-in-flight.rules.ts";
export {
  OpsEventingIntrospectionPort,
  type OpsDejaViewProjection,
  type OpsProcessManagerMetadata,
  type OpsProjectionMetadata,
} from "./ports/eventing-introspection.port.ts";
export { EventingOpsIntrospectionAdapter } from "./adapters/eventing.ops-introspection.adapter.ts";
export { OpsReplayRuntimePort, type OpsReplayRuntime } from "./ports/replay-runtime.port.ts";
export { MemoryEventExplorerRepository } from "./repositories/memory/memory.event-explorer.repository.ts";
export type {
  AggregateDiscoveryRow,
  EventExplorerRepository,
  RawEventRow,
} from "./repositories/event-explorer.repository.ts";
export { MemoryProcessOpsRepository } from "./repositories/memory/memory.process-ops.repository.ts";
export type {
  ProcessNameCounts,
  ProcessOpsRepository,
} from "./repositories/process-ops.repository.ts";
export { MemoryReplayRepository } from "./repositories/memory/memory.replay.repository.ts";
export type { ReplayRepository } from "./repositories/replay.repository.ts";
export { ProcessOpsPrismaRepository } from "./repositories/prisma/prisma.process-ops.repository.ts";
export { ProcessAuditRepository } from "./repositories/prisma/prisma.process-audit.repository.ts";
export { EventExplorerClickHouseRepository } from "./repositories/clickhouse/clickhouse.event-explorer.repository.ts";
export { OpsExplainClickHouseRepository } from "./repositories/clickhouse/clickhouse.ops-explain.repository.ts";
export type {
  OpsExplainClientResolution,
  OpsExplainClients,
} from "./repositories/ops-explain.repository.ts";

/** Public intake for the reports customers' coding agents file. */
export {
  BugReportIntakeService,
  BugReportRateLimitedError,
} from "./services/bug-report-intake.service.ts";
export {
  SlackBugReportNotifierAdapter,
  type OpsSlackAlertTransport,
  type SlackBugReportNotifierConfig,
} from "./adapters/slack.bug-report-notifier.adapter.ts";

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
export { NullOrganizationDataplaneAdapter } from "./adapters/null.organization-dataplane.adapter.ts";
export { RoutingTableOrganizationDataplaneAdapter } from "./adapters/routing-table.organization-dataplane.adapter.ts";
export {
  type OrganizationDataplane,
  OrganizationDataplanePort,
} from "./ports/organization-dataplane.port.ts";
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
} from "./repositories/process-manager-purge.repository.ts";

// The transport declarations the process mounts. Each is inert: it names its
// routes or procedures, the access each is reached behind, and the facts the
// mounting process must bind - and nothing about how this process runs.
export { adminRest, adminActor, adminAuthSession } from "./transport/admin.rest.ts";
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
