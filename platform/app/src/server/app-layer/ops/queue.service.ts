import type {
  GroupInfo,
  ParkedGroupInfo,
  QueueSummaryInfo,
} from "@langwatch/ops-contract";
import { NullQueueAuditSink, type QueueAuditSink } from "./queue-audit.repository";
import type {
  BlockedSummary,
  DlqGroupInfo,
  DrainPreview,
  JobEntry,
  QueueRepository,
} from "./repositories/queue.repository";

/** What an error with no recognizable class name is recorded as. */
const UNTYPED_ERROR_SHAPE = "untyped_error";

/**
 * Reduce raw job errors to something safe to keep in a durable audit row.
 *
 * Only a leading error CLASS survives — `TimeoutError`, `HttpError`. Anything
 * else becomes a fixed placeholder, because a job's error text is arbitrary
 * and its first words are no safer than its last: `"alice@example.com payment
 * failed"` leads with the address. Enough for an operator to see "these all
 * died the same way" and no more; the full message stays on the failing job.
 */
function summarizeErrorShapes(messages: string[]): string[] {
  const shapes = new Set<string>();
  for (const message of messages) {
    const named = /^([A-Za-z][A-Za-z0-9_]*(?:Error|Exception))\b/.exec(message);
    shapes.add(named?.[1]?.slice(0, 80) ?? UNTYPED_ERROR_SHAPE);
    if (shapes.size >= 5) break;
  }
  return [...shapes];
}

export class QueueService {
  readonly repo: QueueRepository;
  private readonly audit: QueueAuditSink;

  constructor(params: { repo: QueueRepository; audit?: QueueAuditSink }) {
    this.repo = params.repo;
    this.audit = params.audit ?? new NullQueueAuditSink();
  }

  async getQueues(): Promise<QueueSummaryInfo[]> {
    const queueNames = await this.repo.discoverQueueNames();
    const queues = await this.repo.scanQueues({ queueNames });
    return queues.map(({ groups: _groups, ...summary }) => summary);
  }

