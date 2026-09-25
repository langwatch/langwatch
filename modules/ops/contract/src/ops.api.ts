import type {
  FeatureFlagRules,
  OperatorFeatureFlagCatalogue,
} from "@langwatch/feature-flag-contract";
import { moduleApi } from "@langwatch/kernel/module-api";
import type { SearchProjectsResult } from "@langwatch/project-contract";

import type {
  AdminImpersonationStarted,
  AdminImpersonationStopped,
  AdminOperationInput,
  AdminOperationResult,
  RunAdminOperationInput,
  StartAdminImpersonationInput,
  StopAdminImpersonationInput,
} from "./admin-backoffice.ts";
import type { AdminIdentity, StartImpersonationInput, StopImpersonationInput } from "./admin.ts";
import type {
  DeleteBlobInput,
  DeleteBlobResult,
  GetBlobInput,
  ListBlobsInput,
  OpsBlobPage,
  OpsBlobSummary,
  OpsBlobStoreStats,
  BlobSweepReport,
  RunBlobCleanupInput,
} from "./blob-store.ts";
import type { StartupNoticeState } from "./checkup-usage-report.ts";
import type { CheckupAnswer, UsageReportAnswer } from "./checkup.trpc.ts";
import type { CheckupResult, ExplicitCheckInput, ProjectCheckupReport } from "./checkup.ts";
import type { Anomaly, AnomalyKind } from "./ops-anomaly.ts";
import type {
  BugReport,
  BugReportListing,
  ListBugReportsInput,
  SubmitBugReport,
} from "./ops-bug-report.ts";
import type { DashboardData, GroupInfo } from "./ops-dashboard.ts";
import type {
  AggregateDiscovery,
  AggregateEventView,
  AggregateSearchResult,
  ProjectionStateAtEvent,
} from "./ops-event-log.ts";
import type {
  AggregateProcessManager,
  DeadLetterCount,
  DeadOutboxMessageView,
  OutboxAttemptView,
  ProcessAuditEntryView,
  ProcessFleetSummary,
  ProcessInstanceDetail,
  ProcessInstanceRow,
  ProcessOutboxMessageView,
  ProcessWakeRow,
} from "./ops-process.ts";
import type {
  OpsBlockedSummary,
  OpsParkedGroupsPage,
  OpsParkedTenantsPage,
  OpsQueueDlqGroup,
  OpsQueueDlqGroupWithQueue,
  OpsQueueDrainPreview,
  OpsQueueGroupsPage,
  OpsQueueJobsPage,
  OpsQueueReconcileOutcome,
  QueueInfo,
  QueueSummaryInfo,
} from "./ops-queue.ts";
import type { ReplayHistoryEntry, ReplayStatus } from "./ops-replay.ts";
import type {
  ListPausedSchedulesInput,
  ListScheduledJobsInput,
  ListSchedulerActionsInput,
  OpsScheduledJob,
  ScheduleControlInput,
  SchedulerAuditEntryView,
  SetScheduleActiveInput,
} from "./ops-scheduler.ts";
import type { OpsSignUpHealthInput, SignUpHealth } from "./ops-sign-up-health.ts";
import type { OpsSnapshotAbortSignal } from "./ops-snapshot.service.ts";
import type {
  OpsMigrationCohortResult,
  OpsMigrationEnrollmentListing,
  OpsMigrationOrganizationMatch,
  OpsMigrationOverview,
  OpsMigrationTargetedRunResult,
} from "./ops-system-migration.ts";
import type { ProductAnalyticsTarget } from "./ops.config.ts";
import type {
  OpsEventLogSearchWindow,
  OpsExplainAnswer,
  OpsExplainRequest,
  OpsGrafanaLinkConfig,
  OpsOperator,
  OpsOperatorPermission,
  OpsPipelineRegistrations,
  OpsScope,
} from "./ops.responses.ts";

export type DiscoverAggregatesInput = {
  projectionNames: string[];
  since: string;
  tenantIds: string[];
};

export type GetAggregateEventsInput = {
  aggregateId: string;
  tenantId: string;
  limit: number;
};

export type GetForAggregateInput = {
  aggregateType: string;
  projectId: string;
  aggregateId: string;
};

export type RequeueDeadMessagesInput = {
  processName: string;
  projectId: string;
  processKey: string;
  messageKeyPrefix?: string;
  requestedBy: string;
};

export type RequeueDeadMessagesResult = { requeued: number };

