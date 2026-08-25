import type { LatencyWindows } from "~/shared/ops/latency";
import type { BoundedSection, ParkedTenant } from "./snapshot/snapshot.types";

/** One tenant's parked group, as the drill-down lists it. */
export interface ParkedGroupInfo {
  groupId: string;
  pendingJobs: number;
  /** Timestamp of the group's oldest waiting job, in ms; null when empty. */
  oldestJobMs: number | null;
  /** Dispatch-eligibility score, preserved across parking. */
  score: number;
  pipelineName: string | null;
}

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
  // Groups a tenant soft-cap parked OUT of the ready scan because the tenant is
  // at its in-flight cap. Surfaced so a parking spike (the over-cap ZADD storm
  // root) or a parked-group strand is visible instead of invisible backlog.
  parkedGroupCount: number;
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
  parkedGroupCount: number;
}

export interface ThroughputPoint {
  timestamp: number;
  ingestedPerSec: number;
  completedPerSec: number;
  failedPerSec: number;
  pendingCount: number;
  blockedCount: number;
  parkedCount: number;
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
  // Engine CPU is derived between successive INFO cpu samples. We expose the
  // raw cumulative counters here so the collector can diff them across collect
  // cycles without a second piece of state.
  usedCpuUserMainThreadSeconds: number;
  usedCpuSysMainThreadSeconds: number;
}

export interface DashboardData {
  totalGroups: number;
  blockedGroups: number;
  parkedGroups: number;
  totalPendingJobs: number;
  // counter − ground-truth drift from the last reconcile cycle (0 = healthy); see #4683
  pendingDrift: number;
  throughputIngestedPerSec: number;
  totalCompleted: number;
  totalFailed: number;
  completedPerSec: number;
  failedPerSec: number;
  peakCompletedPerSec: number;
  peakFailedPerSec: number;
  peakIngestedPerSec: number;
  redisMemoryUsedBytes: number;
  redisMemoryPeakBytes: number;
  redisMemoryMaxBytes: number;
  redisConnectedClients: number;
  // null on the first collection cycle (need two samples to derive a rate)
  // and on the cycle immediately after a Redis restart (cumulative counters
  // go backwards). Rounded to one decimal place when present.
  redisEngineCpuPercent: number | null;
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
  /**
   * Bucketed percentiles per time window (hour/day/week/all time), computed
   * by the writer's detail cycle from the completion histograms. Null until
   * the first detail cycle lands.
   */
  latencyWindows: LatencyWindows | null;
  phases: {
    commands: PhaseMetrics;
    projections: PhaseMetrics;
    reactions: PhaseMetrics;
  };
  jobNameMetrics: JobNameMetrics[];
  pausedKeys: string[];
  topErrors: ErrorCluster[];
  /**
   * Tenants sitting at their in-flight cap, deepest first (ADR-090).
   *
   * Always tenant soft-cap parking — the poison-group guard's unrelated "park"
   * puts a crash-looping group in the BLOCKED set and never appears here.
   */
  parkedTenants: ParkedTenant[];
  parkedTenantsBound: BoundedSection;
  /** How much of the blocked set the error clusters actually cover. */
  errorClustersBound: BoundedSection;
  /** Provenance of the served snapshot, so the page can report its own age. */
  snapshot: SnapshotProvenance;
}

/**
 * Where the served data came from and how old it is.
 *
 * Nulls mean "no snapshot of that kind has been read yet", which the dashboard
 * renders as its loading state rather than as zeroes.
 */
export interface SnapshotProvenance {
  /** When the live artifact was computed, in ms; null when none has been read. */
  computedAt: number | null;
  /** When the exhaustive detail artifact was computed, in ms. */
  detailComputedAt: number | null;
  /** Which writer produced it — the pod to look at when something is stuck. */
  writerId: string | null;
  /**
   * Increments on every lease acquisition, including a re-acquisition by the
   * pod that just lost it. It separates a stuck writer from a churning one; it
   * is not a fleet-wide ordering of writers.
   */
  leaseEpoch: number | null;
}

export type SSEEvent =
  | { type: "dashboard"; data: DashboardData }
  | { type: "heartbeat"; data: { timestamp: number } };
