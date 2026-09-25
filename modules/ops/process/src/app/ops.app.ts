import { timingSafeEqual } from "node:crypto";

import { AnalyticsApi } from "@langwatch/analytics-contract";
import { AnnotationApi } from "@langwatch/annotation-contract";
import { ApiKeyApi, type ApiKeyApi as ApiKeyApiContract } from "@langwatch/api-key-contract";
/**
 * Operator back office application: holds every capability the feature api reaches, and centralizes
 * rules the transport was deciding separately.
 */
import { AuditLogApi, type RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import { AuthApi, type AuthApi as AuthApiContract } from "@langwatch/auth-contract";
import { AutomationApi } from "@langwatch/automation-contract";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { DashboardApi } from "@langwatch/dashboard-contract";
import { DatasetApi } from "@langwatch/dataset-contract";
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type {
  RegisteredFoldProjection,
  RegisteredMapProjection,
  RegisteredStateProjection,
  ReplayService as EventingReplayService,
} from "@langwatch/eventing";
import { ExperimentApi } from "@langwatch/experiment-contract";
import {
  FeatureFlagApi,
  listFeatureFlags,
  type FeatureFlagRules,
  type OperatorFeatureFlagCatalogue,
} from "@langwatch/feature-flag-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import { GithubApi } from "@langwatch/github-contract";
import { NotFoundError, ValidationError } from "@langwatch/handled-error";
import { IdentityApi, type IdentityApi as IdentityApiContract } from "@langwatch/identity-contract";
import { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { LangyApi } from "@langwatch/langy-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { MonitorApi } from "@langwatch/monitor-contract";
import { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import {
  AdminSessionExpiredError,
  AdminSurfaceHiddenError,
  OpsApi,
  adminResourceNameSchema,
  type CheckupAnswer,
  CheckupNotSelfHostedError,
  type CheckupResult,
  type ExplicitCheckInput,
  type ProjectCheckupReport,
  OpsCapabilityUnavailableError,
  type StartupNoticeState,
  type UsageReportAnswer,
  opsConfig,
  type AdminIdentity,
  type AggregateDiscovery,
  type AggregateEventView,
  type AggregateProcessManager,
  type AggregateSearchResult,
  type Anomaly,
  type AnomalyKind,
  type BugReport,
  type BugReportListing,
  type DashboardData,
  type DeadLetterCount,
  type DeadOutboxMessageView,
  type GroupInfo,
  type ListBugReportsInput,
  type OpsApiGetBadgeCountsOutput,
  type OpsEventLogSearchWindow,
  type OpsExplainAnswer,
  type OpsExplainRequest,
  type OpsGrafanaLinkConfig,
  type OpsMigrationCohortResult,
  type OpsMigrationEnrollmentListing,
  type OpsMigrationOrganizationMatch,
  type OpsMigrationOverview,
  type OpsMigrationTargetedRunResult,
  type OpsOperator,
  OpsConfirmationRequiredError,
  OpsImpersonatedOperatorRefusedError,
  OpsOperatorRequiredError,
  OpsOperatorSecretRequiredError,
  OpsOperatorSessionRequiredError,
  OpsUnknownFeatureFlagError,
  type OpsOperatorPermission,
  type OpsPipelineRegistrations,
  type OpsScope,
  type OpsSnapshotService,
  type OutboxAttemptView,
  type ProcessAuditEntryView,
  type ProcessFleetSummary,
  type ProcessInstanceDetail,
  type ProcessInstanceRow,
  type ProcessOutboxMessageView,
  type ProcessWakeRow,
  type ProjectionStateAtEvent,
  type ReplayHistoryEntry,
  type ReplayStatus,
  type RunAdminOperationInput,
  type StartAdminImpersonationInput,
  type StopAdminImpersonationInput,
  type OpsServerConfig,
  type ProductAnalyticsTarget,
  type SubmitBugReport,
  type AdminOperationInput,
  type AdminOperationResult,
  type CanaryRedriveQueueDlqInput,
  type CanaryRedriveQueueDlqResult,
  type CanaryUnblockQueueGroupsInput,
  type CanaryUnblockQueueGroupsResult,
  type CancelReplayResult,
  type DeleteBlobInput,
  type DeleteBlobResult,
  type DiscardDeadLettersInput,
  type DiscardDeadLettersResult,
  type DiscardDeadMessageInput,
  type DiscardDeadMessageResult,
  type DiscardQueueDlqGroupsInput,
  type DiscardQueueDlqGroupsResult,
  type DiscoverAggregatesInput,
  type DrainQueueGroupInput,
  type DrainQueueGroupResult,
  type DrainQueueTenantInput,
  type DrainQueueTenantResult,
  type FindHistoryEntryInput,
  type FindInstanceDetailInput,
  type FindQueueGroupInput,
  type GetAggregateEventsInput,
  type GetBlobInput,
  type GetDeadLettersInput,
  type GetDeadLettersResult,
  type GetForAggregateInput,
  type GetInstancesInput,
  type GetInstancesResult,
  type GetOutboxAttemptsInput,
  type GetOutboxInput,
  type GetOutboxResult,
  type GetQueueDrainPreviewInput,
  type GetUpcomingWakesInput,
  type ListBlobsInput,
  type ListParkedQueueGroupsInput,
  type ListParkedQueueTenantsInput,
  type ListPausedQueueKeysInput,
  type ListPausedQueueTenantsInput,
  type ListPausedSchedulesInput,
  type ListPausedSchedulesResult,
  type ListQueueDlqGroupsInput,
  type ListQueueGroupJobsInput,
  type ListQueueGroupsInput,
  type ListRecentActionsInput,
  type ListScheduledJobsInput,
  type ListSchedulerActionsInput,
  type MoveQueueGroupToDlqInput,
  type MoveQueueGroupToDlqResult,
  type OpsBlobPage,
  type OpsBlobStoreStats,
  type OpsBlobSummary,
  type OpsBlockedSummary,
  type OpsParkedGroupsPage,
  type OpsParkedTenantsPage,
  type OpsQueueDlqGroup,
  type OpsQueueDlqGroupWithQueue,
  type OpsQueueDrainPreview,
  type OpsQueueGroupsPage,
  type OpsQueueJobsPage,
  type OpsQueueReconcileOutcome,
  type OpsScheduledJob,
  type PauseQueuePipelineInput,
  type PauseQueueTenantInput,
  type QueueInfo,
  type QueueSummaryInfo,
  type ReadQueuePendingDriftInput,
  type RedriveDeadInstanceInput,
  type RedriveDeadInstanceResult,
  type RedriveDeadLettersInput,
  type RedriveDeadLettersResult,
  type RedriveDeadMessageInput,
  type RedriveDeadMessageResult,
  type RedriveQueueDlqGroupsInput,
  type RedriveQueueDlqGroupsResult,
  type ReleaseLapsedLeaseInput,
  type ReleaseLapsedLeaseResult,
  type ReplayAllQueueGroupsFromDlqInput,
  type ReplayAllQueueGroupsFromDlqResult,
  type ReplayQueueGroupFromDlqInput,
  type ReplayQueueGroupFromDlqResult,
  type RequeueDeadMessagesInput,
  type RequeueDeadMessagesResult,
  type RetryBlockedQueueJobInput,
  type RetryBlockedQueueJobResult,
  type ScanQueuesInput,
  type ScheduleControlInput,
  type SchedulerAuditEntryView,
  type SetScheduleActiveInput,
  type StartImpersonationInput,
  type StartReplayInput,
  type StartReplayResult,
  type StopImpersonationInput,
  type ReconcileQueuePendingInput,
  type UnblockAllQueueGroupsInput,
  type UnblockAllQueueGroupsResult,
  type UnblockQueueGroupInput,
  type UnblockQueueGroupResult,
  type UnpauseQueuePipelineInput,
  type UnpauseQueueTenantInput,
  type WakeNowInput,
  type WakeNowResult,
  type AdminImpersonationStarted,
  type AdminImpersonationStopped,
  type BlobSweepReport,
  type MoveAllBlockedQueueGroupsToDlqInput,
  type MoveAllBlockedQueueGroupsToDlqResult,
  type RunBlobCleanupCommand,
  type StreamDashboardInput,
} from "@langwatch/ops-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import {
  ProjectApi,
  type ProjectApi as ProjectApiContract,
  type SearchProjectsResult,
} from "@langwatch/project-contract";
import { PromptApi } from "@langwatch/prompt-contract";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { StoredObjectApi } from "@langwatch/stored-object-contract";
import { nowInstant } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";
import { UserApi, type UserApi as UserApiContract } from "@langwatch/user-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";

import { OpsExplainClickHouseRepository } from "#repositories/clickhouse/clickhouse.ops-explain.repository";
import type { OpsExplainClients } from "#repositories/ops-explain.repository";
import type { OpsRepositories } from "#repositories/ops.repositories";
import { BugReportInboxService } from "#services/bug-report-inbox.service";
import { BugReportIntakeService } from "#services/bug-report-intake.service";
import { OpsExplainService } from "#services/ops-clickhouse-explain.service";

import { HttpCheckupProbeChannel } from "../channels/http/http.checkup-probe.channel.ts";
import { HttpUsageReportChannel } from "../channels/http/http.usage-report.channel.ts";
import type { AnomalyDetectionTickResult } from "../eventing/ops-anomaly-detection.intent.ts";
import { ClickHouseClickHouseHealthRepository } from "../repositories/clickhouse/clickhouse.datastore-health.repository.ts";
import { PrismaPostgresHealthRepository } from "../repositories/prisma/prisma.datastore-health.repository.ts";
import { RedisAnomalyRateTrackerRepository } from "../repositories/redis/redis.anomaly-rate-tracker.repository.ts";
import { RedisAnomalyStateRepository } from "../repositories/redis/redis.anomaly-state.repository.ts";
import { RedisRedisHealthRepository } from "../repositories/redis/redis.datastore-health.repository.ts";
import { RedisStorageStatsReadingsRepository } from "../repositories/redis/redis.storage-stats-readings.repository.ts";
import { buildExplainQuery, redactQueryForAudit } from "../rules/ops-clickhouse-explain.rules.ts";
import { withKillSwitchDescriptors } from "../rules/ops-kill-switch-catalogue.rules.ts";
import { AnomalyDetectorService } from "../services/anomaly-detector.service.ts";
import { OpsCheckupService } from "../services/ops-checkup.service.ts";
import type { OpsService } from "../services/ops.service.ts";
import { StorageStatsCollectionService } from "../services/storage-stats-collection.service.ts";
import { StorageStatsGaugesService } from "../services/storage-stats-gauges.service.ts";
import {
  buildOpsInfrastructure,
  type OpsProcessMembers,
  sharedStorageStatsInstance,
} from "./ops-composition.build.ts";
/**
 * Who an operator request is attributed to: the impersonator where there is
 * one, so a back-office read is recorded against the human who made it rather
 * than against the account they were borrowing.
 */
function actingIdentityOf(operator: OpsOperator): OpsOperator;
function actingIdentityOf(operator: OpsOperator | null): OpsOperator;
function actingIdentityOf(operator: OpsOperator | null): OpsOperator {
  if (!operator) return { id: "" };

  const { impersonator } = operator;

  if (!impersonator) return operator;

  return {
    ...operator,
    ...(impersonator.id === undefined ? {} : { id: impersonator.id }),
    ...(impersonator.email === undefined ? {} : { email: impersonator.email }),
  };
}

/** How far back an event-log search reaches when the caller names no bound. */
const EVENT_LOG_SEARCH_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

/** What every audited row on the support inbox points at. */
const BUG_REPORT_TARGET_KIND = "bugReport";

const ADMIN_RESOURCE_NAMES: Readonly<Record<string, string>> = {
  organizations: "organization",
  subscriptions: "subscription",
  teams: "team",
};

/** One process ref, the triple every process-manager read is keyed by. */
export type OpsProcessRef = {
  processName: string;
  projectId: string;
  processKey: string;
};

/**
 * Event-sourcing explorers typed with contract vocabulary, not Promise<unknown>; the concrete types
 * reach the client through the return type.
 */
export type OpsEventExplorer = {
  discoverAggregates(input: {
    projectionNames: string[];
    since: string;
    tenantIds: string[];
  }): Promise<AggregateDiscovery>;
  searchAggregates(input: {
    query: string;
    tenantIds: string[];
    sinceMs: number;
  }): Promise<AggregateSearchResult[]>;
  getAggregateEvents(input: {
    aggregateId: string;
    tenantId: string;
    limit: number;
  }): Promise<AggregateEventView[]>;
  computeProjectionState(input: {
    aggregateId: string;
    tenantId: string;
    projectionName: string;
    eventIndex: number;
  }): Promise<ProjectionStateAtEvent>;
};

export type OpsProcessExplorer = {
  getForAggregate(input: {
    aggregateType: string;
    projectId: string;
    aggregateId: string;
  }): Promise<AggregateProcessManager[]>;
  requeueDeadMessages(input: {
    processName: string;
    projectId: string;
    processKey: string;
    messageKeyPrefix?: string;
    requestedBy: string;
  }): Promise<{ requeued: number }>;
  getFleetSummary(): Promise<ProcessFleetSummary[]>;
  getDeadLetters(input: { processName?: string; page: number; pageSize: number }): Promise<{
    messages: DeadOutboxMessageView[];
    total: number;
    byProcess: DeadLetterCount[];
  }>;
  getDeadLetterCounts(): Promise<DeadLetterCount[]>;
  getInstances(input: {
    processName?: string;
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ instances: ProcessInstanceRow[]; total: number }>;
  getUpcomingWakes(input: { limit: number }): Promise<ProcessWakeRow[]>;
  findInstanceDetail(input: { ref: OpsProcessRef }): Promise<ProcessInstanceDetail | null>;
  getOutbox(input: {
    ref: OpsProcessRef;
    page: number;
    pageSize: number;
  }): Promise<{ messages: ProcessOutboxMessageView[]; total: number }>;
  listRecentActions(input: { limit: number }): Promise<ProcessAuditEntryView[]>;
  wakeNow(input: { ref: OpsProcessRef; actorUserId: string }): Promise<{ woke: boolean }>;
  redriveDeadInstance(input: {
    ref: OpsProcessRef;
    actorUserId: string;
  }): Promise<{ requeued: number }>;
  redriveDeadMessage(input: {
    ref: OpsProcessRef;
    messageId: string;
    actorUserId: string;
  }): Promise<{ redriven: boolean }>;
  discardDeadMessage(input: {
    ref: OpsProcessRef;
    messageId: string;
    actorUserId: string;
  }): Promise<{ discarded: boolean }>;
  redriveDeadLetters(input: {
    processName?: string;
    actorUserId: string;
  }): Promise<{ redriven: number }>;
  discardDeadLetters(input: {
    processName?: string;
    actorUserId: string;
  }): Promise<{ discarded: number }>;
  getOutboxAttempts(input: { outboxId: string; projectId: string }): Promise<OutboxAttemptView[]>;
  releaseLapsedLease(input: {
    ref: OpsProcessRef;
    messageId: string;
    actorUserId: string;
  }): Promise<{ released: boolean }>;
};

/**
 * Typed with the contract's own vocabulary rather than `unknown`: as `unknown`,
 * the browser received `{}`, and every field the replay UI reads came back
 * unchecked.
 */
export type OpsReplayRunner = {
  getHistory(): Promise<ReplayHistoryEntry[]>;
  findHistoryEntry(input: { runId: string }): Promise<ReplayHistoryEntry | null>;
  startReplay(input: {
    projectionNames: string[];
    since: string;
    tenantIds: string[];
    aggregateIds?: string[];
    fullRebuild?: boolean;
    description: string;
    userName: string;
  }): Promise<{ runId: string }>;
  getStatus(): Promise<ReplayStatus>;
  cancelReplay(): Promise<{ cancelled: boolean }>;
};

/**
 * The operations capability as the process composes it: the portable service
 * plus the explorers, the replay runner and the optional snapshot collector.
 */
export type OpsCapability = OpsService & {
  eventExplorer: OpsEventExplorer;
  managerExplorer: OpsProcessExplorer;
  replay: OpsReplayRunner;
  snapshots: OpsSnapshotService | null;
};

/** What the process composes this feature's application from. */
export interface OpsAppDependencies {
  users: UserApiContract;
  auth: AuthApiContract;
  /**
   * Which of an organization's two routes decides its sign-in — the module that owns connections
   * answers, per organization.
   */
  identity: IdentityApiContract;
  projects: ProjectApiContract;
  auditLog: AuditLogApi;
}

/** The process-owned adapters used to make one Ops capability at boot. */
/**
 * Infrastructure, not a peer module: composed from the process's own
 * migration registry and ledger — the one thing here no module service owns.
 */
export interface OpsSystemMigrationRunner {
  getOverview(): Promise<OpsMigrationOverview[]>;
  getEnrollments(input: { requestedBy: string }): Promise<OpsMigrationEnrollmentListing>;
  searchOrganizations(input: { query: string }): Promise<OpsMigrationOrganizationMatch[]>;
  /**
   * Whether this migration's blast radius earns the rollback's guard. The
   * migration's own declaration decides, so this gate and the page that asks
   * for the confirmation cannot drift apart.
   */
  requiresOperatorConfirmation(input: { migrationName: string }): boolean;
  enroll(input: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<void>;
  enrollCohort(input: {
    migrationName: string;
    sampleSize: number;
    actorUserId: string;
    includeEnterprise: boolean;
    includePrivateDataplane: boolean;
  }): Promise<OpsMigrationCohortResult>;
  withdraw(input: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<void>;
  runForOrganization(input: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<OpsMigrationTargetedRunResult>;
  startPass(): void;
  assertLegacyWritersDrained(input: {
    migrationName: string;
    tenantId: string;
    minimumWriterGeneration: string;
    actorUserId: string;
  }): Promise<void>;
  rollBack(input: { migrationName: string; tenantId: string; actorUserId: string }): Promise<void>;
}

/** Team alert for a filed report. Best-effort: intake already succeeded. */
/** Audit sink for GroupQueue operator actions (specs/ops/dead-letter-recovery.feature). */
export type QueueControlAction =
  | "queue_redrive_dlq_groups"
  | "queue_discard_dlq_groups"
  | "queue_drain_group"
  | "queue_drain_tenant"
  | "queue_move_group_to_dlq"
  | "queue_move_all_blocked_to_dlq"
  | "queue_unblock_group"
  | "queue_unblock_all";

export interface QueueAuditSink {
  append(entry: {
    actorUserId: string;
    action: QueueControlAction;
    queueName: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface BugReportNotifier {
  notify(input: { report: BugReport }): Promise<void>;
}

/**
 * Fixed-window counter for the PUBLIC report endpoint, keyed on the
 * caller-asserted nearest-hop IP — a flood bound, not authorization; its
 * absence would let one client fill a cross-tenant inbox.
 */
export interface BugReportRateLimiter {
  consume(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<{ allowed: boolean }>;
}

/** The registered projections and event subscribers, as the process knows them. */
export interface OpsPipelineRegistry {
  listRegistrations(): OpsPipelineRegistrations;
}

/** The bound on an event-log search, as this deployment is configured. */
export interface OpsEventLogWindowReader {
  read(): OpsEventLogSearchWindow;
}

/** Grafana deep-link configuration, or null where no Grafana is configured. */
export interface OpsGrafanaLinks {
  findLinkConfig(): OpsGrafanaLinkConfig;
}

export interface OpsAppInfrastructure {
  createCapability(dependencies: OpsAppDependencies): OpsCapability;
  /**
   * The live pipeline graph, read for the kill-switch keys an operator may
   * set. Without it every generated key is unsettable.
   */
  eventingIntrospection: OpsEventingIntrospection;
  pipelines: OpsPipelineRegistry;
  eventLogWindow: OpsEventLogWindowReader;
  grafana: OpsGrafanaLinks;
  systemMigrations: OpsSystemMigrationRunner;
  bugReportRateLimiter: BugReportRateLimiter;
  bugReportNotifier: BugReportNotifier;
  /** The ClickHouse account an operator EXPLAIN runs as. */
  explainClients: OpsExplainClients;
  /**
   * The operator secret a caller presents, read PER REQUEST so a deployment
   * that rotates it without a restart is honoured. Null where this deployment
   * configured none, which refuses every call.
   */
  findOpsApiKey(): string | null;
  /** The product-analytics target this deployment configured, for peers that send to it. */
  findProductAnalyticsTargets(): ProductAnalyticsTarget[];
  /**
   * Whether this deployment is production, for the explain service's own
   * fail-closed rule. Passed rather than read from the environment: a feature
   * package reads none.
   */
  isProduction: boolean;
}
type OpsRuntimeDependencies = Readonly<{
  ops: OpsCapability;
  featureFlags: FeatureFlagApi;
  projects: ProjectApiContract;
  auditLog: AuditLogApi;
  apiKeys: ApiKeyApiContract;
  eventingIntrospection: OpsEventingIntrospection;
  pipelines: OpsPipelineRegistry;
  eventLogWindow: OpsEventLogWindowReader;
  grafana: OpsGrafanaLinks;
  systemMigrations: OpsSystemMigrationRunner;
  inbox: BugReportInboxService;
  intake: BugReportIntakeService;
  explain: OpsExplainService;
  /** Settings, Checkup and the usage report; absent where a composition built none. */
  checkup: OpsCheckupService | undefined;
  /** The detector `ops_anomaly_detection` ticks; absent where a composition built none. */
  anomalies: AnomalyDetectorService | undefined;
  /** The measurement `ops_storage_stats` runs; absent where a composition built none. */
  storageStats: StorageStatsCollectionService | undefined;
  findOpsApiKey(): string | null;
  findProductAnalyticsTargets(): ProductAnalyticsTarget[];
  isProduction: boolean;
}>;

/** {@link OpsAppDependencies} plus the contract peers only `create()` itself reads. */
type OpsAppRuntimeDependencies = OpsAppDependencies &
  Readonly<{ apiKeys: ApiKeyApiContract; featureFlags: FeatureFlagApi }>;

type OpsSetup = FeatureSetup<
  typeof OpsApp.dependencies,
  OpsProcessMembers,
  OpsServerConfig,
  OpsRepositories
>;

/** The badge's two integers, and when they were computed. */
export interface OpsBadgeReading {
  blockedCount: number;
  dlqCount: number;
  /** Null when no snapshot collector is running: "we cannot say", not "all clear". */
  computedAt: OpsApiGetBadgeCountsOutput["computedAt"];
}

export class OpsApp implements OpsApi {
  static readonly contract = OpsApi;
  static readonly dependencies = {
    users: UserApi,
    auth: AuthApi,
    identity: IdentityApi,
    projects: ProjectApi,
    auditLog: AuditLogApi,
    apiKeys: ApiKeyApi,
    featureFlags: FeatureFlagApi,
    // The checkup and the usage report ask each owner for its own facts.
    organizations: OrganizationApi,
    licensing: LicensingApi,
    modelProviders: ModelProviderApi,
    datasets: DatasetApi,
    annotations: AnnotationApi,
    monitors: MonitorApi,
    experiments: ExperimentApi,
    prompts: PromptApi,
    workflows: WorkflowApi,
    automations: AutomationApi,
    github: GithubApi,
    langy: LangyApi,
    dashboards: DashboardApi,
    traces: TraceApi,
    scenarios: ScenarioApi,
    gateway: GatewayApi,
    instantEvals: InstantEvalApi,
    codingAgents: CodingAgentApi,
    notifications: NotificationApi,
    storedObjects: StoredObjectApi,
    analytics: AnalyticsApi,
  };
  static readonly config = opsConfig;
  static readonly reads = [
    "prisma",
    "redis",
    "clickhouse",
    "eventing",
    "logger",
    "nodeEnvironment",
    "adminEmails",
    "isSaas",
    "serviceVersion",
    "publicBaseUrl",
    "processName",
  ] as const;

  /**
   * Builds this process's own {@link OpsAppInfrastructure} from the members it
   * reads, then composes over it exactly as {@link OpsApp.fromInfrastructure}
   * does — what a hand composition (or a test) still supplies directly.
   */
  static create(setup: OpsSetup): OpsApp {
    // One tracker: the queue-metrics writer records into it, the detector reads it.
    const rateTracker = RedisAnomalyRateTrackerRepository.create({
      redis: setup.members.redis,
      featureFlags: setup.dependencies.featureFlags,
    });
    const infrastructure = buildOpsInfrastructure({
      members: setup.members,
      config: setup.config,
      resources: setup.resources,
      processStore: setup.repositories.processStore,
      rateTracker,
    });

    const { dependencies } = setup;
    const { members } = setup;
    const checkup = OpsCheckupService.create({
      members,
      config: setup.config,
      peers: {
        ...dependencies,
        auth: dependencies.auth,
        projects: dependencies.projects,
        users: dependencies.users,
        organizationDirectory: dependencies.organizations,
        providerTests: dependencies.modelProviders,
        projectDirectory: dependencies.projects,
        mail: dependencies.notifications,
        storage: dependencies.storedObjects,
        lwql: dependencies.analytics,
      },
      repositories: {
        postgres: PrismaPostgresHealthRepository.create(members.prisma),
        clickhouse: ClickHouseClickHouseHealthRepository.create(members.clickhouse),
        redis: RedisRedisHealthRepository.create(members.redis),
      },
      channels: {
        usageReport: HttpUsageReportChannel.create(),
        probes: HttpCheckupProbeChannel.create(),
      },
    });

    const anomalies = AnomalyDetectorService.create({
      rateTracker,
      anomalyState: RedisAnomalyStateRepository.create(members.redis),
      featureFlags: dependencies.featureFlags,
    });

    // Every process exports the gauges; only the process running `ops_storage_stats` measures.
    const storageReadings = RedisStorageStatsReadingsRepository.create({ redis: members.redis });
    StorageStatsGaugesService.create({ readings: storageReadings }).publish();
    const storageStats = StorageStatsCollectionService.create({
      resolveInstances: async () => [sharedStorageStatsInstance(members.clickhouse)],
      readings: storageReadings,
      collectBackups: setup.config.collectClickHouseBackupMetrics,
      logger: members.logger,
    });

    return OpsApp.fromInfrastructure({
      infrastructure,
      dependencies,
      repositories: setup.repositories,
      checkup,
      anomalies,
      storageStats,
    });
  }

  /**
   * Composes over an already-built {@link OpsAppInfrastructure}. Kept
   * because a hand composition (and every unit test's fixture) still builds
   * one directly rather than reading process members.
   */
  static fromInfrastructure(setup: {
    infrastructure: OpsAppInfrastructure;
    dependencies: OpsAppRuntimeDependencies;
    repositories: OpsRepositories;
    checkup?: OpsCheckupService;
    anomalies?: AnomalyDetectorService;
    storageStats?: StorageStatsCollectionService;
  }): OpsApp {
    const { infrastructure: members, dependencies, repositories } = setup;

    const inbox = BugReportInboxService.create({ reports: repositories.bugReports });

    return new OpsApp({
      ops: members.createCapability(dependencies),
      inbox,
      intake: BugReportIntakeService.create({
        reports: repositories.bugReports,
        rateLimiter: members.bugReportRateLimiter,
        notifier: members.bugReportNotifier,
      }),
      apiKeys: dependencies.apiKeys,
      featureFlags: dependencies.featureFlags,
      projects: dependencies.projects,
      auditLog: dependencies.auditLog,
      eventingIntrospection: members.eventingIntrospection,
      pipelines: members.pipelines,
      eventLogWindow: members.eventLogWindow,
      grafana: members.grafana,
      systemMigrations: members.systemMigrations,
      explain: OpsExplainService.create({
        repository: OpsExplainClickHouseRepository.create({
          resolver: members.explainClients,
        }),
      }),
      checkup: setup.checkup,
      anomalies: setup.anomalies,
      storageStats: setup.storageStats,
      findOpsApiKey: () => members.findOpsApiKey(),
      findProductAnalyticsTargets: () => members.findProductAnalyticsTargets(),
      isProduction: members.isProduction,
    });
  }

  readonly #dependencies: OpsRuntimeDependencies;

  private constructor(dependencies: OpsRuntimeDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * Whether this identity is on the deployment's operator allow-list, keyed on email address.
   */
  isAdmin(identity: AdminIdentity): boolean {
    return this.#dependencies.ops.isAdmin(identity);
  }

  // -- the rules the transport used to hold ----------------------------------

  /**
   * Extra gate on destructive operator writes: signed-in (not impersonated), typed confirmation,
   * because damage is silent.
   */
  assertDestructiveOperator(operator: OpsOperator | null, confirmation: string | undefined): void {
    if (!operator) throw new OpsOperatorSessionRequiredError();
    if (operator.impersonator) throw new OpsImpersonatedOperatorRefusedError();
    if (!confirmation) throw new OpsConfirmationRequiredError();
  }

  /** The collected dashboard, or null when no snapshot collector is running. */
  findDashboardData(): DashboardData | null {
    return this.#dependencies.ops.snapshots?.findDashboardData() ?? null;
  }

  /**
   * The two integers the global ops badge renders. Without a snapshot collector, null means "we
   * cannot say", not "all clear".
   */
  badgeCounts(): OpsBadgeReading {
    const snapshots = this.#dependencies.ops.snapshots;
    if (!snapshots) return { blockedCount: 0, dlqCount: 0, computedAt: null };
    return snapshots.getBadgeCounts();
  }

  /** The live dashboard feed. Yields nothing when no collector is running. */
  async *streamDashboard(input: StreamDashboardInput): AsyncIterable<DashboardData> {
    const snapshots = this.#dependencies.ops.snapshots;
    if (!snapshots) return;
    yield* snapshots.streamDashboard(input);
  }

  /** One queue group, raising a not-found rather than answering null. */
  async getQueueGroup(input: { queueName: string; groupId: string }): Promise<GroupInfo> {
    const group = await this.#dependencies.ops.findQueueGroup(input);
    if (!group) {
      throw new NotFoundError("not_found", "Queue group", input.groupId, {
        meta: { queueName: input.queueName },
      });
    }
    return group;
  }

  /**
   * One aggregate's state under one projection, at one event index. An answer
   * with no `aggregateType` means the projection name matched nothing — a
   * not-found, not a half-filled result the caller has to inspect.
   */
  async computeProjectionState(input: {
    aggregateId: string;
    tenantId: string;
    projectionName: string;
    eventIndex: number;
  }): Promise<ProjectionStateAtEvent> {
    const state = await this.#dependencies.ops.eventExplorer.computeProjectionState(input);
    if (!state.aggregateType) {
      throw new NotFoundError("not_found", "Projection", input.projectionName);
    }
    return state;
  }

  /** Currently-active tenant anomalies, hard tier first. */
  listAnomalies(): Promise<Anomaly[]> {
    return this.#dependencies.ops.listAnomalies();
  }

  /** Dismisses one tenant anomaly. */
  dismissAnomaly(input: { tenantId: string; kind: AnomalyKind }): Promise<boolean> {
    return this.#dependencies.ops.dismissAnomaly(input);
  }

  /** The project lookup behind the operator's tenant pickers. */
  searchProjects(input: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]> {
    return this.#dependencies.projects.searchByQuery(input);
  }

  // -- feature flags ---------------------------------------------------------

  /**
   * Every operator-visible flag: the registry, orphan stored rows, and every
   * kill switch the live pipeline graph will read even before anyone has
   * flipped it.
   */
  async featureFlagCatalogue(): Promise<OperatorFeatureFlagCatalogue> {
    return withKillSwitchDescriptors({
      catalogue: await this.#dependencies.featureFlags.listOperatorCatalogue(),
      descriptors: this.#dependencies.eventingIntrospection.killSwitches(),
    });
  }

  /** Turns one registered flag on or off. */
  async setFeatureFlagEnabled(input: {
    key: string;
    enabled: boolean;
    lastEditedBy: string | null;
  }): Promise<void> {
    this.requireRegisteredFlag(input.key);
    await this.#dependencies.featureFlags.setEnabled(input);
  }

  /** Replaces one registered flag's targeting rules. */
  async setFeatureFlagRules(input: {
    key: string;
    rules: FeatureFlagRules;
    lastEditedBy: string | null;
  }): Promise<void> {
    this.requireRegisteredFlag(input.key);
    await this.#dependencies.featureFlags.setRules(input);
  }

  /**
   * Deliberately permissive about the key: the catalogue surfaces orphan rows
   * so operators can delete them, and validating the key here would break
   * exactly that cleanup path.
   */
  clearFeatureFlag(input: { key: string; lastEditedBy: string | null }): Promise<void> {
    return this.#dependencies.featureFlags.clearStoredFlag(input);
  }

  discoverAggregates(input: DiscoverAggregatesInput): Promise<AggregateDiscovery> {
    return this.#dependencies.ops.eventExplorer.discoverAggregates(input);
  }

  /**
   * The event-log search. A caller naming no lower bound gets the explorer's
   * own default lookback, which lives here so two doors cannot disagree about
   * how far back the same question reaches.
   */
  searchAggregates(input: {
    query: string;
    tenantIds: string[];
    sinceMs?: number | undefined;
  }): Promise<AggregateSearchResult[]> {
    return this.#dependencies.ops.eventExplorer.searchAggregates({
      query: input.query,
      tenantIds: input.tenantIds,
      sinceMs: input.sinceMs ?? nowInstant().epochMilliseconds - EVENT_LOG_SEARCH_LOOKBACK_MS,
    });
  }

  getAggregateEvents(input: GetAggregateEventsInput): Promise<AggregateEventView[]> {
    return this.#dependencies.ops.eventExplorer.getAggregateEvents(input);
  }

  getForAggregate(input: GetForAggregateInput): Promise<AggregateProcessManager[]> {
    return this.#dependencies.ops.managerExplorer.getForAggregate(input);
  }

  requeueDeadMessages(input: RequeueDeadMessagesInput): Promise<RequeueDeadMessagesResult> {
    return this.#dependencies.ops.managerExplorer.requeueDeadMessages(input);
  }

  getFleetSummary(): Promise<ProcessFleetSummary[]> {
    return this.#dependencies.ops.managerExplorer.getFleetSummary();
  }
  getDeadLetters(input: GetDeadLettersInput): Promise<GetDeadLettersResult> {
    return this.#dependencies.ops.managerExplorer.getDeadLetters(input);
  }
  getDeadLetterCounts(): Promise<DeadLetterCount[]> {
    return this.#dependencies.ops.managerExplorer.getDeadLetterCounts();
  }
  getInstances(input: GetInstancesInput): Promise<GetInstancesResult> {
    return this.#dependencies.ops.managerExplorer.getInstances(input);
  }
  getUpcomingWakes(input: GetUpcomingWakesInput): Promise<ProcessWakeRow[]> {
    return this.#dependencies.ops.managerExplorer.getUpcomingWakes(input);
  }
  findInstanceDetail(input: FindInstanceDetailInput): Promise<ProcessInstanceDetail | null> {
    return this.#dependencies.ops.managerExplorer.findInstanceDetail(input);
  }
  getOutbox(input: GetOutboxInput): Promise<GetOutboxResult> {
    return this.#dependencies.ops.managerExplorer.getOutbox(input);
  }
  listRecentActions(input: ListRecentActionsInput): Promise<ProcessAuditEntryView[]> {
    return this.#dependencies.ops.managerExplorer.listRecentActions(input);
  }
  wakeNow(input: WakeNowInput): Promise<WakeNowResult> {
    return this.#dependencies.ops.managerExplorer.wakeNow(input);
  }
  redriveDeadInstance(input: RedriveDeadInstanceInput): Promise<RedriveDeadInstanceResult> {
    return this.#dependencies.ops.managerExplorer.redriveDeadInstance(input);
  }
  redriveDeadMessage(input: RedriveDeadMessageInput): Promise<RedriveDeadMessageResult> {
    return this.#dependencies.ops.managerExplorer.redriveDeadMessage(input);
  }
  discardDeadMessage(input: DiscardDeadMessageInput): Promise<DiscardDeadMessageResult> {
    return this.#dependencies.ops.managerExplorer.discardDeadMessage(input);
  }
  redriveDeadLetters(input: RedriveDeadLettersInput): Promise<RedriveDeadLettersResult> {
    return this.#dependencies.ops.managerExplorer.redriveDeadLetters(input);
  }
  discardDeadLetters(input: DiscardDeadLettersInput): Promise<DiscardDeadLettersResult> {
    return this.#dependencies.ops.managerExplorer.discardDeadLetters(input);
  }
  getOutboxAttempts(input: GetOutboxAttemptsInput): Promise<OutboxAttemptView[]> {
    return this.#dependencies.ops.managerExplorer.getOutboxAttempts(input);
  }
  releaseLapsedLease(input: ReleaseLapsedLeaseInput): Promise<ReleaseLapsedLeaseResult> {
    return this.#dependencies.ops.managerExplorer.releaseLapsedLease(input);
  }
  getHistory(): Promise<ReplayHistoryEntry[]> {
    return this.#dependencies.ops.replay.getHistory();
  }
  findHistoryEntry(input: FindHistoryEntryInput): Promise<ReplayHistoryEntry | null> {
    return this.#dependencies.ops.replay.findHistoryEntry(input);
  }
  startReplay(input: StartReplayInput): Promise<StartReplayResult> {
    return this.#dependencies.ops.replay.startReplay(input);
  }
  getStatus(): Promise<ReplayStatus> {
    return this.#dependencies.ops.replay.getStatus();
  }
  cancelReplay(): Promise<CancelReplayResult> {
    return this.#dependencies.ops.replay.cancelReplay();
  }

  startImpersonation(input: StartImpersonationInput): Promise<void> {
    return this.#dependencies.ops.startImpersonation(input);
  }
  stopImpersonation(input: StopImpersonationInput): Promise<void> {
    return this.#dependencies.ops.stopImpersonation(input);
  }
  adminOperation(input: AdminOperationInput): Promise<AdminOperationResult> {
    return this.#dependencies.ops.adminOperation(input);
  }

  async startAdminImpersonation(
    input: StartAdminImpersonationInput,
  ): Promise<AdminImpersonationStarted> {
    const staff = this.admitBackOfficeStaff(input.actor);
    const session = this.#adminSession(input.session);

    await this.#dependencies.ops.startImpersonation({
      sessionId: session.id,
      impersonatorUserId: staff.id,
      userIdToImpersonate: input.userIdToImpersonate,
      reason: input.reason,
      req: input.req,
    });

    return { message: "Impersonation started" } as const;
  }

  async stopAdminImpersonation(
    input: StopAdminImpersonationInput,
  ): Promise<AdminImpersonationStopped> {
    this.admitBackOfficeStaff(input.actor);
    const session = this.#adminSession(input.session);

    await this.#dependencies.ops.stopImpersonation({ sessionId: session.id });

    return { message: "Impersonation ended" } as const;
  }

  runAdminOperation(input: RunAdminOperationInput): Promise<AdminOperationResult> {
    const staff = this.admitBackOfficeStaff(input.actor);
    const resource = adminResourceNameSchema.safeParse(
      ADMIN_RESOURCE_NAMES[input.resource] ?? input.resource,
    );

    if (!resource.success) {
      throw new ValidationError("Unknown admin resource", {
        meta: { fieldErrors: { resource: ["This isn't a resource the admin API serves."] } },
      });
    }

    return this.#dependencies.ops.adminOperation({
      resource: resource.data,
      method: input.method,
      params: input.params,
      actorId: staff.id,
      req: input.req,
    });
  }

  #adminSession(session: StopAdminImpersonationInput["session"]): { id: string } {
    if (!session) throw new AdminSessionExpiredError();

    return session;
  }
  listBlobQueues(): Promise<string[]> {
    return this.#dependencies.ops.listBlobQueues();
  }
  getBlobStoreStats(): Promise<OpsBlobStoreStats> {
    return this.#dependencies.ops.getBlobStoreStats();
  }
  listBlobs(input: ListBlobsInput): Promise<OpsBlobPage> {
    return this.#dependencies.ops.listBlobs(input);
  }
  findBlob(input: GetBlobInput): Promise<OpsBlobSummary | null> {
    return this.#dependencies.ops.findBlob(input);
  }
  async runBlobCleanup({
    operator,
    confirm,
    ...command
  }: RunBlobCleanupCommand): Promise<BlobSweepReport> {
    if (!command.dryRun) this.assertDestructiveOperator(operator, confirm);

    return this.#dependencies.ops.runBlobCleanup(command);
  }
  deleteBlob(input: DeleteBlobInput): Promise<DeleteBlobResult> {
    return this.#dependencies.ops.deleteBlob(input);
  }
  listScheduledJobs(input: ListScheduledJobsInput): Promise<OpsScheduledJob[]> {
    return this.#dependencies.ops.listScheduledJobs(input);
  }
  setScheduleActive(input: SetScheduleActiveInput): Promise<OpsScheduledJob> {
    return this.#dependencies.ops.setScheduleActive(input);
  }
  clearStuckScheduleSlot(input: ScheduleControlInput): Promise<OpsScheduledJob> {
    return this.#dependencies.ops.clearStuckScheduleSlot(input);
  }
  runScheduleNow(input: ScheduleControlInput): Promise<OpsScheduledJob> {
    return this.#dependencies.ops.runScheduleNow(input);
  }
  listQueues(): Promise<QueueSummaryInfo[]> {
    return this.#dependencies.ops.listQueues();
  }
  getBlockedQueueSummary(): Promise<OpsBlockedSummary> {
    return this.#dependencies.ops.getBlockedQueueSummary();
  }
  listAllQueueDlqGroups(): Promise<OpsQueueDlqGroupWithQueue[]> {
    return this.#dependencies.ops.listAllQueueDlqGroups();
  }
  pauseQueuePipeline(input: PauseQueuePipelineInput): Promise<void> {
    return this.#dependencies.ops.pauseQueuePipeline(input);
  }
  unpauseQueuePipeline(input: UnpauseQueuePipelineInput): Promise<void> {
    return this.#dependencies.ops.unpauseQueuePipeline(input);
  }
  listPausedQueueKeys(input: ListPausedQueueKeysInput): Promise<string[]> {
    return this.#dependencies.ops.listPausedQueueKeys(input);
  }
  pauseQueueTenant(input: PauseQueueTenantInput): Promise<void> {
    return this.#dependencies.ops.pauseQueueTenant(input);
  }
  unpauseQueueTenant(input: UnpauseQueueTenantInput): Promise<void> {
    return this.#dependencies.ops.unpauseQueueTenant(input);
  }
  listPausedQueueTenants(input: ListPausedQueueTenantsInput): Promise<string[]> {
    return this.#dependencies.ops.listPausedQueueTenants(input);
  }
  listQueueDlqGroups(input: ListQueueDlqGroupsInput): Promise<OpsQueueDlqGroup[]> {
    return this.#dependencies.ops.listQueueDlqGroups(input);
  }
  discoverQueueNames(): Promise<string[]> {
    return this.#dependencies.ops.discoverQueueNames();
  }
  scanQueues(input: ScanQueuesInput): Promise<QueueInfo[]> {
    return this.#dependencies.ops.scanQueues(input);
  }
  readQueuePendingDrift(input: ReadQueuePendingDriftInput): Promise<number> {
    return this.#dependencies.ops.readQueuePendingDrift(input);
  }
  listPausedSchedules(input: ListPausedSchedulesInput): Promise<ListPausedSchedulesResult> {
    return this.#dependencies.ops.listPausedSchedules(input);
  }
  listSchedulerActions(input: ListSchedulerActionsInput): Promise<SchedulerAuditEntryView[]> {
    return this.#dependencies.ops.listSchedulerActions(input);
  }
  listQueueGroups(input: ListQueueGroupsInput): Promise<OpsQueueGroupsPage> {
    return this.#dependencies.ops.listQueueGroups(input);
  }
  findQueueGroup(input: FindQueueGroupInput): Promise<GroupInfo | null> {
    return this.#dependencies.ops.findQueueGroup(input);
  }
  listQueueGroupJobs(input: ListQueueGroupJobsInput): Promise<OpsQueueJobsPage> {
    return this.#dependencies.ops.listQueueGroupJobs(input);
  }
  listParkedQueueGroups(input: ListParkedQueueGroupsInput): Promise<OpsParkedGroupsPage> {
    return this.#dependencies.ops.listParkedQueueGroups(input);
  }
  unblockQueueGroup(input: UnblockQueueGroupInput): Promise<UnblockQueueGroupResult> {
    return this.#dependencies.ops.unblockQueueGroup(input);
  }
  unblockAllQueueGroups(input: UnblockAllQueueGroupsInput): Promise<UnblockAllQueueGroupsResult> {
    return this.#dependencies.ops.unblockAllQueueGroups(input);
  }
  drainQueueGroup(input: DrainQueueGroupInput): Promise<DrainQueueGroupResult> {
    return this.#dependencies.ops.drainQueueGroup(input);
  }
  retryBlockedQueueJob(input: RetryBlockedQueueJobInput): Promise<RetryBlockedQueueJobResult> {
    return this.#dependencies.ops.retryBlockedQueueJob(input);
  }
  drainQueueTenant(input: DrainQueueTenantInput): Promise<DrainQueueTenantResult> {
    return this.#dependencies.ops.drainQueueTenant(input);
  }
  moveQueueGroupToDlq(input: MoveQueueGroupToDlqInput): Promise<MoveQueueGroupToDlqResult> {
    return this.#dependencies.ops.moveQueueGroupToDlq(input);
  }
  moveAllBlockedQueueGroupsToDlq(
    input: MoveAllBlockedQueueGroupsToDlqInput,
  ): Promise<MoveAllBlockedQueueGroupsToDlqResult> {
    return this.#dependencies.ops.moveAllBlockedQueueGroupsToDlq(input);
  }
  replayQueueGroupFromDlq(
    input: ReplayQueueGroupFromDlqInput,
  ): Promise<ReplayQueueGroupFromDlqResult> {
    return this.#dependencies.ops.replayQueueGroupFromDlq(input);
  }
  replayAllQueueGroupsFromDlq(
    input: ReplayAllQueueGroupsFromDlqInput,
  ): Promise<ReplayAllQueueGroupsFromDlqResult> {
    return this.#dependencies.ops.replayAllQueueGroupsFromDlq(input);
  }
  redriveQueueDlqGroups(input: RedriveQueueDlqGroupsInput): Promise<RedriveQueueDlqGroupsResult> {
    return this.#dependencies.ops.redriveQueueDlqGroups(input);
  }
  discardQueueDlqGroups(input: DiscardQueueDlqGroupsInput): Promise<DiscardQueueDlqGroupsResult> {
    return this.#dependencies.ops.discardQueueDlqGroups(input);
  }
  canaryRedriveQueueDlq(input: CanaryRedriveQueueDlqInput): Promise<CanaryRedriveQueueDlqResult> {
    return this.#dependencies.ops.canaryRedriveQueueDlq(input);
  }
  canaryUnblockQueueGroups(
    input: CanaryUnblockQueueGroupsInput,
  ): Promise<CanaryUnblockQueueGroupsResult> {
    return this.#dependencies.ops.canaryUnblockQueueGroups(input);
  }
  getQueueDrainPreview(input: GetQueueDrainPreviewInput): Promise<OpsQueueDrainPreview> {
    return this.#dependencies.ops.getQueueDrainPreview(input);
  }
  reconcileQueuePending(input: ReconcileQueuePendingInput): Promise<OpsQueueReconcileOutcome> {
    return this.#dependencies.ops.reconcileQueuePending(input);
  }
  listParkedQueueTenants(input: ListParkedQueueTenantsInput): Promise<OpsParkedTenantsPage> {
    return this.#dependencies.ops.listParkedQueueTenants(input);
  }

  // -- the platform-tier gate ------------------------------------------------

  /**
   * The caller's operator reach, as an answer rather than a refusal: the
   * global menu polls it on every page load, so a non-operator gets
   * `{ kind: "none" }` and not a console full of errors (lw#3584).
   */
  operatorScope(operator: OpsOperator | null): OpsScope {
    return this.#operatorOf(operator) ? { kind: "platform" } : { kind: "none" };
  }

  /**
   * The one gate every operator procedure passes: platform-tier, resolving the
   * allow-list with no id from the request — there is no scope to check at.
   * Silent-damage writes pass a second gate too (destructive-operator checks).
   */
  admitOperator(operator: OpsOperator | null, permission: OpsOperatorPermission): void {
    if (!this.#operatorOf(operator)) throw new OpsOperatorRequiredError(permission);
  }

  /**
   * The staff gate on the support inbox. The same allow-list, named for what
   * it decides there: a bug report carries no tenant, so staff is the only
   * question that could be asked about it.
   */
  admitStaff(operator: OpsOperator | null): OpsOperator {
    if (!this.#operatorOf(operator)) throw new OpsOperatorRequiredError("ops:view");

    return actingIdentityOf(operator);
  }

  /**
   * The same list, refused the back office's way: not-found rather than
   * forbidden, so a probe learns nothing about whether the surface exists.
   */
  admitBackOfficeStaff(operator: OpsOperator | null): OpsOperator {
    if (!this.#operatorOf(operator)) throw new AdminSurfaceHiddenError();

    return actingIdentityOf(operator);
  }

  /**
   * The acting operator, or nothing where the caller is not on the list. An
   * impersonating operator is read as the operator: somebody debugging a
   * customer account is still staff, and the list matches the ADDRESS.
   */
  #operatorOf(operator: OpsOperator | null): OpsOperator | null {
    if (!operator) return null;

    return this.isAdmin(actingIdentityOf(operator)) ? operator : null;
  }

  // -- the operator-only ClickHouse EXPLAIN ----------------------------------

  /**
   * The operator secret, compared in constant time. A deployment that
   * configured none refuses every call: a blank expected secret must never
   * match a blank presented one.
   */
  authorizeOperatorSecret(input: { presented: string | null }): void {
    const expected = this.#dependencies.findOpsApiKey();

    if (!expected || !input.presented) throw new OpsOperatorSecretRequiredError();

    const presented = Buffer.from(input.presented);
    const secret = Buffer.from(expected);

    if (presented.length !== secret.length) throw new OpsOperatorSecretRequiredError();
    if (!timingSafeEqual(presented, secret)) throw new OpsOperatorSecretRequiredError();
  }

  /** One EXPLAIN, wrapped so it cannot execute, audited by its shape. */
  async explainClickHouseQuery(input: OpsExplainRequest): Promise<OpsExplainAnswer> {
    const built = buildExplainQuery(input.query, input.type);

    if (!built.wrapped || !built.type) {
      return { status: "refused", reason: built.reason ?? "invalid query" };
    }

    const outcome = await this.#dependencies.explain.explain({
      wrappedQuery: built.wrapped,
      type: built.type,
      isProduction: this.#dependencies.isProduction,
      auditFields: redactQueryForAudit(input.query),
    });

    if (outcome.status === "ok") return { status: "ok", type: built.type, rows: outcome.rows };
    // The engine's own prose names cluster internals; the explain service logs it.
    if (outcome.status === "error") return { status: "failed" };

    return outcome;
  }

  // -- the process's own readings --------------------------------------------

  listPipelineRegistrations(): OpsPipelineRegistrations {
    return this.#dependencies.pipelines.listRegistrations();
  }

  getEventLogSearchWindow(): OpsEventLogSearchWindow {
    return this.#dependencies.eventLogWindow.read();
  }

  findGrafanaLinkConfig(): OpsGrafanaLinkConfig {
    return this.#dependencies.grafana.findLinkConfig();
  }

  findProductAnalyticsTargets(): ProductAnalyticsTarget[] {
    return this.#dependencies.findProductAnalyticsTargets();
  }

  // -- in-place system migrations --------------------------------------------

  listSystemMigrations(): Promise<OpsMigrationOverview[]> {
    return this.#dependencies.systemMigrations.getOverview();
  }

  listMigrationEnrollments(input: { requestedBy: string }): Promise<OpsMigrationEnrollmentListing> {
    return this.#dependencies.systemMigrations.getEnrollments(input);
  }

  searchMigrationOrganizations(input: { query: string }): Promise<OpsMigrationOrganizationMatch[]> {
    return this.#dependencies.systemMigrations.searchOrganizations(input);
  }

  async enrollMigrationTenant(input: {
    organizationId: string;
    migrationName: string;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<void> {
    const actorUserId = this.#confirmedMigrationActor(input);

    await this.#dependencies.systemMigrations.enroll({
      organizationId: input.organizationId,
      migrationName: input.migrationName,
      actorUserId,
    });
  }

  enrollMigrationCohort(input: {
    migrationName: string;
    sampleSize: number;
    includeEnterprise: boolean;
    includePrivateDataplane: boolean;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<OpsMigrationCohortResult> {
    const actorUserId = this.#confirmedMigrationActor(input);

    return this.#dependencies.systemMigrations.enrollCohort({
      migrationName: input.migrationName,
      sampleSize: input.sampleSize,
      includeEnterprise: input.includeEnterprise,
      includePrivateDataplane: input.includePrivateDataplane,
      actorUserId,
    });
  }

  withdrawMigrationTenant(input: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<void> {
    return this.#dependencies.systemMigrations.withdraw(input);
  }

  runSystemMigrationForOrganization(input: {
    organizationId: string;
    migrationName: string;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<OpsMigrationTargetedRunResult> {
    const actorUserId = this.#confirmedMigrationActor(input);

    return this.#dependencies.systemMigrations.runForOrganization({
      organizationId: input.organizationId,
      migrationName: input.migrationName,
      actorUserId,
    });
  }

  runSystemMigrationPass(): void {
    this.#dependencies.systemMigrations.startPass();
  }

  async assertSystemMigrationLegacyWritersDrained(input: {
    migrationName: string;
    tenantId: string;
    minimumWriterGeneration: string;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<void> {
    this.assertDestructiveOperator(input.operator ?? null, input.confirm);

    await this.#dependencies.systemMigrations.assertLegacyWritersDrained({
      migrationName: input.migrationName,
      tenantId: input.tenantId,
      minimumWriterGeneration: input.minimumWriterGeneration,
      actorUserId: this.#actorIdOf(input.operator),
    });
  }

  /**
   * Pin a migrated or finalized organization back onto its legacy path. Same
   * posture as the blob-store writes: callable without the dialog, and it
   * decides which tables answer an entire organization's permission checks.
   */
  async rollBackSystemMigrationTenant(input: {
    migrationName: string;
    tenantId: string;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<void> {
    this.assertDestructiveOperator(input.operator ?? null, input.confirm);

    await this.#dependencies.systemMigrations.rollBack({
      migrationName: input.migrationName,
      tenantId: input.tenantId,
      actorUserId: this.#actorIdOf(input.operator),
    });
  }

  /**
   * The confirmation gate the migration itself declares, and the actor the
   * enrollment is attributed to. Which migrations are guarded comes from their
   * own declaration, so this gate and the page asking cannot drift apart.
   */
  #confirmedMigrationActor(input: {
    migrationName: string;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): string {
    const guarded = this.#dependencies.systemMigrations.requiresOperatorConfirmation({
      migrationName: input.migrationName,
    });

    if (guarded) this.assertDestructiveOperator(input.operator ?? null, input.confirm);

    return this.#actorIdOf(input.operator);
  }

  /** The opaque id a migration write is attributed to. */
  #actorIdOf(operator: OpsOperator | null): string {
    if (!operator) throw new OpsOperatorSessionRequiredError();

    return operator.id;
  }

  // -- the support inbox -----------------------------------------------------

  async listBugReports(
    input: ListBugReportsInput & { actorUserId: string },
  ): Promise<BugReportListing> {
    await this.#recordBugReportRead({
      actorUserId: input.actorUserId,
      action: "bugReports.getAll",
      // Never the raw search text: contact searches are email addresses, and
      // audit rows outlive the inbox.
      args: {
        page: input.page,
        pageSize: input.pageSize,
        hasSearch: Boolean(input.search),
      },
    });

    return this.#dependencies.inbox.getAll({
      page: input.page,
      pageSize: input.pageSize,
      search: input.search,
    });
  }

  async getBugReport(input: { id: string; actorUserId: string }): Promise<BugReport> {
    await this.#recordBugReportRead({
      actorUserId: input.actorUserId,
      action: "bugReports.getById",
      targetId: input.id,
    });

    const report = await this.#dependencies.inbox.findById({ id: input.id });

    if (!report) throw new NotFoundError("not_found", "Report", input.id);

    return report;
  }

  /**
   * File one report from a customer's coding agent. Unauthenticated on
   * purpose: the reporter may be struggling because setup failed, so a report
   * must never require a working login. A credential only enriches it.
   */
  submitBugReport(input: {
    report: SubmitBugReport;
    callerKey: string;
    apiToken?: string | undefined;
    projectIdHint?: string | null;
  }): Promise<{ id: string }> {
    return this.#dependencies.intake.submit({
      input: input.report,
      callerKey: input.callerKey,
      apiToken: input.apiToken,
      projectIdHint: input.projectIdHint,
      apiKeys: this.#dependencies.apiKeys,
    });
  }

  /**
   * Written BEFORE the answer, and awaited: reports carry reporter-submitted
   * transcripts and contact addresses, so who opened one is itself a fact
   * worth keeping.
   */
  async #recordBugReportRead(entry: {
    actorUserId: string;
    action: string;
    args?: RecordAuditLogCommand["args"];
    targetId?: string;
  }): Promise<void> {
    await this.#dependencies.auditLog.record({
      userId: entry.actorUserId,
      action: entry.action,
      ...(entry.args === undefined ? {} : { args: entry.args }),
      targetKind: BUG_REPORT_TARGET_KIND,
      ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
    });
  }

  // -- Settings, Checkup and the usage report (specs/self-hosting/checkup) --

  /** The free checks, or "not a self-hosted install" on LangWatch Cloud. */
  async getCheckup({ organizationId }: { organizationId: string }): Promise<CheckupAnswer> {
    const checkup = this.#checkup;
    if (checkup.isSaas) return { deployment: "saas" };
    const result = await checkup.checkupFor({ organizationId, requestedBy: "checkup" }).cheap();
    return { deployment: "self-hosted", ...result };
  }

  async runCheckup({
    organizationId,
    requestedBy,
    ...input
  }: {
    organizationId: string;
    requestedBy?: string;
  } & ExplicitCheckInput): Promise<CheckupAnswer> {
    const checkup = this.#checkup;
    if (checkup.isSaas) return { deployment: "saas" };
    const result = await checkup
      .checkupFor({ organizationId, requestedBy: requestedBy ?? "checkup" })
      .explicit(input);
    return { deployment: "self-hosted", ...result };
  }

  async getUsageReport(_input: { organizationId: string }): Promise<UsageReportAnswer> {
    const checkup = this.#checkup;
    if (checkup.isSaas) return { deployment: "saas" };
    return { deployment: "self-hosted", ...(await checkup.usageReports.preview()) };
  }

  async setUsageReportSwitches({
    organizationId: _organizationId,
    ...switches
  }: {
    organizationId: string;
    optionalMetricsOptOut?: boolean;
    hostnameOptOut?: boolean;
  }): Promise<UsageReportAnswer> {
    const checkup = this.#checkup;
    if (checkup.isSaas) return { deployment: "saas" };
    return { deployment: "self-hosted", ...(await checkup.usageReports.setSwitches(switches)) };
  }

  /** The key names a project, the project names the organization, and the checkup runs for it. */
  async getProjectCheckup({ projectId }: { projectId: string }): Promise<ProjectCheckupReport> {
    const checkup = this.#checkup;
    if (checkup.isSaas) throw new CheckupNotSelfHostedError();
    const organizationId = await this.#dependencies.projects.getOrganizationId(projectId);
    const [result, usageReport] = await Promise.all([
      checkup.checkupFor({ organizationId, requestedBy: "checkup" }).cheap(),
      checkup.usageReports.preview(),
    ]);
    return { ...result, usageReport };
  }

  async runProjectCheckup({
    projectId,
    ...input
  }: { projectId: string } & ExplicitCheckInput): Promise<CheckupResult> {
    const checkup = this.#checkup;
    if (checkup.isSaas) throw new CheckupNotSelfHostedError();
    const organizationId = await this.#dependencies.projects.getOrganizationId(projectId);
    return checkup.checkupFor({ organizationId, requestedBy: "checkup" }).explicit(input);
  }

  getStartupNotice(_input: { organizationId: string }): Promise<StartupNoticeState> {
    return this.#checkup.usageReports.getStartupNotice();
  }

  async dismissStartupNotice({
    schemaVersion,
  }: {
    organizationId: string;
    schemaVersion: number;
  }): Promise<{ dismissed: boolean }> {
    return { dismissed: await this.#checkup.usageReports.dismissStartupNotice({ schemaVersion }) };
  }

  /** The daily report's one send for `ops_usage_report`; never throws for a refusal. */
  sendUsageReport(): Promise<string> {
    return this.#checkup.usageReports.send();
  }

  /** One tick of `ops_anomaly_detection`: surfaces and clears the tenants' rate anomalies. */
  detectAnomalies(): Promise<AnomalyDetectionTickResult> {
    const { anomalies } = this.#dependencies;
    if (!anomalies) throw new OpsCapabilityUnavailableError("anomaly detection");
    return anomalies.tick();
  }

  /** One pass of `ops_storage_stats`: measures every endpoint and saves the readings. */
  measureStorage(): Promise<void> {
    const { storageStats } = this.#dependencies;
    if (!storageStats) throw new OpsCapabilityUnavailableError("storage stats");
    return storageStats.collect();
  }

  get #checkup(): OpsCheckupService {
    const { checkup } = this.#dependencies;
    if (!checkup) throw new OpsCapabilityUnavailableError("the checkup");
    return checkup;
  }

  /**
   * Writes reach explicit registry entries and the kill-switch keys the live
   * pipeline graph advertises, and nothing else: family-prefix matching alone
   * would let a typo store an orphan row that never affects anything.
   */
  private requireRegisteredFlag(key: string): void {
    if (listFeatureFlags().some((flag) => flag.key === key)) return;
    const killSwitches = this.#dependencies.eventingIntrospection.killSwitches();
    if (killSwitches.some((d) => d.key === key)) return;
    throw new OpsUnknownFeatureFlagError(key);
  }
}

