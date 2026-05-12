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
