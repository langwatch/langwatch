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
} from "@langwatch/ops-contract";
import type { AdminAccess } from "./admin-access.service";
import type { AdminBackofficeService } from "./admin-backoffice.service";
import type { ImpersonationService } from "./impersonation.service";
import type { BlobStoreService } from "./blob-store.service";
import type { SchedulerOpsService } from "./scheduler-ops.service";
import type { AnomalyStatePort } from "../ports/anomaly-state.port";

export class OpsService extends OpsServiceContract {
  private constructor(
    private readonly access: AdminAccess,
    private readonly impersonation: ImpersonationService,
    private readonly adminBackoffice: AdminBackofficeService,
    private readonly blobStore: BlobStoreService,
    private readonly scheduler: SchedulerOpsService,
    private readonly anomalyState: AnomalyStatePort | null,
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
  }): OpsService {
    return new OpsService(
      options.access,
      options.impersonation,
      options.adminBackoffice,
      options.blobStore,
      options.scheduler,
      options.anomalyState,
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
}