export type GetDeadLettersInput = {
  processName?: string;
  page: number;
  pageSize: number;
};

export type GetDeadLettersResult = {
  messages: DeadOutboxMessageView[];
  total: number;
  byProcess: DeadLetterCount[];
};

export type GetInstancesInput = {
  processName?: string;
  page: number;
  pageSize: number;
  search?: string;
};

export type GetInstancesResult = { instances: ProcessInstanceRow[]; total: number };

export type GetUpcomingWakesInput = { limit: number };

export type FindInstanceDetailInput = {
  ref: { processName: string; projectId: string; processKey: string };
};

export type GetOutboxInput = {
  ref: { processName: string; projectId: string; processKey: string };
  page: number;
  pageSize: number;
};

export type GetOutboxResult = { messages: ProcessOutboxMessageView[]; total: number };

export type ListRecentActionsInput = { limit: number };

export type WakeNowInput = {
  ref: { processName: string; projectId: string; processKey: string };
  actorUserId: string;
};

export type WakeNowResult = { woke: boolean };

export type RedriveDeadInstanceInput = {
  ref: { processName: string; projectId: string; processKey: string };
  actorUserId: string;
};

export type RedriveDeadInstanceResult = { requeued: number };

export type RedriveDeadMessageInput = {
  ref: { processName: string; projectId: string; processKey: string };
  messageId: string;
  actorUserId: string;
};

export type RedriveDeadMessageResult = { redriven: boolean };

export type DiscardDeadMessageInput = {
  ref: { processName: string; projectId: string; processKey: string };
  messageId: string;
  actorUserId: string;
};

export type DiscardDeadMessageResult = { discarded: boolean };

export type RedriveDeadLettersInput = {
  processName?: string;
  actorUserId: string;
};

export type RedriveDeadLettersResult = { redriven: number };

export type DiscardDeadLettersInput = {
  processName?: string;
  actorUserId: string;
};

export type DiscardDeadLettersResult = { discarded: number };

export type GetOutboxAttemptsInput = { outboxId: string; projectId: string };

export type ReleaseLapsedLeaseInput = {
  ref: { processName: string; projectId: string; processKey: string };
  messageId: string;
  actorUserId: string;
};

export type ReleaseLapsedLeaseResult = { released: boolean };

export type FindHistoryEntryInput = { runId: string };

export type StartReplayInput = {
  projectionNames: string[];
  since: string;
  tenantIds: string[];
  aggregateIds?: string[];
  fullRebuild?: boolean;
  description: string;
  userName: string;
};

export type StartReplayResult = { runId: string };

export type CancelReplayResult = { cancelled: boolean };

export type PauseQueuePipelineInput = { queueName: string; key: string };

export type UnpauseQueuePipelineInput = { queueName: string; key: string };

export type ListPausedQueueKeysInput = { queueName: string };

export type PauseQueueTenantInput = { queueName: string; tenantId: string };

export type UnpauseQueueTenantInput = { queueName: string; tenantId: string };

export type ListPausedQueueTenantsInput = { queueName: string };

export type ListQueueDlqGroupsInput = { queueName: string };

export type ScanQueuesInput = { queueNames: string[] };

export type ReadQueuePendingDriftInput = { queueNames: string[] };

export type ListPausedSchedulesResult = { schedules: OpsScheduledJob[]; total: number };

export type ListQueueGroupsInput = {
  queueName: string;
  page: number;
  pageSize: number;
};

export type FindQueueGroupInput = { queueName: string; groupId: string };

export type ListQueueGroupJobsInput = {
  queueName: string;
  groupId: string;
  page: number;
  pageSize: number;
};

export type ListParkedQueueGroupsInput = {
  queueName: string;
  tenantId: string;
  page: number;
  pageSize: number;
};

export type UnblockQueueGroupInput = {
  queueName: string;
  groupId: string;
  requestedBy: string;
};

export type UnblockQueueGroupResult = { wasBlocked: boolean };

export type UnblockAllQueueGroupsInput = {
  queueName: string;
  requestedBy: string;
};

export type UnblockAllQueueGroupsResult = { unblockedCount: number };

export type DrainQueueGroupInput = {
  queueName: string;
  groupId: string;
  requestedBy: string;
};

export type DrainQueueGroupResult = { jobsRemoved: number };

export type RetryBlockedQueueJobInput = {
  queueName: string;
  groupId: string;
  jobId: string;
};

