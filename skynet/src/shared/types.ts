export interface GroupInfo {
  groupId: string;
  pendingJobs: number;
  score: number;
  hasActiveJob: boolean;
  activeJobId: string | null;
  isBlocked: boolean;
  oldestJobMs: number | null;
  newestJobMs: number | null;
  isStaleBlock: boolean;
  pipelineName: string | null;
  jobType: string | null;
  jobName: string | null;
}

export interface QueueInfo {
  name: string;
  displayName: string;
  pendingGroupCount: number;
  blockedGroupCount: number;
  activeGroupCount: number;
  totalPendingJobs: number;
  groups: GroupInfo[];
}

export interface ThroughputPoint {
  timestamp: number;
  stagedPerSec: number;
  completedPerSec: number;
  failedPerSec: number;
}

export interface PipelineNode {
  name: string;
  pending: number;
  active: number;
  blocked: number;
  children: PipelineNode[];
}

export interface DashboardData {
  totalGroups: number;
  blockedGroups: number;
  totalPendingJobs: number;
  throughputStagedPerSec: number;
  totalCompleted: number;
  totalFailed: number;
  completedPerSec: number;
  failedPerSec: number;
  redisMemoryUsed: string;
  redisMemoryPeak: string;
  redisMemoryUsedBytes: number;
  redisMemoryPeakBytes: number;
  redisMemoryMaxBytes: number;
  redisConnectedClients: number;
  processCpuPercent: number;
  processMemoryUsedMb: number;
  processMemoryTotalMb: number;
  throughputHistory: ThroughputPoint[];
  pipelineTree: PipelineNode[];
  queues: QueueInfo[];
}

export interface JobInfo {
  stagedJobId: string;
  dispatchAfter: number;
  data: Record<string, unknown> | null;
}

export interface GroupDetailData {
  groupId: string;
  queueName: string;
  displayName: string;
  pendingJobs: number;
  hasActiveJob: boolean;
  activeJobId: string | null;
  isBlocked: boolean;
  isStaleBlock: boolean;
  pipelineName: string | null;
  jobType: string | null;
  jobName: string | null;
}

export interface FailedJob {
  id: string;
  name: string;
  data: Record<string, unknown>;
  failedReason: string;
  stacktrace: string[];
  attemptsMade: number;
  timestamp: number;
  finishedOn: number | null;
  queueName: string;
  queueDisplayName: string;
  pipelineName: string | null;
  jobType: string | null;
  jobName: string | null;
}

export type BullMQJobState = "waiting" | "active" | "completed" | "failed" | "delayed";

export interface BullMQJob {
  id: string;
  name: string;
  queueName: string;
  queueDisplayName: string;
  state: BullMQJobState;
  data: Record<string, unknown>;
  returnvalue: unknown | null;
  failedReason: string | null;
  stacktrace: string[];
  attemptsMade: number;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  delay: number;
  progress: number | string;
  opts: Record<string, unknown>;
}

export interface BullMQJobsPage {
  jobs: BullMQJob[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  state: BullMQJobState;
}

export interface BullMQQueueInfo {
  name: string;
  displayName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export type SSEEvent =
  | { type: "dashboard"; data: DashboardData }
  | { type: "heartbeat"; data: { timestamp: number } };
