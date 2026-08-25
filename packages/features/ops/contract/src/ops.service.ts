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
}
