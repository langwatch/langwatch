import {
  OpsService as OpsServiceContract,
  type AdminIdentity,
  type DeleteBlobInput,
  type DeleteBlobResult,
  type GetBlobInput,
  type ListBlobsInput,
  type OpsBlobPage,
  type OpsBlobSummary,
  type OpsBlobStoreStats,
  type BlobSweepReport,
  type RunBlobCleanupInput,
  type StartImpersonationInput,
  type StopImpersonationInput,
  type AdminOperationInput,
  type AdminOperationResult,
  type ListPausedSchedulesInput,
  type ListScheduledJobsInput,
  type ListSchedulerActionsInput,
  type OpsScheduledJob,
  type ScheduleControlInput,
  type SchedulerAuditEntryView,
  type SetScheduleActiveInput,
  type Anomaly,
  type AnomalyKind,
  type GroupInfo,
  type OpsBlockedSummary,
  type OpsParkedGroupsPage,
  type OpsParkedTenantsPage,
  type OpsQueueDlqGroup,
  type OpsQueueDlqGroupWithQueue,
  type OpsQueueDrainPreview,
  type OpsQueueGroupsPage,
  type OpsQueueJobsPage,
  type OpsQueueReconcileResult,
  type QueueInfo,
  type QueueSummaryInfo,
} from "@langwatch/ops-contract";
import type { AdminAccess } from "./admin-access.service";
import type { AdminBackofficeService } from "./admin-backoffice.service";
import type { ImpersonationService } from "./impersonation.service";
import type { BlobStoreService } from "./blob-store.service";
import type { SchedulerOpsService } from "./scheduler-ops.service";
import type { AnomalyStatePort } from "../ports/anomaly-state.port";
import type { QueueService } from "./queue.service";

export class OpsService extends OpsServiceContract {
  private constructor(
    private readonly access: AdminAccess,
    private readonly impersonation: ImpersonationService,
    private readonly adminBackoffice: AdminBackofficeService,
    private readonly blobStore: BlobStoreService,
    private readonly scheduler: SchedulerOpsService,
    private readonly anomalyState: AnomalyStatePort | null,
    private readonly queues: QueueService,
  ) {
    super();
  }

  static create(options: {
    access: AdminAccess;
    impersonation: ImpersonationService;
    adminBackoffice: AdminBackofficeService;
    blobStore: BlobStoreService;
    scheduler: SchedulerOpsService;
    anomalyState: AnomalyStatePort | null;
    queues: QueueService;
  }): OpsService {
    return new OpsService(
      options.access,
      options.impersonation,
      options.adminBackoffice,
      options.blobStore,
      options.scheduler,
      options.anomalyState,
      options.queues,
    );
  }

  isAdmin(identity: AdminIdentity): boolean {
    return this.access.isAdmin(identity);
  }

  startImpersonation(input: StartImpersonationInput): Promise<void> {
    return this.impersonation.start(input);
  }

  stopImpersonation(input: StopImpersonationInput): Promise<void> {
    return this.impersonation.stop(input);
  }

  adminOperation(input: AdminOperationInput): Promise<AdminOperationResult> {
    return this.adminBackoffice.execute(input);
  }

  listBlobQueues(): Promise<string[]> {
    return this.blobStore.getQueueNames();
  }

  getBlobStoreStats(): Promise<OpsBlobStoreStats> {
    return this.blobStore.getStats();
  }

  listBlobs(input: ListBlobsInput): Promise<OpsBlobPage> {
    return this.blobStore.getBlobs(input);
  }

  tryGetBlob(input: GetBlobInput): Promise<OpsBlobSummary | null> {
    return this.blobStore.tryGetBlobById(input);
  }

  runBlobCleanup(input: RunBlobCleanupInput): Promise<BlobSweepReport> {
    return this.blobStore.runCleanup({
      dryRun: input.dryRun ?? true,
      requestedBy: input.requestedBy,
    });
  }

  deleteBlob(input: DeleteBlobInput): Promise<DeleteBlobResult> {
    return this.blobStore.deleteBlob(input);
  }

  async listAnomalies(): Promise<Anomaly[]> {
    if (!this.anomalyState) {
      return [];
    }

    const anomalies = await this.anomalyState.list();
    return anomalies.sort((left, right) => {
      if (left.tier !== right.tier) {
        return left.tier === "hard" ? -1 : 1;
      }

      return right.triggeredAt - left.triggeredAt;
    });
  }

  async dismissAnomaly(input: { tenantId: string; kind: AnomalyKind }): Promise<boolean> {
    if (!this.anomalyState) {
      return false;
    }

    await this.anomalyState.clear(input.tenantId, input.kind);
    return true;
  }

  listScheduledJobs(input: ListScheduledJobsInput): Promise<OpsScheduledJob[]> {
    return this.scheduler.listScheduledJobs(input);
  }

  listPausedSchedules(
    input: ListPausedSchedulesInput,
  ): Promise<{ schedules: OpsScheduledJob[]; total: number }> {
    return this.scheduler.listPausedSchedules(input);
  }

  listSchedulerActions(
    input: ListSchedulerActionsInput,
  ): Promise<SchedulerAuditEntryView[]> {
    return this.scheduler.listRecentActions(input);
  }

  setScheduleActive(input: SetScheduleActiveInput): Promise<OpsScheduledJob> {
    return this.scheduler.setActive(input);
  }

  clearStuckScheduleSlot(input: ScheduleControlInput): Promise<OpsScheduledJob> {
    return this.scheduler.clearStuckSlot(input);
  }

