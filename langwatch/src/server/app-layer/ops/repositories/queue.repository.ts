import type {
  GroupInfo,
  QueueInfo,
  ErrorCluster,
} from "../types";

export interface BlockedSummary {
  totalBlocked: number;
  clusters: ErrorCluster[];
}

export interface DlqGroupInfo {
  groupId: string;
  error: string | null;
  errorStack: string | null;
  pipelineName: string | null;
  jobCount: number;
  movedAt: number | null;
}

export interface DrainPreview {
  totalAffected: number;
  byPipeline: Array<{ name: string; count: number }>;
  byError: Array<{ message: string; count: number }>;
}

export interface JobEntry {
  jobId: string;
  score: number;
  data: Record<string, unknown> | null;
}

export interface QueueRepository {
  discoverQueueNames(): Promise<string[]>;

  scanQueues(params: {
    queueNames: string[];
    topN?: number;
  }): Promise<QueueInfo[]>;

  getGroupJobs(params: {
    queueName: string;
    groupId: string;
    page: number;
    pageSize: number;
  }): Promise<{ jobs: JobEntry[]; total: number }>;

  getBlockedSummary(params: {
    queueNames: string[];
  }): Promise<BlockedSummary>;

  unblockGroup(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ wasBlocked: boolean }>;

  unblockAll(params: {
    queueName: string;
  }): Promise<{ unblockedCount: number }>;

  drainGroup(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsRemoved: number }>;

  pausePipeline(params: {
    queueName: string;
    key: string;
  }): Promise<void>;

  unpausePipeline(params: {
    queueName: string;
    key: string;
  }): Promise<void>;

  retryBlocked(params: {
    queueName: string;
    groupId: string;
    jobId: string;
  }): Promise<{ wasBlocked: boolean }>;

  listPausedKeys(params: {
    queueName: string;
  }): Promise<string[]>;

  moveToDlq(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsMoved: number }>;

  moveAllBlockedToDlq(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ movedCount: number; jobsMoved: number }>;

  replayFromDlq(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsReplayed: number }>;

  replayAllFromDlq(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ replayedCount: number; jobsReplayed: number }>;

  canaryRedrive(params: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ redrivenCount: number; groupIds: string[] }>;

  canaryUnblock(params: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ unblockedCount: number; groupIds: string[] }>;

  listDlqGroups(params: {
    queueName: string;
  }): Promise<DlqGroupInfo[]>;

  drainAllBlockedPreview(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<DrainPreview>;
}

export class NullQueueRepository implements QueueRepository {
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
}
