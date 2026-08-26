import type {
  AdminIdentity,
  StartImpersonationInput,
  StopImpersonationInput,
} from "./admin";
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
} from "./blob-store";
import type { AdminOperationInput, AdminOperationResult } from "./admin-backoffice";
import type {
  ListPausedSchedulesInput,
  ListScheduledJobsInput,
  ListSchedulerActionsInput,
  OpsScheduledJob,
  ScheduleControlInput,
  SchedulerAuditEntryView,
  SetScheduleActiveInput,
} from "./ops-scheduler";
import type { Anomaly, AnomalyKind } from "./ops-anomaly";
import type {
  GroupInfo,
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
} from "./ops-queue";

/** The single portable capability for platform operations and backoffice work. */
export abstract class OpsService {
  abstract isAdmin(identity: AdminIdentity): boolean;
  abstract startImpersonation(input: StartImpersonationInput): Promise<void>;
  abstract stopImpersonation(input: StopImpersonationInput): Promise<void>;
  abstract adminOperation(input: AdminOperationInput): Promise<AdminOperationResult>;
  abstract listBlobQueues(): Promise<string[]>;
  abstract getBlobStoreStats(): Promise<OpsBlobStoreStats>;
  abstract listBlobs(input: ListBlobsInput): Promise<OpsBlobPage>;
  abstract tryGetBlob(input: GetBlobInput): Promise<OpsBlobSummary | null>;
  abstract runBlobCleanup(input: RunBlobCleanupInput): Promise<BlobSweepReport>;
  abstract deleteBlob(input: DeleteBlobInput): Promise<DeleteBlobResult>;
  abstract listAnomalies(): Promise<Anomaly[]>;
  abstract dismissAnomaly(input: {
    tenantId: string;
    kind: AnomalyKind;
  }): Promise<boolean>;
  abstract listScheduledJobs(input: ListScheduledJobsInput): Promise<OpsScheduledJob[]>;
  abstract listPausedSchedules(
    input: ListPausedSchedulesInput,
  ): Promise<{ schedules: OpsScheduledJob[]; total: number }>;
  abstract listSchedulerActions(
    input: ListSchedulerActionsInput,
  ): Promise<SchedulerAuditEntryView[]>;
  abstract setScheduleActive(input: SetScheduleActiveInput): Promise<OpsScheduledJob>;
  abstract clearStuckScheduleSlot(input: ScheduleControlInput): Promise<OpsScheduledJob>;
  abstract runScheduleNow(input: ScheduleControlInput): Promise<OpsScheduledJob>;
  abstract listQueues(): Promise<QueueSummaryInfo[]>;
  abstract listQueueGroups(input: {
    queueName: string;
    page: number;
    pageSize: number;
  }): Promise<OpsQueueGroupsPage>;
  abstract tryGetQueueGroup(input: {
    queueName: string;
    groupId: string;
  }): Promise<GroupInfo | null>;
  abstract listQueueGroupJobs(input: {
    queueName: string;
    groupId: string;
    page: number;
    pageSize: number;
  }): Promise<OpsQueueJobsPage>;
  abstract getBlockedQueueSummary(): Promise<OpsBlockedSummary>;
  abstract listParkedQueueGroups(input: {
    queueName: string;
    tenantId: string;
    page: number;
    pageSize: number;
  }): Promise<OpsParkedGroupsPage>;
  abstract listAllQueueDlqGroups(): Promise<OpsQueueDlqGroupWithQueue[]>;
  abstract unblockQueueGroup(input: {
    queueName: string;
    groupId: string;
  }): Promise<{ wasBlocked: boolean }>;
  abstract unblockAllQueueGroups(input: {
    queueName: string;
  }): Promise<{ unblockedCount: number }>;
  abstract drainQueueGroup(input: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsRemoved: number }>;
  abstract pauseQueuePipeline(input: { queueName: string; key: string }): Promise<void>;
  abstract unpauseQueuePipeline(input: { queueName: string; key: string }): Promise<void>;
  abstract retryBlockedQueueJob(input: {
    queueName: string;
    groupId: string;
    jobId: string;
  }): Promise<{ wasBlocked: boolean }>;
  abstract listPausedQueueKeys(input: { queueName: string }): Promise<string[]>;
  abstract pauseQueueTenant(input: {
    queueName: string;
    tenantId: string;
  }): Promise<void>;
  abstract unpauseQueueTenant(input: {
    queueName: string;
    tenantId: string;
  }): Promise<void>;
  abstract listPausedQueueTenants(input: { queueName: string }): Promise<string[]>;
  abstract drainQueueTenant(input: {
    queueName: string;
    tenantId: string;
    groupIdContains?: string;
  }): Promise<{ groupsDrained: number; jobsDrained: number }>;
  abstract moveQueueGroupToDlq(input: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsMoved: number }>;
  abstract moveAllBlockedQueueGroupsToDlq(input: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ movedCount: number; jobsMoved: number }>;
  abstract replayQueueGroupFromDlq(input: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsReplayed: number }>;
  abstract replayAllQueueGroupsFromDlq(input: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ replayedCount: number; jobsReplayed: number }>;
  abstract redriveQueueDlqGroups(input: {
    queueName: string;
    groupIds: string[];
    requestedBy: string;
  }): Promise<{ redrivenCount: number; jobsRedriven: number }>;
  abstract discardQueueDlqGroups(input: {
    queueName: string;
    groupIds: string[];
    requestedBy: string;
  }): Promise<{ discardedCount: number; jobsDiscarded: number }>;
  abstract canaryRedriveQueueDlq(input: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ redrivenCount: number; groupIds: string[] }>;
  abstract canaryUnblockQueueGroups(input: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ unblockedCount: number; groupIds: string[] }>;
  abstract listQueueDlqGroups(input: { queueName: string }): Promise<OpsQueueDlqGroup[]>;
  abstract getQueueDrainPreview(input: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<OpsQueueDrainPreview>;
  abstract discoverQueueNames(): Promise<string[]>;
  abstract scanQueues(input: { queueNames: string[] }): Promise<QueueInfo[]>;
  abstract tryReconcileQueuePending(input: {
    queueName: string;
  }): Promise<OpsQueueReconcileResult | null>;
  abstract readQueuePendingDrift(input: { queueNames: string[] }): Promise<number>;
  abstract listParkedQueueTenants(input: {
    queueNames: string[];
    maxTenants: number;
  }): Promise<OpsParkedTenantsPage>;
}
