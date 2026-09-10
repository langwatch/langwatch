import { moduleApi } from "@langwatch/runtime-composition";
import type { AdminIdentity } from "./admin.ts";
import type {
  BugReport,
  BugReportListing,
  ListBugReportsInput,
  SubmitBugReport,
} from "./ops-bug-report.ts";
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
import type {
  OpsMigrationCohortResult,
  OpsMigrationEnrollmentListing,
  OpsMigrationOrganizationMatch,
  OpsMigrationOverview,
  OpsMigrationTargetedRunResult,
} from "./ops-system-migration.ts";
import type { Anomaly, AnomalyKind } from "./ops-anomaly.ts";
import type { DashboardData, GroupInfo } from "./ops-dashboard.ts";
import type {
  FeatureFlagRules,
  OperatorFeatureFlagCatalogue,
} from "@langwatch/feature-flag-contract";
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
import type { ReplayHistoryEntry, ReplayStatus } from "./ops-replay.ts";
import type { StartImpersonationInput, StopImpersonationInput } from "./admin.ts";
import type { AdminOperationInput, AdminOperationResult } from "./admin-backoffice.ts";
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
import type {
  ListPausedSchedulesInput,
  ListScheduledJobsInput,
  ListSchedulerActionsInput,
  OpsScheduledJob,
  ScheduleControlInput,
  SchedulerAuditEntryView,
  SetScheduleActiveInput,
} from "./ops-scheduler.ts";
import type {
  OpsBlockedSummary,
  OpsParkedGroupsPage,
  OpsParkedTenantsPage,
  OpsQueueDlqGroup,
  OpsQueueDlqGroupWithQueue,
  OpsQueueDrainPreview,
  OpsQueueGroupsPage,
  OpsQueueJobsPage,
  OpsQueueReconcileResult,
  QueueInfo,
  QueueSummaryInfo,
} from "./ops-queue.ts";
import type { SearchProjectsResult } from "@langwatch/project-contract";