export type RetryBlockedQueueJobResult = { wasBlocked: boolean };

export type DrainQueueTenantInput = {
  queueName: string;
  tenantId: string;
  groupIdContains?: string;
  requestedBy: string;
};

export type DrainQueueTenantResult = { groupsDrained: number; jobsDrained: number };

export type MoveQueueGroupToDlqInput = {
  queueName: string;
  groupId: string;
  requestedBy: string;
};

export type MoveQueueGroupToDlqResult = { jobsMoved: number };

export type ReplayQueueGroupFromDlqInput = {
  queueName: string;
  groupId: string;
};

export type ReplayQueueGroupFromDlqResult = { jobsReplayed: number };

export type ReplayAllQueueGroupsFromDlqInput = {
  queueName: string;
  pipelineFilter?: string;
  errorFilter?: string;
};

export type ReplayAllQueueGroupsFromDlqResult = { replayedCount: number; jobsReplayed: number };

export type RedriveQueueDlqGroupsInput = {
  queueName: string;
  groupIds: string[];
  requestedBy: string;
};

export type RedriveQueueDlqGroupsResult = { redrivenCount: number; jobsRedriven: number };

export type DiscardQueueDlqGroupsInput = {
  queueName: string;
  groupIds: string[];
  requestedBy: string;
};

export type DiscardQueueDlqGroupsResult = { discardedCount: number; jobsDiscarded: number };

export type CanaryRedriveQueueDlqInput = {
  queueName: string;
  count?: number;
  pipelineFilter?: string;
};

export type CanaryRedriveQueueDlqResult = { redrivenCount: number; groupIds: string[] };

export type CanaryUnblockQueueGroupsInput = {
  queueName: string;
  count?: number;
  pipelineFilter?: string;
};

export type CanaryUnblockQueueGroupsResult = { unblockedCount: number; groupIds: string[] };

export type GetQueueDrainPreviewInput = {
  queueName: string;
  pipelineFilter?: string;
  errorFilter?: string;
};

export type ReconcileQueuePendingInput = { queueName: string };

export type ListParkedQueueTenantsInput = {
  queueNames: string[];
  maxTenants: number;
};

export type MoveAllBlockedQueueGroupsToDlqInput = {
  queueName: string;
  pipelineFilter?: string;
  errorFilter?: string;
  requestedBy: string;
};

export type MoveAllBlockedQueueGroupsToDlqResult = { movedCount: number; jobsMoved: number };

export type StreamDashboardInput = { signal?: OpsSnapshotAbortSignal };

export type RunBlobCleanupCommand = RunBlobCleanupInput & {
  operator: OpsOperator | null;
  confirm?: string | undefined;
};

