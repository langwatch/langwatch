export type {
  OpsAppInfrastructure,
  OpsAppDependencies,
  OpsBadgeReading,
  BugReportNotifier,
  BugReportRateLimiter,
  OpsCapability,
  OpsEventLogWindowReader,
  OpsEventExplorer,
  OpsGrafanaLinks,
  OpsPipelineRegistry,
  OpsSystemMigrationRunner,
  OpsProcessExplorer,
  OpsProcessRef,
  OpsReplayRunner,
} from "./app/ops.app.ts";
export type { BugReportRepository } from "./repositories/bug-report.repository.ts";
export type { OpsRepositories } from "./repositories/ops.repositories.ts";
export type { OpsOperationsOptions } from "./app/ops-operations.ts";
export type { SchedulerWakeRedis } from "./repositories/redis/redis.scheduler-wake.repository.ts";
export type { OpsSnapshotRedis } from "./app/ops.app.ts";
export type { ProcessControlAction } from "./repositories/ops-audit.repository.ts";
export type { ScheduledJobRecord } from "./repositories/scheduler-ops.repository.ts";
export type { SchedulerWake } from "./app/ops.app.ts";
export {
  type AdminAccess,
  AdminAccessService,
  type AdminAccessServiceOptions,
} from "./services/admin-access.service.ts";
export type { RedisCpuSample } from "./rules/ops-redis-engine-cpu.rules.ts";
export type { AnomalyHardTierAlert } from "./app/ops.app.ts";
export type { QueuePayloadDecoder } from "./app/ops.app.ts";

/** The operations explorers and the replay runner, moved off the application. */
export type {
  OpsEventingIntrospection,
  OpsProcessManagerMetadata,
  OpsProjectionMetadata,
} from "./app/ops.app.ts";
export type { OpsReplayRuntimeFactory, OpsReplayRuntime } from "./app/ops.app.ts";
export type {
  AggregateDiscoveryRow,
  RawEventRow,
} from "./repositories/event-explorer.repository.ts";
export type { ProcessNameCounts } from "./repositories/process-ops.repository.ts";
export type { ReplayRepository } from "./repositories/replay.repository.ts";
export type {
  OpsExplainClientResolution,
  OpsExplainClients,
} from "./repositories/ops-explain.repository.ts";

/** Public intake for the reports customers' coding agents file. */
export type {
  OpsSlackAlertTransport,
  SlackBugReportNotifierConfig,
} from "./services/slack.bug-report-notifier.service.ts";

// The system-migration ops model, its cohort policy and the Prisma/Redis
// implementations of the runner's repository interfaces. All were
// `platform/app/src/server/app-layer/system-migrations/`; the generic runner
// stays in `@langwatch/system-migrations`.
export type {
  MigrationEnrollmentRecord,
  SystemMigrationStateReader,
} from "./services/system-migrations.service.ts";
export {
  OpsSystemMigrations,
  UserStartupMigrationsUnsupportedError,
  type OpsSystemMigrationsOptions,
} from "./app/ops-system-migrations.ts";
// The state rows on their own, for a reader that is not the runner: the
// identity write gate decides a user's fork from the backfill's record.
export { RoutingTableOrganizationDataplaneService } from "./services/routing-table.organization-dataplane.service.ts";
export type { OrganizationDataplane, OrganizationDataplaneResolver } from "./app/ops.app.ts";
export type { OrganizationCohortAdmission } from "./services/system-migration-cohort.service.ts";
export { SystemMigrationsPassTask } from "./tasks/system-migrations-pass.task.ts";
export {
  ProcessManagerPurgeTask,
  purgeProcessManagerTables,
  type ProcessManagerPurgeOptions,
  type ProcessManagerPurgeReport,
} from "./tasks/process-manager-purge.task.ts";
export { PrismaProcessManagerPurgeRepository } from "./repositories/prisma/prisma.process-manager-purge.repository.ts";
export type { ProcessManagerPurgeTarget } from "./repositories/process-manager-purge.repository.ts";

// The transport declarations the process mounts. Each is inert: it names its
// routes or procedures, the access each is reached behind, and the facts the
// mounting process must bind - and nothing about how this process runs.
export {
  adminRest,
  adminActor,
  adminAuthSession,
  adminAuditRequest,
} from "./transport/admin.rest.ts";
export { opsBugReportRest, bugReportCredential } from "./transport/ops-bug-report.rest.ts";
export { opsClickHouseExplainRest } from "./transport/ops-clickhouse-explain.rest.ts";
export { opsOperatorFact } from "./transport/ops-operator.trpc.ts";
// The five `ops` fragments are composed into one namespace claim, and only the
// composition is published: a process that mounted a fragment on its own would
// claim `ops` a second time.
export { opsTrpcTransport } from "./transport/ops.trpc.ts";
export { opsBugReportTrpcTransport } from "./transport/ops-bug-report.trpc.ts";

// The operator-only ClickHouse EXPLAIN endpoint: the pure query guards and the
// decision about which client an EXPLAIN is allowed to reach.
export type { OpsExplainBuild } from "./rules/ops-clickhouse-explain.rules.ts";
export type { OpsExplainOutcome } from "./services/ops-clickhouse-explain.service.ts";
export { opsServer } from "./ops.server.ts";