  async getGroups(params: {
    queueName: string;
    page: number;
    pageSize: number;
  }): Promise<{
    groups: GroupInfo[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const queues = await this.repo.scanQueues({
      queueNames: [params.queueName],
    });
    const queue = queues[0];
    if (!queue) {
      return {
        groups: [],
        total: 0,
        page: params.page,
        pageSize: params.pageSize,
      };
    }

    // Groups are loaded in full then sliced — acceptable for typical queue
    // sizes but would need server-side pagination if group counts grow large.
    const start = (params.page - 1) * params.pageSize;
    const end = start + params.pageSize;
    const paginatedGroups = queue.groups.slice(start, end);

    return {
      groups: paginatedGroups,
      total: queue.groups.length,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async getGroupDetail(params: {
    queueName: string;
    groupId: string;
  }): Promise<GroupInfo | null> {
    const queues = await this.repo.scanQueues({
      queueNames: [params.queueName],
    });
    const queue = queues[0];
    if (!queue) return null;

    return queue.groups.find((g) => g.groupId === params.groupId) ?? null;
  }

  async getGroupJobs(params: {
    queueName: string;
    groupId: string;
    page: number;
    pageSize: number;
  }): Promise<{
    jobs: JobEntry[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const result = await this.repo.getGroupJobs(params);
    return {
      ...result,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async getBlockedSummary(): Promise<BlockedSummary> {
    const queueNames = await this.repo.discoverQueueNames();
    return this.repo.getBlockedSummary({ queueNames });
  }

  /**
   * One parked tenant's groups. Read at request time so an operator acting on
   * a row is acting on current state, not on a snapshot cycle's worth of past.
   */
  async getParkedGroups(params: {
    queueName: string;
    tenantId: string;
    page: number;
    pageSize: number;
  }): Promise<{
    groups: ParkedGroupInfo[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const result = await this.repo.listParkedGroups(params);
    return { ...result, page: params.page, pageSize: params.pageSize };
  }

  async getAllDlqGroups(): Promise<
    Array<{
      queueName: string;
      queueDisplayName: string;
      groupId: string;
      error: string | null;
      errorStack: string | null;
      pipelineName: string | null;
      jobCount: number;
      movedAt: number | null;
    }>
  > {
    const queueNames = await this.repo.discoverQueueNames();
    const allGroups: Array<{
      queueName: string;
      queueDisplayName: string;
      groupId: string;
      error: string | null;
      errorStack: string | null;
      pipelineName: string | null;
      jobCount: number;
      movedAt: number | null;
    }> = [];

    for (const queueName of queueNames) {
      const groups = await this.repo.listDlqGroups({ queueName });
      const displayName = queueName.replace(/:gq$/, "").replace(/^.*:/, "");
      for (const group of groups) {
        allGroups.push({
          queueName,
          queueDisplayName: displayName,
          ...group,
        });
      }
    }

    allGroups.sort((a, b) => (b.movedAt ?? 0) - (a.movedAt ?? 0));
    return allGroups;
  }

  async unblockGroup(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ wasBlocked: boolean }> {
    return this.repo.unblockGroup(params);
  }

  async unblockAll(params: { queueName: string }): Promise<{ unblockedCount: number }> {
    return this.repo.unblockAll(params);
  }

  async drainGroup(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsRemoved: number }> {
    return this.repo.drainGroup(params);
  }

  async pausePipeline(params: { queueName: string; key: string }): Promise<void> {
    return this.repo.pausePipeline(params);
  }

  async unpausePipeline(params: { queueName: string; key: string }): Promise<void> {
    return this.repo.unpausePipeline(params);
  }

  async retryBlocked(params: {
    queueName: string;
    groupId: string;
    jobId: string;
  }): Promise<{ wasBlocked: boolean }> {
    return this.repo.retryBlocked(params);
  }

  async listPausedKeys(params: { queueName: string }): Promise<string[]> {
    return this.repo.listPausedKeys(params);
  }

  async pauseTenant(params: { queueName: string; tenantId: string }): Promise<void> {
    return this.repo.pauseTenant(params);
  }

  async unpauseTenant(params: { queueName: string; tenantId: string }): Promise<void> {
    return this.repo.unpauseTenant(params);
  }

  async listPausedTenants(params: { queueName: string }): Promise<string[]> {
    return this.repo.listPausedTenants(params);
  }

  async drainTenant(params: {
    queueName: string;
    tenantId: string;
    groupIdContains?: string;
  }): Promise<{ groupsDrained: number; jobsDrained: number }> {
    return this.repo.drainTenant(params);
  }

  async moveToDlq(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsMoved: number }> {
    return this.repo.moveToDlq(params);
  }

  async moveAllBlockedToDlq(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ movedCount: number; jobsMoved: number }> {
    return this.repo.moveAllBlockedToDlq(params);
  }

  async replayFromDlq(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsReplayed: number }> {
    return this.repo.replayFromDlq(params);
  }

  async replayAllFromDlq(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ replayedCount: number; jobsReplayed: number }> {
    return this.repo.replayAllFromDlq(params);
  }

  /**
   * Redrive exactly the DLQ groups the operator's filter showed, audited.
   * Explicit ids, not a re-evaluated filter: the confirmation and the act
   * must cover the same groups (specs/ops/dead-letter-recovery.feature).
   */
  async redriveManyFromDlq(params: {
    queueName: string;
    groupIds: string[];
    requestedBy: string;
  }): Promise<{ redrivenCount: number; jobsRedriven: number }> {
    const { requestedBy, ...rest } = params;
    const result = await this.repo.redriveManyFromDlq(rest);
    if (result.redrivenCount > 0) {
      await this.audit.append({
        actorUserId: requestedBy,
        action: "queue_redrive_dlq_groups",
        queueName: params.queueName,
        metadata: {
          groupIds: params.groupIds.slice(0, 50),
          requestedGroups: params.groupIds.length,
          ...result,
        },
      });
    }
    return result;
  }

  /**
   * Discard exactly the DLQ groups the operator's filter showed. The Redis
   * entries are removed (they TTL away regardless); the audit row IS the
   * retained mark, carrying the queue, groups, job counts and last errors.
   */
  async discardManyFromDlq(params: {
    queueName: string;
    groupIds: string[];
    requestedBy: string;
  }): Promise<{ discardedCount: number; jobsDiscarded: number }> {
    const { requestedBy, ...rest } = params;
    const { lastErrors, ...result } = await this.repo.discardManyFromDlq(rest);
    if (result.discardedCount > 0) {
      await this.audit.append({
        actorUserId: requestedBy,
        action: "queue_discard_dlq_groups",
        queueName: params.queueName,
        metadata: {
          groupIds: params.groupIds.slice(0, 50),
          requestedGroups: params.groupIds.length,
          // A job's error message is arbitrary thrown text and can carry
          // customer payload; the audit log is long-lived and widely read, so
          // it records the SHAPE of the failure rather than its content. The
          // full message stays where it already was, on the failing job.
          lastErrorTypes: summarizeErrorShapes(lastErrors),
          ...result,
        },
      });
    }
    return result;
  }

  async canaryRedrive(params: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ redrivenCount: number; groupIds: string[] }> {
    return this.repo.canaryRedrive(params);
  }

  async canaryUnblock(params: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ unblockedCount: number; groupIds: string[] }> {
    return this.repo.canaryUnblock(params);
  }

  async listDlqGroups(params: { queueName: string }): Promise<DlqGroupInfo[]> {
    return this.repo.listDlqGroups(params);
  }

  async getDrainPreview(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<DrainPreview> {
    return this.repo.drainAllBlockedPreview(params);
  }
}
