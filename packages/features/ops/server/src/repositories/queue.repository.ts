// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

import type {
  OpsBlockedSummary,
  OpsParkedTenantsPage,
  OpsQueueDlqGroup,
  OpsQueueDrainPreview,
  OpsQueueJob,
  OpsQueueReconcileResult,
  ParkedGroupInfo,
  QueueInfo,
} from "@langwatch/ops-contract";

/**
 * Every tenant currently over its in-flight cap, plus how many exist.
 *
 * `total` is the honest count even when `tenants` is capped, so a caller can
 * say "showing N of M" rather than presenting a bounded list as complete.
 */
export type ParkedTenantsPage = OpsParkedTenantsPage;
export type BlockedSummary = OpsBlockedSummary;
export type DlqGroupInfo = OpsQueueDlqGroup;
export type DrainPreview = OpsQueueDrainPreview;
export type JobEntry = OpsQueueJob;
export type ReconcileResult = OpsQueueReconcileResult;

export abstract class QueueRepository {
  abstract discoverQueueNames(): Promise<string[]>;

  abstract scanQueues(params: { queueNames: string[]; topN?: number }): Promise<QueueInfo[]>;

  abstract getGroupJobs(params: {
    queueName: string;
    groupId: string;
    page: number;
    pageSize: number;
  }): Promise<{ jobs: JobEntry[]; total: number }>;

  abstract getBlockedSummary(params: { queueNames: string[] }): Promise<BlockedSummary>;

  /**
   * Enumerate tenants parked over their in-flight cap, deepest first.
   *
   * The registry of over-cap tenants is naturally tiny (one entry per tenant,
   * not per group), so this stays cheap even when the parked DEPTH is in the
   * hundreds of thousands — which is exactly the case the dashboard has to
   * explain. Bounded by `maxTenants`; the reported `total` is unbounded.
   */
  abstract enumerateParkedTenants(params: {
    queueNames: string[];
    maxTenants: number;
  }): Promise<ParkedTenantsPage>;

  /**
   * One parked tenant's groups, ordered by dispatch eligibility.
   *
   * Deliberately request-time rather than snapshot-carried: a parking storm
   * can hold hundreds of thousands of groups, and shipping those in a snapshot
   * every pod reads would recreate the size problem ADR-090 removes.
   */
  abstract listParkedGroups(params: {
    queueName: string;
    tenantId: string;
    page: number;
    pageSize: number;
  }): Promise<{ groups: ParkedGroupInfo[]; total: number }>;

  abstract unblockGroup(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ wasBlocked: boolean }>;

  abstract unblockAll(params: { queueName: string }): Promise<{ unblockedCount: number }>;

  abstract drainGroup(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsRemoved: number }>;

  abstract pausePipeline(params: { queueName: string; key: string }): Promise<void>;

  abstract unpausePipeline(params: { queueName: string; key: string }): Promise<void>;

  abstract retryBlocked(params: {
    queueName: string;
    groupId: string;
    jobId: string;
  }): Promise<{ wasBlocked: boolean }>;

  abstract listPausedKeys(params: { queueName: string }): Promise<string[]>;

  abstract pauseTenant(params: { queueName: string; tenantId: string }): Promise<void>;

  abstract unpauseTenant(params: { queueName: string; tenantId: string }): Promise<void>;

  abstract listPausedTenants(params: { queueName: string }): Promise<string[]>;

  abstract drainTenant(params: {
    queueName: string;
    tenantId: string;
    groupIdContains?: string;
  }): Promise<{ groupsDrained: number; jobsDrained: number }>;

  abstract moveToDlq(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsMoved: number }>;

  abstract moveAllBlockedToDlq(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ movedCount: number; jobsMoved: number }>;

  abstract replayFromDlq(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsReplayed: number }>;

  abstract replayAllFromDlq(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ replayedCount: number; jobsReplayed: number }>;

  /** Redrive an explicit set of DLQ groups — the operator's shown set. */
  abstract redriveManyFromDlq(params: {
    queueName: string;
    groupIds: string[];
  }): Promise<{ redrivenCount: number; jobsRedriven: number }>;

  /**
   * Discard an explicit set of DLQ groups: their jobs never run again.
   * Returns what the audit row must record — counts and an error sample.
   */
  abstract discardManyFromDlq(params: { queueName: string; groupIds: string[] }): Promise<{
    discardedCount: number;
    jobsDiscarded: number;
    lastErrors: string[];
  }>;

  abstract canaryRedrive(params: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ redrivenCount: number; groupIds: string[] }>;