/** External alert delivery for a newly surfaced hard-tier anomaly. */
export interface AnomalyHardTierAlert {
  notify(anomaly: Anomaly): Promise<void>;
}

/**
 * The live pipeline surface the ops explorers read: a package may not reach
 * `getApp().eventSourcing.definitions` (a process global), so this is the
 * adapter seam over the definitions the composition already holds.
 */
export interface OpsProjectionMetadata {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  pauseKey: string;
  kind: "fold" | "map" | "state";
}

export interface OpsProcessManagerMetadata {
  processName: string;
  pipelineName: string;
  aggregateType: string;
  /** Event types that drive the machine's transitions. */
  eventTypes: readonly string[];
  /**
   * Intent types the machine can emit — its cross-aggregate commands,
   * dispatched through the transactional outbox.
   */
  intentTypes: string[];
  /**
   * True for a fixed-interval singleton (one instance, project `__global__`);
   * false for a per-aggregate machine keyed by aggregate id.
   */
  scheduled: boolean;
  /** Fixed wake interval in ms for a scheduled singleton, else null. */
  everyMs: number | null;
  /** True when the machine computes its own wake-ups from within `evolve`. */
  hasWake: boolean;
}

export interface OpsDejaViewProjection {
  projectionName: string;
  eventTypes: readonly string[];
  init: () => unknown;
  apply: (state: unknown, event: { type: string }) => unknown;
}