export interface OpsApi {
  startAdminImpersonation(input: StartAdminImpersonationInput): Promise<AdminImpersonationStarted>;
  stopAdminImpersonation(input: StopAdminImpersonationInput): Promise<AdminImpersonationStopped>;
  runAdminOperation(input: RunAdminOperationInput): Promise<AdminOperationResult>;
  startImpersonation(input: StartImpersonationInput): Promise<void>;
  stopImpersonation(input: StopImpersonationInput): Promise<void>;
  adminOperation(input: AdminOperationInput): Promise<AdminOperationResult>;
  listBlobQueues(): Promise<string[]>;
  getBlobStoreStats(): Promise<OpsBlobStoreStats>;
  listBlobs(input: ListBlobsInput): Promise<OpsBlobPage>;
  findBlob(input: GetBlobInput): Promise<OpsBlobSummary | null>;
  /** A real sweep destroys blobs, so it asks the operator's confirmation; a dry run does not. */
  runBlobCleanup(input: RunBlobCleanupCommand): Promise<BlobSweepReport>;
  deleteBlob(input: DeleteBlobInput): Promise<DeleteBlobResult>;
  listAnomalies(): Promise<Anomaly[]>;
  dismissAnomaly(input: { tenantId: string; kind: AnomalyKind }): Promise<boolean>;
  listScheduledJobs(input: ListScheduledJobsInput): Promise<OpsScheduledJob[]>;
  listPausedSchedules(input: ListPausedSchedulesInput): Promise<ListPausedSchedulesResult>;
  listSchedulerActions(input: ListSchedulerActionsInput): Promise<SchedulerAuditEntryView[]>;
  setScheduleActive(input: SetScheduleActiveInput): Promise<OpsScheduledJob>;
  clearStuckScheduleSlot(input: ScheduleControlInput): Promise<OpsScheduledJob>;
  runScheduleNow(input: ScheduleControlInput): Promise<OpsScheduledJob>;
  listQueues(): Promise<QueueSummaryInfo[]>;
  listQueueGroups(input: ListQueueGroupsInput): Promise<OpsQueueGroupsPage>;
  findQueueGroup(input: FindQueueGroupInput): Promise<GroupInfo | null>;
  listQueueGroupJobs(input: ListQueueGroupJobsInput): Promise<OpsQueueJobsPage>;
  getBlockedQueueSummary(): Promise<OpsBlockedSummary>;
  listParkedQueueGroups(input: ListParkedQueueGroupsInput): Promise<OpsParkedGroupsPage>;
  listAllQueueDlqGroups(): Promise<OpsQueueDlqGroupWithQueue[]>;
  unblockQueueGroup(input: UnblockQueueGroupInput): Promise<UnblockQueueGroupResult>;
  unblockAllQueueGroups(input: UnblockAllQueueGroupsInput): Promise<UnblockAllQueueGroupsResult>;
  drainQueueGroup(input: DrainQueueGroupInput): Promise<DrainQueueGroupResult>;
  pauseQueuePipeline(input: PauseQueuePipelineInput): Promise<void>;
  unpauseQueuePipeline(input: UnpauseQueuePipelineInput): Promise<void>;
  retryBlockedQueueJob(input: RetryBlockedQueueJobInput): Promise<RetryBlockedQueueJobResult>;
  listPausedQueueKeys(input: ListPausedQueueKeysInput): Promise<string[]>;
  pauseQueueTenant(input: PauseQueueTenantInput): Promise<void>;
  unpauseQueueTenant(input: UnpauseQueueTenantInput): Promise<void>;
  listPausedQueueTenants(input: ListPausedQueueTenantsInput): Promise<string[]>;
  drainQueueTenant(input: DrainQueueTenantInput): Promise<DrainQueueTenantResult>;
  moveQueueGroupToDlq(input: MoveQueueGroupToDlqInput): Promise<MoveQueueGroupToDlqResult>;
  moveAllBlockedQueueGroupsToDlq(
    input: MoveAllBlockedQueueGroupsToDlqInput,
  ): Promise<MoveAllBlockedQueueGroupsToDlqResult>;
  replayQueueGroupFromDlq(
    input: ReplayQueueGroupFromDlqInput,
  ): Promise<ReplayQueueGroupFromDlqResult>;
  replayAllQueueGroupsFromDlq(
    input: ReplayAllQueueGroupsFromDlqInput,
  ): Promise<ReplayAllQueueGroupsFromDlqResult>;
  redriveQueueDlqGroups(input: RedriveQueueDlqGroupsInput): Promise<RedriveQueueDlqGroupsResult>;
  discardQueueDlqGroups(input: DiscardQueueDlqGroupsInput): Promise<DiscardQueueDlqGroupsResult>;
  canaryRedriveQueueDlq(input: CanaryRedriveQueueDlqInput): Promise<CanaryRedriveQueueDlqResult>;
  canaryUnblockQueueGroups(
    input: CanaryUnblockQueueGroupsInput,
  ): Promise<CanaryUnblockQueueGroupsResult>;
  listQueueDlqGroups(input: ListQueueDlqGroupsInput): Promise<OpsQueueDlqGroup[]>;
  getQueueDrainPreview(input: GetQueueDrainPreviewInput): Promise<OpsQueueDrainPreview>;
  discoverQueueNames(): Promise<string[]>;
  scanQueues(input: ScanQueuesInput): Promise<QueueInfo[]>;
  reconcileQueuePending(input: ReconcileQueuePendingInput): Promise<OpsQueueReconcileOutcome>;
  readQueuePendingDrift(input: ReadQueuePendingDriftInput): Promise<number>;
  listParkedQueueTenants(input: ListParkedQueueTenantsInput): Promise<OpsParkedTenantsPage>;
  isAdmin(identity: AdminIdentity): boolean;
  assertDestructiveOperator(operator: OpsOperator | null, confirmation: string | undefined): void;
  /**
   * The caller's operator reach. `{ kind: "none" }` is an answer rather than a
   * refusal, so the global menu can poll it on every page load.
   */
  operatorScope(operator: OpsOperator | null): OpsScope;
  /** Refuses anyone who is not on the deployment's operator allow-list. */
  admitOperator(operator: OpsOperator | null, permission: OpsOperatorPermission): void;
  /** Refuses anyone who is not on the deployment's staff allow-list. */
  admitStaff(operator: OpsOperator | null): OpsOperator;
  /**
   * The same list, refused the back office's way: not-found rather than
   * forbidden, so a probe learns nothing about whether the surface exists.
   */
  admitBackOfficeStaff(operator: OpsOperator | null): OpsOperator;
  /**
   * Refuses a caller who did not present this deployment's operator secret.
   * Compared in constant time, and refused outright where no secret is set.
   */
  authorizeOperatorSecret(input: { presented: string | null }): void;
  /** One operator EXPLAIN, guardrails and fail-closed rule included. */
  explainClickHouseQuery(input: OpsExplainRequest): Promise<OpsExplainAnswer>;
  listPipelineRegistrations(): OpsPipelineRegistrations;
  getEventLogSearchWindow(): OpsEventLogSearchWindow;
  /** Null when no Grafana is configured: callers render no link, not a dead one. */
  findGrafanaLinkConfig(): OpsGrafanaLinkConfig;
  /** This deployment's product-analytics target; empty where it configured none. */
  findProductAnalyticsTargets(): ProductAnalyticsTarget[];
  listSystemMigrations(): Promise<OpsMigrationOverview[]>;
  listMigrationEnrollments(input: { requestedBy: string }): Promise<OpsMigrationEnrollmentListing>;
  searchMigrationOrganizations(input: { query: string }): Promise<OpsMigrationOrganizationMatch[]>;
  enrollMigrationTenant(input: {
    organizationId: string;
    migrationName: string;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<void>;
  enrollMigrationCohort(input: {
    migrationName: string;
    sampleSize: number;
    includeEnterprise: boolean;
    includePrivateDataplane: boolean;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<OpsMigrationCohortResult>;
  withdrawMigrationTenant(input: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<void>;
  runSystemMigrationForOrganization(input: {
    organizationId: string;
    migrationName: string;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<OpsMigrationTargetedRunResult>;
  runSystemMigrationPass(): void;
  assertSystemMigrationLegacyWritersDrained(input: {
    migrationName: string;
    tenantId: string;
    minimumWriterGeneration: string;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<void>;
  rollBackSystemMigrationTenant(input: {
    migrationName: string;
    tenantId: string;
    operator: OpsOperator | null;
    confirm?: string | undefined;
  }): Promise<void>;
  /**
   * One page of the support inbox, audited before it is answered: reports
   * carry transcripts and contact addresses, so who opened it is worth
   * keeping. Search TEXT never reaches the audit row - it can be an email.
   */
  listBugReports(input: ListBugReportsInput & { actorUserId: string }): Promise<BugReportListing>;
  /** One report in full, audited before it is answered. */
  getBugReport(input: { id: string; actorUserId: string }): Promise<BugReport>;
  /**
   * File one report from a customer's coding agent. Unauthenticated on
   * purpose: the reporter may be struggling because setup failed, so a
   * report must never require a working login.
   */
  submitBugReport(input: {
    report: SubmitBugReport;
    callerKey: string;
    apiToken?: string | undefined;
    projectIdHint?: string | null;
  }): Promise<{ id: string }>;
  findDashboardData(): DashboardData | null;
  badgeCounts(): { blockedCount: number; dlqCount: number; computedAt: Date | null };
  streamDashboard(input: StreamDashboardInput): AsyncIterable<DashboardData>;
  getQueueGroup(input: { queueName: string; groupId: string }): Promise<GroupInfo>;
  computeProjectionState(input: {
    aggregateId: string;
    tenantId: string;
    projectionName: string;
    eventIndex: number;
  }): Promise<ProjectionStateAtEvent>;
  searchProjects(input: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]>;
  /** The orphaned-organization rate for a window, derived from stored rows (D12). */
  getSignUpHealth(input: OpsSignUpHealthInput): Promise<SignUpHealth>;
  featureFlagCatalogue(): Promise<OperatorFeatureFlagCatalogue>;
  setFeatureFlagEnabled(input: {
    key: string;
    enabled: boolean;
    lastEditedBy: string | null;
  }): Promise<void>;
  setFeatureFlagRules(input: {
    key: string;
    rules: FeatureFlagRules;
    lastEditedBy: string | null;
  }): Promise<void>;
  clearFeatureFlag(input: { key: string; lastEditedBy: string | null }): Promise<void>;
  discoverAggregates(input: DiscoverAggregatesInput): Promise<AggregateDiscovery>;
  /**
   * The event-log search. `sinceMs` is optional because the explorer's own
   * default lookback is the module's rule, not the door's: two doors asking
   * the same question must not disagree about how far back it reaches.
   */
  searchAggregates(input: {
    query: string;
    tenantIds: string[];
    sinceMs?: number | undefined;
  }): Promise<AggregateSearchResult[]>;
  getAggregateEvents(input: GetAggregateEventsInput): Promise<AggregateEventView[]>;
  getForAggregate(input: GetForAggregateInput): Promise<AggregateProcessManager[]>;
  requeueDeadMessages(input: RequeueDeadMessagesInput): Promise<RequeueDeadMessagesResult>;
  getFleetSummary(): Promise<ProcessFleetSummary[]>;
  getDeadLetters(input: GetDeadLettersInput): Promise<GetDeadLettersResult>;
  getDeadLetterCounts(): Promise<DeadLetterCount[]>;
  getInstances(input: GetInstancesInput): Promise<GetInstancesResult>;
  getUpcomingWakes(input: GetUpcomingWakesInput): Promise<ProcessWakeRow[]>;
  findInstanceDetail(input: FindInstanceDetailInput): Promise<ProcessInstanceDetail | null>;
  getOutbox(input: GetOutboxInput): Promise<GetOutboxResult>;
  listRecentActions(input: ListRecentActionsInput): Promise<ProcessAuditEntryView[]>;
  wakeNow(input: WakeNowInput): Promise<WakeNowResult>;
  redriveDeadInstance(input: RedriveDeadInstanceInput): Promise<RedriveDeadInstanceResult>;
  redriveDeadMessage(input: RedriveDeadMessageInput): Promise<RedriveDeadMessageResult>;
  discardDeadMessage(input: DiscardDeadMessageInput): Promise<DiscardDeadMessageResult>;
  redriveDeadLetters(input: RedriveDeadLettersInput): Promise<RedriveDeadLettersResult>;
  discardDeadLetters(input: DiscardDeadLettersInput): Promise<DiscardDeadLettersResult>;
  getOutboxAttempts(input: GetOutboxAttemptsInput): Promise<OutboxAttemptView[]>;
  releaseLapsedLease(input: ReleaseLapsedLeaseInput): Promise<ReleaseLapsedLeaseResult>;
  getHistory(): Promise<ReplayHistoryEntry[]>;
  findHistoryEntry(input: FindHistoryEntryInput): Promise<ReplayHistoryEntry | null>;
  startReplay(input: StartReplayInput): Promise<StartReplayResult>;
  getStatus(): Promise<ReplayStatus>;
  cancelReplay(): Promise<CancelReplayResult>;
  listAnomalies(): Promise<Anomaly[]>;
  dismissAnomaly(input: { tenantId: string; kind: AnomalyKind }): Promise<boolean>;

  // -- Settings, Checkup of a self-hosted install; LangWatch Cloud answers
  // `{ deployment: "saas" }` (specs/self-hosting/checkup/checkup.feature) ---

  /** The free checks, which are what the page opens with. */
  getCheckup(input: { organizationId: string }): Promise<CheckupAnswer>;
  /** The checks that cost egress or money, run because someone asked. */
  runCheckup(
    input: { organizationId: string; requestedBy?: string } & ExplicitCheckInput,
  ): Promise<CheckupAnswer>;
  /** The exact report the install would send right now. */
  getUsageReport(input: { organizationId: string }): Promise<UsageReportAnswer>;
  setUsageReportSwitches(input: {
    organizationId: string;
    optionalMetricsOptOut?: boolean;
    hostnameOptOut?: boolean;
  }): Promise<UsageReportAnswer>;
  getStartupNotice(input: { organizationId: string }): Promise<StartupNoticeState>;
  /** What `langwatch doctor` reads over a project key: the free checks and the report. */
  getProjectCheckup(input: { projectId: string }): Promise<ProjectCheckupReport>;
  /** The paid checks over a project key; refused on LangWatch Cloud. */
  runProjectCheckup(input: { projectId: string } & ExplicitCheckInput): Promise<CheckupResult>;
  dismissStartupNotice(input: {
    organizationId: string;
    schemaVersion: number;
  }): Promise<{ dismissed: boolean }>;
}

export const OpsApi = moduleApi<OpsApi>()("ops");
