import type { GroupInfo, QueueSummaryInfo } from "./types";
import type {
  QueueRepository,
  BlockedSummary,
  DlqGroupInfo,
  DrainPreview,
  JobEntry,
} from "./repositories/queue.repository";

export class QueueService {
  constructor(readonly repo: QueueRepository) {}

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
      return { groups: [], total: 0, page: params.page, pageSize: params.pageSize };
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
      const displayName = queueName
        .replace(/:gq$/, "")
        .replace(/^.*:/, "");
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

  async unblockAll(params: {
    queueName: string;
  }): Promise<{ unblockedCount: number }> {
    return this.repo.unblockAll(params);
  }

  async drainGroup(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsRemoved: number }> {
    return this.repo.drainGroup(params);
  }

  async pausePipeline(params: {
    queueName: string;
    key: string;
  }): Promise<void> {
    return this.repo.pausePipeline(params);
  }

  async unpausePipeline(params: {
    queueName: string;
    key: string;
  }): Promise<void> {
    return this.repo.unpausePipeline(params);
  }

  async retryBlocked(params: {
    queueName: string;
    groupId: string;
    jobId: string;
  }): Promise<{ wasBlocked: boolean }> {
    return this.repo.retryBlocked(params);
  }

  async listPausedKeys(params: {
    queueName: string;
  }): Promise<string[]> {
    return this.repo.listPausedKeys(params);
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

  async listDlqGroups(params: {
    queueName: string;
  }): Promise<DlqGroupInfo[]> {
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
