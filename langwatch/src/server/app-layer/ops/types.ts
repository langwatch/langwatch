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
  errorMessage: string | null;
  errorStack: string | null;
  errorTimestamp: number | null;
  retryCount: number | null;
  activeKeyTtlSec: number | null;
  processingDurationMs: number | null;
}

export interface QueueInfo {
  name: string;
  displayName: string;
  pendingGroupCount: number;
  blockedGroupCount: number;
  activeGroupCount: number;
  totalPendingJobs: number;
  dlqCount: number;
  groups: GroupInfo[];
}

export interface QueueSummaryInfo {
  name: string;
  displayName: string;
  pendingGroupCount: number;
  blockedGroupCount: number;
  activeGroupCount: number;
  totalPendingJobs: number;
  dlqCount: number;
}

export interface ThroughputPoint {
  timestamp: number;
  ingestedPerSec: number;
  completedPerSec: number;
  failedPerSec: number;
  pendingCount: number;
  blockedCount: number;
}

export interface PhaseMetrics {
  pending: number;
  active: number;
  completedPerSec: number;
  failedPerSec: number;
  latencyP50Ms: number;
  latencyP99Ms: number;
  peakCompletedPerSec: number;
  peakFailedPerSec: number;
  peakLatencyP50Ms: number;
  peakLatencyP99Ms: number;
}

export interface JobNameMetrics {
  jobName: string;
  pipelineName: string;
  phase: "commands" | "projections" | "reactions";
  pending: number;
  active: number;
  completedPerSec: number;
  failedPerSec: number;
  latencyP50Ms: number;
  latencyP99Ms: number;
  peakCompletedPerSec: number;
  peakFailedPerSec: number;
  peakLatencyP50Ms: number;
  peakLatencyP99Ms: number;
}

export interface PipelineNode {
  name: string;
  pending: number;
  active: number;
  blocked: number;
  children: PipelineNode[];
}

export interface ErrorCluster {
  normalizedMessage: string;
  sampleMessage: string;
  sampleStack: string | null;
  count: number;
  pipelineName: string | null;
  queueName: string;
  sampleGroupIds: string[];
}

export interface RedisInfo {
  usedMemoryHuman: string;
  peakMemoryHuman: string;
  usedMemoryBytes: number;
  peakMemoryBytes: number;
  maxMemoryBytes: number;
  connectedClients: number;
}

export interface DashboardData {
  totalGroups: number;
  blockedGroups: number;
  totalPendingJobs: number;
  throughputIngestedPerSec: number;
  totalCompleted: number;
  totalFailed: number;
  completedPerSec: number;
  failedPerSec: number;
  peakCompletedPerSec: number;
  peakFailedPerSec: number;
  peakIngestedPerSec: number;
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
  queues: QueueSummaryInfo[];
  latencyP50Ms: number;
  latencyP99Ms: number;
  peakLatencyP50Ms: number;
  peakLatencyP99Ms: number;
  phases: {
    commands: PhaseMetrics;
    projections: PhaseMetrics;
    reactions: PhaseMetrics;
  };
  jobNameMetrics: JobNameMetrics[];
  pausedKeys: string[];
  topErrors: ErrorCluster[];
}

export type SSEEvent =
  | { type: "dashboard"; data: DashboardData }
  | { type: "heartbeat"; data: { timestamp: number } };

export type JobState =
  | "ready"
  | "scheduled"
  | "retrying"
  | "active"
  | "blocked"
  | "stale";

// Active jobs have their data HDEL'd from the group hash on dispatch, so
// they aren't searchable via the per-job aggregator. Surface the count via
// the overview chip instead.
export type SearchableJobState = Exclude<JobState, "active">;

export interface PendingJobSummary {
  jobId: string;
  groupId: string;
  pipelineName: string | null;
  jobType: string | null;
  jobName: string | null;
  tenantId: string | null;
  score: number;
  ageMs: number;
  state: JobState;
  retryCount: number | null;
}

export interface QueueOverview {
  queueName: string;
  generatedAtMs: number;
  computedDurationMs: number;
  groupsScanned: number;
  totals: {
    jobs: number;
    groups: number;
    ready: number;
    scheduled: number;
    retrying: number;
    active: number;
    blocked: number;
    stale: number;
    dlq: number;
  };
  byPipeline: Array<{ name: string; jobs: number; groups: number }>;
  byJobType: Array<{ name: string; jobs: number }>;
  byTenant: Array<{ tenantId: string; jobs: number; groups: number }>;
  byState: Array<{ state: JobState; jobs: number }>;
  oldestJobs: PendingJobSummary[];
  youngestJobs: PendingJobSummary[];
  mostOverduePerTenant: PendingJobSummary[];
}

export interface PendingJobFilter {
  pipelineName?: string;
  jobType?: string;
  tenantId?: string;
  state?: SearchableJobState;
  groupIdContains?: string;
  ageGtMs?: number;
  ageLtMs?: number;
}

export type PendingJobSort = "oldest" | "youngest" | "mostOverdue";

export interface PendingJobSearchResult {
  jobs: PendingJobSummary[];
  totalMatching: number;
  scannedGroups: number;
  truncated: boolean;
  generatedAtMs: number;
  computedDurationMs: number;
}

export interface PendingJobDetail {
  jobId: string;
  groupId: string;
  queueName: string;
  score: number | null;
  state: JobState;
  isActive: boolean;
  isBlocked: boolean;
  data: Record<string, unknown> | null;
  rawData: string | null;
  error: {
    message: string | null;
    stack: string | null;
    timestamp: number | null;
  } | null;
}
