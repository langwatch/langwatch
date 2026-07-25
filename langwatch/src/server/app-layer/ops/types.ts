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

/**
 * One content-addressed blob as the ops surface sees it.
 *
 * Deliberately carries no bytes. The body is customer payload, and an operator
 * browsing retention needs to know how big a blob is and whether anything still
 * references it, never what is inside it.
 */
export interface OpsBlobSummary {
  queueName: string;
  projectId: string;
  hash: string;
  /** Serialized size in bytes. */
  sizeBytes: number;
  /** Seconds until expiry; null when the key carries no expiry at all. */
  ttlSeconds: number | null;
  /** Lease holders whose deadline has not passed. */
  liveLeases: number;
  /** Mirrored holder tokens, excluding the rolling-deploy sentinel. */
  holderTokens: number;
  /**
   * Earliest deadline in the lease set, in Redis-time ms; null when no lease
   * member remains at all.
   *
   * When this is in the past it dates the blob's oldest LAPSED lease — i.e. how
   * long ago the holder that should have released it stopped renewing. That is
   * the sharpest available signal for "a worker died here", which is what
   * strands blobs in the first place.
   */
  earliestLeaseDeadlineMs: number | null;
  /**
   * What a sweep would decide for this blob right now, so the browser and the
   * runner can never tell an operator two different stories.
   */
  sweepOutcome: string;
}

/**
 * How a listing is ordered.
 *
 * `scan` is the only exhaustive mode: it walks the keyspace in Redis cursor
 * order, which is arbitrary but complete and resumable. Every other mode is a
 * RANKED SAMPLE — a keyspace of millions cannot be globally sorted inside a
 * request, so those modes read a bounded window, order it, and report how much
 * they looked at. That is the honest trade: "largest in the 20k we sampled",
 * never "largest that exists".
 */
export const OPS_BLOB_SORTS = [
  /** Cursor order. Exhaustive and resumable; no ranking. */
  "scan",
  /** Biggest payloads first — what is actually occupying the instance. */
  "largest",
  /**
   * Least recently touched first. Every access re-arms the blob to the full
   * backstop, so a LOW remaining TTL means nothing has read or staged it in a
   * long time. This is the closest thing to "oldest" the store can answer:
   * blobs carry no creation timestamp.
   */
  "stalest",
  /** Nothing holds a live lease — the reclaimable set, biggest first. */
  "unreferenced",
  /** Longest-lapsed lease first: where a holder most likely died mid-flight. */
  "oldest_lapsed_lease",
] as const;

export type OpsBlobSort = (typeof OPS_BLOB_SORTS)[number];

export interface OpsBlobPage {
  blobs: OpsBlobSummary[];
  /** Opaque; pass back to continue. Null when the walk is finished. */
  nextCursor: string | null;
  /** Blobs examined to produce this page. */
  sampled: number;
  /**
   * True when ranking could not see the whole keyspace, so the order is a
   * best-of-sample rather than a true top-N. Always false for `scan`.
   */
  rankedFromSample: boolean;
}

export interface OpsBlobStoreStats {
  queues: Array<{
    queueName: string;
    /** Sampled, not exact: a full count of a multi-million-key keyspace is not a request-time operation. */
    sampledBlobs: number;
    sampledBytes: number;
    unreferenced: number;
    truncated: boolean;
  }>;
}
