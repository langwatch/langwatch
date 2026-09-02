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
export { BugReportRepository } from "./ports/bug-report.repository";
export { PrismaBugReportRepository } from "./repositories/prisma/prisma.bug-report.repository";
export {
  BugReportInboxService,
  type BugReportListing,
} from "./services/bug-report-inbox.service";
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
export { NoopSchedulerAuditSink, SchedulerAuditSink } from "./ports/scheduler-audit.sink";
export {
  type SchedulerOpsRepository,
  type ScheduledJobRecord,
} from "./ports/scheduler-ops.repository";
export {
  NoopSchedulerWakeService,
  SchedulerWakeService,
} from "./ports/scheduler-wake.service";
export {
  type AdminAccess,
  AdminAccessService,
  type AdminAccessServiceOptions,
} from "./services/admin-access.service";
export { AdminAuditSink } from "./services/impersonation.service";
export * from "./ops.error-normalizer";
export * from "./ops.redis-engine-cpu";
export {
  OpsWorkerAdapter,
  type OpsWorkerAdapterOptions,
} from "./adapters/ops-worker.adapter";
export { AnomalyHardTierAlertPort } from "./ports/anomaly-hard-tier-alert.port";
export { QueuePayloadDecoderPort } from "./ports/queue-payload-decoder.port";
export {
  UsageStatsErrorReporter,
  UsageStatsClickHouseClient,
  UsageStatsClickHouseClientResolver,
  UsageStatsTelemetryClient,
  type UsageStatsClickHouseQuery,
  type UsageStatsClickHouseQueryResult,
  type UsageStatsWorkerDatabase,
} from "./ports/usage-stats-worker.ports";
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
export {
  buildPipelineTree,
  getOpsMetricsCollector,
  mapJobTypeToPhase,
  OpsMetricsCollector,
} from "./services/ops-metrics-collector.service";
export { totalInFlight, type InFlightCounts } from "./ops.in-flight";
export {
  OpsEventingIntrospectionPort,
  type OpsDejaViewProjection,
  type OpsProcessManagerMetadata,
  type OpsProjectionMetadata,
} from "./ports/eventing-introspection.port";
export { EventingOpsIntrospectionAdapter } from "./adapters/eventing.ops-introspection.adapter";
export { OpsReplayRuntimePort, type OpsReplayRuntime } from "./ports/replay-runtime.port";
export {
  NullEventExplorerRepository,
  type AggregateDiscoveryRow,
  type EventExplorerRepository,
  type RawEventRow,
} from "./ports/event-explorer.repository";
export {
  NullProcessOpsRepository,
  type ProcessNameCounts,
  type ProcessOpsRepository,
} from "./ports/process-ops.repository";
export { NullReplayRepository, type ReplayRepository } from "./ports/replay.repository";
export {
  NullProcessAuditSink,
  ProcessAuditRepository,
  type ProcessAuditSink,
  type ProcessControlAction,
} from "./repositories/prisma/prisma.process-audit.repository";
export { ProcessOpsPrismaRepository } from "./repositories/prisma/prisma.process-ops.repository";
export { EventExplorerClickHouseRepository } from "./repositories/clickhouse/clickhouse.event-explorer.repository";
export {
  OpsExplainClickHouseRepository,
  OpsExplainClientResolver,
  type OpsExplainClientResolution,
} from "./repositories/clickhouse/clickhouse.ops-explain.repository";
export { ReplayRedisRepository } from "./repositories/redis/redis.replay.repository";

/** Public intake for the reports customers' coding agents file. */
export {
  BugReportRateLimitedError,
  submitBugReport,
  type SubmitBugReportInput,
} from "./services/bug-report-intake.service";
export {
  BugReportNotifierPort,
  BugReportRateLimiterPort,
  SilentBugReportNotifier,
} from "./ports/bug-report-intake.ports";
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
} from "./ops.system-migration-cohort";
export { PrismaSystemMigrationStateRepository } from "./repositories/prisma/prisma.system-migration-state.repository";
export { PrismaSystemMigrationEnrollmentRepository } from "./repositories/prisma/prisma.system-migration-enrollment.repository";
export { PrismaOrganizationTenantSource } from "./repositories/prisma/prisma.organization-tenant-source.repository";
export {
  PrismaOrganizationMemberTenantSource,
  PrismaUserTenantSource,
} from "./repositories/prisma/prisma.user-tenant-source.repository";
export { RedisMigrationLeaseRepository } from "./repositories/redis/redis.migration-lease.repository";

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