  abstract canaryUnblock(params: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ unblockedCount: number; groupIds: string[] }>;

  abstract listDlqGroups(params: { queueName: string }): Promise<DlqGroupInfo[]>;

  abstract drainAllBlockedPreview(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<DrainPreview>;

  abstract tryReconcileTotalPending(queueName: string): Promise<ReconcileResult | null>;

  /**
   * The drift the most recent reconcile pass published for each named queue,
   * summed as absolute values.
   *
   * Every instance reads this, including the ones that won no marker and so
   * computed nothing themselves. `null` for a queue with no live figure (never
   * reconciled, or the last one has aged out) is skipped rather than counted as
   * zero, so a queue that has stopped reconciling does not read as healthy.
   */
  abstract readPublishedPendingDrift(queueNames: string[]): Promise<number>;
}

export class NullQueueRepository extends QueueRepository {
  static create(): NullQueueRepository {
    return new NullQueueRepository();
  }

  private constructor() {
    super();
  }

  async discoverQueueNames(): Promise<string[]> {
    return [];
  }

  async scanQueues(): Promise<QueueInfo[]> {
    return [];
  }

  async getGroupJobs(): Promise<{ jobs: JobEntry[]; total: number }> {
    return { jobs: [], total: 0 };
  }

  async getBlockedSummary(): Promise<BlockedSummary> {
    return { totalBlocked: 0, clusters: [] };
  }

  async enumerateParkedTenants(): Promise<ParkedTenantsPage> {
    return { tenants: [], total: 0 };
  }

  async listParkedGroups(): Promise<{
    groups: ParkedGroupInfo[];
    total: number;
  }> {
    return { groups: [], total: 0 };
  }

  async unblockGroup(): Promise<{ wasBlocked: boolean }> {
    return { wasBlocked: false };
  }

  async unblockAll(): Promise<{ unblockedCount: number }> {
    return { unblockedCount: 0 };
  }

  async drainGroup(): Promise<{ jobsRemoved: number }> {
    return { jobsRemoved: 0 };
  }

  async pausePipeline(): Promise<void> {}

  async unpausePipeline(): Promise<void> {}

  async retryBlocked(): Promise<{ wasBlocked: boolean }> {
    return { wasBlocked: false };
  }

  async listPausedKeys(): Promise<string[]> {
    return [];
  }

  async pauseTenant(): Promise<void> {}

  async unpauseTenant(): Promise<void> {}

  async listPausedTenants(): Promise<string[]> {
    return [];
  }

  async drainTenant(): Promise<{ groupsDrained: number; jobsDrained: number }> {
    return { groupsDrained: 0, jobsDrained: 0 };
  }

  async moveToDlq(): Promise<{ jobsMoved: number }> {
    return { jobsMoved: 0 };
  }

  async moveAllBlockedToDlq(): Promise<{
    movedCount: number;
    jobsMoved: number;
  }> {
    return { movedCount: 0, jobsMoved: 0 };
  }

  async replayFromDlq(): Promise<{ jobsReplayed: number }> {
    return { jobsReplayed: 0 };
  }

  async replayAllFromDlq(): Promise<{
    replayedCount: number;
    jobsReplayed: number;
  }> {
    return { replayedCount: 0, jobsReplayed: 0 };
  }

  async redriveManyFromDlq(): Promise<{
    redrivenCount: number;
    jobsRedriven: number;
  }> {
    return { redrivenCount: 0, jobsRedriven: 0 };
  }

  async discardManyFromDlq(): Promise<{
    discardedCount: number;
    jobsDiscarded: number;
    lastErrors: string[];
  }> {
    return { discardedCount: 0, jobsDiscarded: 0, lastErrors: [] };
  }

  async canaryRedrive(): Promise<{
    redrivenCount: number;
    groupIds: string[];
  }> {
    return { redrivenCount: 0, groupIds: [] };
  }

  async canaryUnblock(): Promise<{
    unblockedCount: number;
    groupIds: string[];
  }> {
    return { unblockedCount: 0, groupIds: [] };
  }

  async listDlqGroups(): Promise<DlqGroupInfo[]> {
    return [];
  }

  async drainAllBlockedPreview(): Promise<DrainPreview> {
    return { totalAffected: 0, byPipeline: [], byError: [] };
  }

  async tryReconcileTotalPending(): Promise<ReconcileResult | null> {
    return null;
  }

  async readPublishedPendingDrift(): Promise<number> {
    return 0;
  }
}
