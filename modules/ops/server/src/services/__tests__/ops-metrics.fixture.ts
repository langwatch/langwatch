import {
  OpsService,
  type OpsBlockedSummary,
  type OpsParkedTenantsPage,
  type OpsQueueReconcileResult,
  type QueueInfo,
} from "@langwatch/ops-contract";

/** Complete in-memory Ops service used only by the app metrics collector tests. */
export class OpsMetricsTestAdapter extends OpsService {
  private queueNames: string[] = [];
  private queues: QueueInfo[] = [];
  private pendingReconciliations: Array<OpsQueueReconcileResult | null> = [];
  private pendingDrift = 0;
  private scanCalls = 0;

  private constructor() {
    super();
  }

  static create(): OpsMetricsTestAdapter {
    return new OpsMetricsTestAdapter();
  }

  setQueueNames(queueNames: string[]): void {
    this.queueNames = queueNames;
  }

  setQueues(queues: QueueInfo[]): void {
    this.queues = queues;
  }

  enqueuePendingReconciliations(results: Array<OpsQueueReconcileResult | null>): void {
    this.pendingReconciliations.push(...results);
  }

  setPendingDrift(pendingDrift: number): void {
    this.pendingDrift = pendingDrift;
  }

  getScanCalls(): number {
    return this.scanCalls;
  }

  private unavailable(): never {
    throw new Error("This OpsService capability is not used by metrics collector tests");
  }

  isAdmin(): boolean {
    return false;
  }

  startImpersonation(): never {
    return this.unavailable();
  }

  stopImpersonation(): never {
    return this.unavailable();
  }

  adminOperation(): never {
    return this.unavailable();
  }

  listBlobQueues(): never {
    return this.unavailable();
  }

  getBlobStoreStats(): never {
    return this.unavailable();
  }

  listBlobs(): never {
    return this.unavailable();
  }

  tryGetBlob(): never {
    return this.unavailable();
  }

  runBlobCleanup(): never {
    return this.unavailable();
  }

  deleteBlob(): never {
    return this.unavailable();
  }

  listAnomalies(): never {
    return this.unavailable();
  }

  dismissAnomaly(): never {
    return this.unavailable();
  }

  listScheduledJobs(): never {
    return this.unavailable();
  }

  listPausedSchedules(): never {
    return this.unavailable();
  }

  listSchedulerActions(): never {
    return this.unavailable();
  }

  setScheduleActive(): never {
    return this.unavailable();
  }

  clearStuckScheduleSlot(): never {
    return this.unavailable();
  }

  runScheduleNow(): never {
    return this.unavailable();
  }

  listQueues(): never {
    return this.unavailable();
  }

  listQueueGroups(): never {
    return this.unavailable();
  }

  tryGetQueueGroup(): never {
    return this.unavailable();
  }

  listQueueGroupJobs(): never {
    return this.unavailable();
  }

  async getBlockedQueueSummary(): Promise<OpsBlockedSummary> {
    return { totalBlocked: 0, clusters: [] };
  }

  listParkedQueueGroups(): never {
    return this.unavailable();
  }

  listAllQueueDlqGroups(): never {
    return this.unavailable();
  }

  unblockQueueGroup(): never {
    return this.unavailable();
  }

  unblockAllQueueGroups(): never {
    return this.unavailable();
  }

  drainQueueGroup(): never {
    return this.unavailable();
  }

  pauseQueuePipeline(): never {
    return this.unavailable();
  }

  unpauseQueuePipeline(): never {
    return this.unavailable();
  }

  retryBlockedQueueJob(): never {
    return this.unavailable();
  }

  listPausedQueueKeys(): never {
    return this.unavailable();
  }

  pauseQueueTenant(): never {
    return this.unavailable();
  }

  unpauseQueueTenant(): never {
    return this.unavailable();
  }

  listPausedQueueTenants(): never {
    return this.unavailable();
  }

  drainQueueTenant(): never {
    return this.unavailable();
  }

  moveQueueGroupToDlq(): never {
    return this.unavailable();
  }

  moveAllBlockedQueueGroupsToDlq(): never {
    return this.unavailable();
  }

  replayQueueGroupFromDlq(): never {
    return this.unavailable();
  }

  replayAllQueueGroupsFromDlq(): never {
    return this.unavailable();
  }

  redriveQueueDlqGroups(): never {
    return this.unavailable();
  }

  discardQueueDlqGroups(): never {
    return this.unavailable();
  }

  canaryRedriveQueueDlq(): never {
    return this.unavailable();
  }

  canaryUnblockQueueGroups(): never {
    return this.unavailable();
  }

  listQueueDlqGroups(): never {
    return this.unavailable();
  }

  getQueueDrainPreview(): never {
    return this.unavailable();
  }

  async discoverQueueNames(): Promise<string[]> {
    return this.queueNames;
  }

  async scanQueues(): Promise<QueueInfo[]> {
    this.scanCalls += 1;
    return this.queues;
  }

  async tryReconcileQueuePending(): Promise<OpsQueueReconcileResult | null> {
    return this.pendingReconciliations.shift() ?? null;
  }

  async readQueuePendingDrift(): Promise<number> {
    return this.pendingDrift;
  }

  async listParkedQueueTenants(): Promise<OpsParkedTenantsPage> {
    return { tenants: [], total: 0 };
  }
}