export interface OpsApi {
  startImpersonation(input: StartImpersonationInput): Promise<void>;
  stopImpersonation(input: StopImpersonationInput): Promise<void>;
  adminOperation(input: AdminOperationInput): Promise<AdminOperationResult>;
  listBlobQueues(): Promise<string[]>;
  getBlobStoreStats(): Promise<OpsBlobStoreStats>;
  listBlobs(input: ListBlobsInput): Promise<OpsBlobPage>;
  findBlob(input: GetBlobInput): Promise<OpsBlobSummary | null>;
  runBlobCleanup(input: RunBlobCleanupInput): Promise<BlobSweepReport>;
  deleteBlob(input: DeleteBlobInput): Promise<DeleteBlobResult>;
  listAnomalies(): Promise<Anomaly[]>;
  dismissAnomaly(input: { tenantId: string; kind: AnomalyKind }): Promise<boolean>;
  listScheduledJobs(input: ListScheduledJobsInput): Promise<OpsScheduledJob[]>;
  listPausedSchedules(
    input: ListPausedSchedulesInput,
  ): Promise<{ schedules: OpsScheduledJob[]; total: number }>;
  listSchedulerActions(input: ListSchedulerActionsInput): Promise<SchedulerAuditEntryView[]>;
  setScheduleActive(input: SetScheduleActiveInput): Promise<OpsScheduledJob>;
  clearStuckScheduleSlot(input: ScheduleControlInput): Promise<OpsScheduledJob>;
  runScheduleNow(input: ScheduleControlInput): Promise<OpsScheduledJob>;
  listQueues(): Promise<QueueSummaryInfo[]>;
  listQueueGroups(input: {
    queueName: string;
    page: number;
    pageSize: number;
  }): Promise<OpsQueueGroupsPage>;
  findQueueGroup(input: { queueName: string; groupId: string }): Promise<GroupInfo | null>;
  listQueueGroupJobs(input: {
    queueName: string;
    groupId: string;
    page: number;
    pageSize: number;
  }): Promise<OpsQueueJobsPage>;
  getBlockedQueueSummary(): Promise<OpsBlockedSummary>;
  listParkedQueueGroups(input: {
    queueName: string;
    tenantId: string;
    page: number;
    pageSize: number;
  }): Promise<OpsParkedGroupsPage>;
  listAllQueueDlqGroups(): Promise<OpsQueueDlqGroupWithQueue[]>;
  unblockQueueGroup(input: {
    queueName: string;
    groupId: string;
    requestedBy: string;
  }): Promise<{ wasBlocked: boolean }>;
  unblockAllQueueGroups(input: {
    queueName: string;
    requestedBy: string;
  }): Promise<{ unblockedCount: number }>;
  drainQueueGroup(input: {
    queueName: string;
    groupId: string;
    requestedBy: string;
  }): Promise<{ jobsRemoved: number }>;
  pauseQueuePipeline(input: { queueName: string; key: string }): Promise<void>;
  unpauseQueuePipeline(input: { queueName: string; key: string }): Promise<void>;
  retryBlockedQueueJob(input: {
    queueName: string;
    groupId: string;
    jobId: string;
  }): Promise<{ wasBlocked: boolean }>;
  listPausedQueueKeys(input: { queueName: string }): Promise<string[]>;
  pauseQueueTenant(input: { queueName: string; tenantId: string }): Promise<void>;
  unpauseQueueTenant(input: { queueName: string; tenantId: string }): Promise<void>;
  listPausedQueueTenants(input: { queueName: string }): Promise<string[]>;
  drainQueueTenant(input: {
    queueName: string;
    tenantId: string;
    groupIdContains?: string;
    requestedBy: string;
  }): Promise<{ groupsDrained: number; jobsDrained: number }>;
  moveQueueGroupToDlq(input: {
    queueName: string;
    groupId: string;
    requestedBy: string;
  }): Promise<{ jobsMoved: number }>;
  moveAllBlockedQueueGroupsToDlq(input: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
    requestedBy: string;
  }): Promise<{ movedCount: number; jobsMoved: number }>;
  replayQueueGroupFromDlq(input: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsReplayed: number }>;
  replayAllQueueGroupsFromDlq(input: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ replayedCount: number; jobsReplayed: number }>;
  redriveQueueDlqGroups(input: {
    queueName: string;
    groupIds: string[];
    requestedBy: string;
  }): Promise<{ redrivenCount: number; jobsRedriven: number }>;
  discardQueueDlqGroups(input: {
    queueName: string;
    groupIds: string[];
    requestedBy: string;
  }): Promise<{ discardedCount: number; jobsDiscarded: number }>;
  canaryRedriveQueueDlq(input: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ redrivenCount: number; groupIds: string[] }>;
  canaryUnblockQueueGroups(input: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ unblockedCount: number; groupIds: string[] }>;
  listQueueDlqGroups(input: { queueName: string }): Promise<OpsQueueDlqGroup[]>;
  getQueueDrainPreview(input: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<OpsQueueDrainPreview>;
  discoverQueueNames(): Promise<string[]>;
  scanQueues(input: { queueNames: string[] }): Promise<QueueInfo[]>;
  tryReconcileQueuePending(input: { queueName: string }): Promise<OpsQueueReconcileResult | null>;
  readQueuePendingDrift(input: { queueNames: string[] }): Promise<number>;
  listParkedQueueTenants(input: {
    queueNames: string[];
    maxTenants: number;
  }): Promise<OpsParkedTenantsPage>;
  isAdmin(identity: AdminIdentity): boolean;
  requireDestructiveOperator(operator: OpsOperator | null, confirmation: string | undefined): void;
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
   * carry reporter-submitted transcripts and contact addresses, so who opened
   * the inbox is itself worth keeping. The search TEXT never reaches the audit
   * row - a contact search is an email address, and audit rows outlive the
   * inbox.
   */
  listBugReports(input: ListBugReportsInput & { actorUserId: string }): Promise<BugReportListing>;
  /** One report in full, audited before it is answered. */
  getBugReport(input: { id: string; actorUserId: string }): Promise<BugReport>;
  /**
   * File one report from a customer's coding agent. Unauthenticated on
   * purpose: the reporter may be struggling because setup failed, so a report
   * must never require a working login. A project credential only enriches the
   * report with a project link.
   */
  submitBugReport(input: {
    report: SubmitBugReport;
    callerKey: string;
    apiToken?: string | undefined;
    projectIdHint?: string | null;
  }): Promise<{ id: string }>;
  findDashboardData(): DashboardData | null;
  badgeCounts(): { blockedCount: number; dlqCount: number; computedAt: Date | null };
  streamDashboard(input: { signal?: { readonly aborted: boolean } }): AsyncIterable<DashboardData>;
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
  discoverAggregates(input: {
    projectionNames: string[];
    since: string;
    tenantIds: string[];
  }): Promise<AggregateDiscovery>;
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
  getAggregateEvents(input: {
    aggregateId: string;
    tenantId: string;
    limit: number;
  }): Promise<AggregateEventView[]>;
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
  getDeadLetters(input: {
    processName?: string;
    page: number;
    pageSize: number;
  }): Promise<{ messages: DeadOutboxMessageView[]; total: number; byProcess: DeadLetterCount[] }>;
  getDeadLetterCounts(): Promise<DeadLetterCount[]>;
  getInstances(input: {
    processName?: string;
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ instances: ProcessInstanceRow[]; total: number }>;
  getUpcomingWakes(input: { limit: number }): Promise<ProcessWakeRow[]>;
  findInstanceDetail(input: {
    ref: { processName: string; projectId: string; processKey: string };
  }): Promise<ProcessInstanceDetail | null>;
  getOutbox(input: {
    ref: { processName: string; projectId: string; processKey: string };
    page: number;
    pageSize: number;
  }): Promise<{ messages: ProcessOutboxMessageView[]; total: number }>;
  listRecentActions(input: { limit: number }): Promise<ProcessAuditEntryView[]>;
  wakeNow(input: {
    ref: { processName: string; projectId: string; processKey: string };
    actorUserId: string;
  }): Promise<{ woke: boolean }>;
  redriveDeadInstance(input: {
    ref: { processName: string; projectId: string; processKey: string };
    actorUserId: string;
  }): Promise<{ requeued: number }>;
  redriveDeadMessage(input: {
    ref: { processName: string; projectId: string; processKey: string };
    messageId: string;
    actorUserId: string;
  }): Promise<{ redriven: boolean }>;
  discardDeadMessage(input: {
    ref: { processName: string; projectId: string; processKey: string };
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
    ref: { processName: string; projectId: string; processKey: string };
    messageId: string;
    actorUserId: string;
  }): Promise<{ released: boolean }>;
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
  listAnomalies(): Promise<Anomaly[]>;
  dismissAnomaly(input: { tenantId: string; kind: AnomalyKind }): Promise<boolean>;
}

export const OpsApi = moduleApi<OpsApi>("ops");