/**
 * One togglable kill switch the live pipeline graph will read at runtime.
 * Advertised before any row exists, because a write refuses a key that is
 * neither a registry entry nor a live descriptor.
 */
export interface OpsKillSwitchDescriptor {
  key: string;
  aggregateType: string;
  componentType: "projection" | "mapProjection" | "command" | "subscriber";
  componentName: string;
  pipelineName: string;
}

export interface OpsEventingIntrospection {
  /** Every fold, map and state projection mounted across the pipelines. */
  projections(): OpsProjectionMetadata[];

  /** Every kill-switch key the mounted components will consult at runtime. */
  killSwitches(): OpsKillSwitchDescriptor[];

  /** The process-manager state machines mounted across the pipelines. */
  processManagers(): OpsProcessManagerMetadata[];

  /**
   * The fold projections a DejaView replay can re-run in memory, carrying
   * their `init`/`apply` so the explorer can rebuild state without a store.
   */
  dejaViewProjections(): OpsDejaViewProjection[];
}

export interface OpsSnapshotRedis {
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
  set(
    key: string,
    value: string,
    expiryMode: "EX",
    expirySeconds: number,
    condition: "NX",
  ): Promise<unknown>;
  tryGet(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
}

/**
 * Where one organization's data lives. The routing places an organization-rooted append on its own
 * instance.
 */
export type OrganizationDataplane =
  | Readonly<{ kind: "shared" }>
  | Readonly<{ kind: "private"; endpoint: string }>;

export interface OrganizationDataplaneResolver {
  /**
   * Synchronous: the routing table is an environment fact read once at boot,
   * so a pass that asks per organization must not pay a round trip for it.
   */
  dataplaneFor(organizationId: string): OrganizationDataplane;
}

/** A queued payload read back for display, or one this decoder cannot read. */
export type QueuePayloadDecoding =
  | { kind: "decoded"; data: Record<string, unknown> }
  | { kind: "undecodable" };

export interface QueuePayloadDecoder {
  decode(input: { queueName: string; value: string }): Promise<QueuePayloadDecoding>;
}

/**
 * One replay run's engine, built fresh per run: its own Redis connection, its
 * own ClickHouse readers and the projections it can rebuild.
 */
export interface OpsReplayRuntime {
  service: EventingReplayService;
  projections: RegisteredFoldProjection[];
  mapProjections: RegisteredMapProjection[];
  /**
   * Discovered Postgres operational state projections, carrying their
   * definition and store for a paused, from-init canonical rebuild.
   */
  stateProjections: RegisteredStateProjection[];
  close: () => Promise<void>;
}

/**
 * Builds the runtime a replay run drives. `create` throws when the deployment cannot serve a replay
 * (no Redis, no ClickHouse route).
 */
export interface OpsReplayRuntimeFactory {
  create(): OpsReplayRuntime;
}

/** Wakes the scheduler loop after an operator makes work due. */
export interface SchedulerWake {
  wake(): void;
}