  runScheduleNow(input: ScheduleControlInput): Promise<OpsScheduledJob> {
    return this.scheduler.runNow(input);
  }

  listQueues(): Promise<QueueSummaryInfo[]> {
    return this.queues.getQueues();
  }

  listQueueGroups(input: {
    queueName: string;
    page: number;
    pageSize: number;
  }): Promise<OpsQueueGroupsPage> {
    return this.queues.getGroups(input);
  }

  tryGetQueueGroup(input: {
    queueName: string;
    groupId: string;
  }): Promise<GroupInfo | null> {
    return this.queues.tryGetGroupDetail(input);
  }

  listQueueGroupJobs(input: {
    queueName: string;
    groupId: string;
    page: number;
    pageSize: number;
  }): Promise<OpsQueueJobsPage> {
    return this.queues.getGroupJobs(input);
  }

  getBlockedQueueSummary(): Promise<OpsBlockedSummary> {
    return this.queues.getBlockedSummary();
  }

  listParkedQueueGroups(input: {
    queueName: string;
    tenantId: string;
    page: number;
    pageSize: number;
  }): Promise<OpsParkedGroupsPage> {
    return this.queues.getParkedGroups(input);
  }

  listAllQueueDlqGroups(): Promise<OpsQueueDlqGroupWithQueue[]> {
    return this.queues.getAllDlqGroups();
  }

  unblockQueueGroup(input: {
    queueName: string;
    groupId: string;
  }): Promise<{ wasBlocked: boolean }> {
    return this.queues.unblockGroup(input);
  }

  unblockAllQueueGroups(input: {
    queueName: string;
  }): Promise<{ unblockedCount: number }> {
    return this.queues.unblockAll(input);
  }

  drainQueueGroup(input: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsRemoved: number }> {
    return this.queues.drainGroup(input);
  }

  pauseQueuePipeline(input: { queueName: string; key: string }): Promise<void> {
    return this.queues.pausePipeline(input);
  }

  unpauseQueuePipeline(input: { queueName: string; key: string }): Promise<void> {
    return this.queues.unpausePipeline(input);
  }

  retryBlockedQueueJob(input: {
    queueName: string;
    groupId: string;
    jobId: string;
  }): Promise<{ wasBlocked: boolean }> {
    return this.queues.retryBlocked(input);
  }

  listPausedQueueKeys(input: { queueName: string }): Promise<string[]> {
    return this.queues.listPausedKeys(input);
  }

  pauseQueueTenant(input: { queueName: string; tenantId: string }): Promise<void> {
    return this.queues.pauseTenant(input);
  }

  unpauseQueueTenant(input: { queueName: string; tenantId: string }): Promise<void> {
    return this.queues.unpauseTenant(input);
  }

  listPausedQueueTenants(input: { queueName: string }): Promise<string[]> {
    return this.queues.listPausedTenants(input);
  }

  drainQueueTenant(input: {
    queueName: string;
    tenantId: string;
    groupIdContains?: string;
  }): Promise<{ groupsDrained: number; jobsDrained: number }> {
    return this.queues.drainTenant(input);
  }

  moveQueueGroupToDlq(input: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsMoved: number }> {
    return this.queues.moveToDlq(input);
  }

  moveAllBlockedQueueGroupsToDlq(input: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ movedCount: number; jobsMoved: number }> {
    return this.queues.moveAllBlockedToDlq(input);
  }

  replayQueueGroupFromDlq(input: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsReplayed: number }> {
    return this.queues.replayFromDlq(input);
  }

  replayAllQueueGroupsFromDlq(input: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ replayedCount: number; jobsReplayed: number }> {
    return this.queues.replayAllFromDlq(input);
  }

  redriveQueueDlqGroups(input: {
    queueName: string;
    groupIds: string[];
    requestedBy: string;
  }): Promise<{ redrivenCount: number; jobsRedriven: number }> {
    return this.queues.redriveManyFromDlq(input);
  }

  discardQueueDlqGroups(input: {
    queueName: string;
    groupIds: string[];
    requestedBy: string;
  }): Promise<{ discardedCount: number; jobsDiscarded: number }> {
    return this.queues.discardManyFromDlq(input);
  }

  canaryRedriveQueueDlq(input: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ redrivenCount: number; groupIds: string[] }> {
    return this.queues.canaryRedrive(input);
  }

  canaryUnblockQueueGroups(input: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ unblockedCount: number; groupIds: string[] }> {
    return this.queues.canaryUnblock(input);
  }

  listQueueDlqGroups(input: { queueName: string }): Promise<OpsQueueDlqGroup[]> {
    return this.queues.listDlqGroups(input);
  }

  getQueueDrainPreview(input: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<OpsQueueDrainPreview> {
    return this.queues.getDrainPreview(input);
  }

  discoverQueueNames(): Promise<string[]> {
    return this.queues.discoverQueueNames();
  }

  scanQueues(input: { queueNames: string[] }): Promise<QueueInfo[]> {
    return this.queues.scanQueues(input);
  }

  tryReconcileQueuePending(input: {
    queueName: string;
  }): Promise<OpsQueueReconcileResult | null> {
    return this.queues.tryReconcilePending(input);
  }

  readQueuePendingDrift(input: { queueNames: string[] }): Promise<number> {
    return this.queues.readPublishedPendingDrift(input);
  }

  listParkedQueueTenants(input: {
    queueNames: string[];
    maxTenants: number;
  }): Promise<OpsParkedTenantsPage> {
    return this.queues.listParkedTenants(input);
  }
}
