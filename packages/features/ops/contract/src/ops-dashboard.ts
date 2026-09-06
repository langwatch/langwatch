/**
 * The operator dashboard's vocabulary, as schemas.
 *
 * They were interfaces, and the same shapes were then written a second time as
 * zod inside the snapshot artifact's parser. One declaration now: the schema is
 * the wire contract the snapshot is parsed against AND the shape the tRPC
 * surface declares it answers, and every type here is inferred from it.
 */
import { z } from "zod";
import { latencyWindowsSchema } from "./ops-latency";

/** One tenant's parked group, as the drill-down lists it. */
export const parkedGroupInfoSchema = z.object({
  groupId: z.string(),
  pendingJobs: z.number(),
  /** Timestamp of the group's oldest waiting job, in ms; null when empty. */
  oldestJobMs: z.number().nullable(),
  /** Dispatch-eligibility score, preserved across parking. */
  score: z.number(),
  pipelineName: z.string().nullable(),
});
export type ParkedGroupInfo = z.infer<typeof parkedGroupInfoSchema>;

export const groupInfoSchema = z.object({
  groupId: z.string(),
  pendingJobs: z.number(),
  score: z.number(),
  hasActiveJob: z.boolean(),
  activeJobId: z.string().nullable(),
  isBlocked: z.boolean(),
  oldestJobMs: z.number().nullable(),
  newestJobMs: z.number().nullable(),
  isStaleBlock: z.boolean(),
  pipelineName: z.string().nullable(),
  jobType: z.string().nullable(),
  jobName: z.string().nullable(),
  errorMessage: z.string().nullable(),
  errorStack: z.string().nullable(),
  errorTimestamp: z.number().nullable(),
  retryCount: z.number().nullable(),
  activeKeyTtlSec: z.number().nullable(),
  processingDurationMs: z.number().nullable(),
});
export type GroupInfo = z.infer<typeof groupInfoSchema>;

export const queueSummaryInfoSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  pendingGroupCount: z.number(),
  blockedGroupCount: z.number(),
  activeGroupCount: z.number(),
  totalPendingJobs: z.number(),
  dlqCount: z.number(),
  // Groups a tenant soft-cap parked OUT of the ready scan because the tenant is
  // at its in-flight cap. Surfaced so a parking spike (the over-cap ZADD storm
  // root) or a parked-group strand is visible instead of invisible backlog.
  parkedGroupCount: z.number(),
});
export type QueueSummaryInfo = z.infer<typeof queueSummaryInfoSchema>;

export const queueInfoSchema = queueSummaryInfoSchema.extend({
  groups: z.array(groupInfoSchema),
});
export type QueueInfo = z.infer<typeof queueInfoSchema>;

export const throughputPointSchema = z.object({
  timestamp: z.number(),
  ingestedPerSec: z.number(),
  completedPerSec: z.number(),
  failedPerSec: z.number(),
  pendingCount: z.number(),
  blockedCount: z.number(),
  parkedCount: z.number(),
});
export type ThroughputPoint = z.infer<typeof throughputPointSchema>;

export const phaseMetricsSchema = z.object({
  pending: z.number(),
  active: z.number(),
  completedPerSec: z.number(),
  failedPerSec: z.number(),
  latencyP50Ms: z.number(),
  latencyP99Ms: z.number(),
  peakCompletedPerSec: z.number(),
  peakFailedPerSec: z.number(),
  peakLatencyP50Ms: z.number(),
  peakLatencyP99Ms: z.number(),
});
export type PhaseMetrics = z.infer<typeof phaseMetricsSchema>;

export const jobNameMetricsSchema = z.object({
  jobName: z.string(),
  pipelineName: z.string(),
  phase: z.enum(["commands", "projections", "reactions"]),
  pending: z.number(),
  active: z.number(),
  completedPerSec: z.number(),
  failedPerSec: z.number(),
  latencyP50Ms: z.number(),
  latencyP99Ms: z.number(),
  peakCompletedPerSec: z.number(),
  peakFailedPerSec: z.number(),
  peakLatencyP50Ms: z.number(),
  peakLatencyP99Ms: z.number(),
});
export type JobNameMetrics = z.infer<typeof jobNameMetricsSchema>;

/** The pipeline tree. Named ahead of the schema — the schema is recursive. */
export interface PipelineNode {
  name: string;
  pending: number;
  active: number;
  blocked: number;
  children: PipelineNode[];
}

// The annotation breaks the recursive schema cycle.
export const pipelineNodeSchema: z.ZodType<PipelineNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    pending: z.number(),
    active: z.number(),
    blocked: z.number(),
    children: z.array(pipelineNodeSchema),
  }),
);

export const errorClusterSchema = z.object({
  normalizedMessage: z.string(),
  sampleMessage: z.string(),
  sampleStack: z.string().nullable(),
  count: z.number(),
  pipelineName: z.string().nullable(),
  queueName: z.string(),
  sampleGroupIds: z.array(z.string()),
});
export type ErrorCluster = z.infer<typeof errorClusterSchema>;

/** Tenant soft-cap parking, not poison-group blocking. */
export const parkedTenantSchema = z.object({
  tenantId: z.string(),
  queueName: z.string(),
  groupCount: z.number(),
  /** Age of the longest-waiting parked group, in ms; null when unknown. */
  oldestParkedMs: z.number().nullable(),
});
export type ParkedTenant = z.infer<typeof parkedTenantSchema>;

/** Included and total rows make bounded sections explicit. */
export const boundedSchema = z.object({
  /** Rows included in this snapshot. */
  included: z.number(),
  /** Rows that exist. Equal to `included` when nothing was dropped. */
  total: z.number(),
});
export type BoundedSection = z.infer<typeof boundedSchema>;

export const redisInfoSchema = z.object({
  usedMemoryHuman: z.string(),
  peakMemoryHuman: z.string(),
  usedMemoryBytes: z.number(),
  peakMemoryBytes: z.number(),
  maxMemoryBytes: z.number(),
  connectedClients: z.number(),
  // Engine CPU is derived between successive INFO cpu samples. We expose the
  // raw cumulative counters here so the collector can diff them across collect
  // cycles without a second piece of state.
  usedCpuUserMainThreadSeconds: z.number(),
  usedCpuSysMainThreadSeconds: z.number(),
});
export type RedisInfo = z.infer<typeof redisInfoSchema>;

/**
 * Where the served data came from and how old it is.
 *
 * Nulls mean "no snapshot of that kind has been read yet", which the dashboard
 * renders as its loading state rather than as zeroes.
 */
export const snapshotProvenanceSchema = z.object({
  /** When the live artifact was computed, in ms; null when none has been read. */
  computedAt: z.number().nullable(),
  /** When the exhaustive detail artifact was computed, in ms. */
  detailComputedAt: z.number().nullable(),
  /** Which writer produced it — the pod to look at when something is stuck. */
  writerId: z.string().nullable(),
  /**
   * Increments on every lease acquisition, including a re-acquisition by the
   * pod that just lost it. It separates a stuck writer from a churning one; it
   * is not a fleet-wide ordering of writers.
   */
  leaseEpoch: z.number().nullable(),
});
export type SnapshotProvenance = z.infer<typeof snapshotProvenanceSchema>;

export const dashboardDataSchema = z.object({
  totalGroups: z.number(),
  blockedGroups: z.number(),
  parkedGroups: z.number(),
  totalPendingJobs: z.number(),
  // counter − ground-truth drift from the last reconcile cycle (0 = healthy); see #4683
  pendingDrift: z.number(),
  throughputIngestedPerSec: z.number(),
  totalCompleted: z.number(),
  totalFailed: z.number(),
  completedPerSec: z.number(),
  failedPerSec: z.number(),
  peakCompletedPerSec: z.number(),
  peakFailedPerSec: z.number(),
  peakIngestedPerSec: z.number(),
  redisMemoryUsedBytes: z.number(),
  redisMemoryPeakBytes: z.number(),
  redisMemoryMaxBytes: z.number(),
  redisConnectedClients: z.number(),
  // null on the first collection cycle (need two samples to derive a rate)
  // and on the cycle immediately after a Redis restart (cumulative counters
  // go backwards). Rounded to one decimal place when present.
  redisEngineCpuPercent: z.number().nullable(),
  processCpuPercent: z.number(),
  processMemoryUsedMb: z.number(),
  processMemoryTotalMb: z.number(),
  throughputHistory: z.array(throughputPointSchema),
  pipelineTree: z.array(pipelineNodeSchema),
  queues: z.array(queueSummaryInfoSchema),
  latencyP50Ms: z.number(),
  latencyP99Ms: z.number(),
  peakLatencyP50Ms: z.number(),
  peakLatencyP99Ms: z.number(),
  /**
   * Bucketed percentiles per time window (hour/day/week/all time), computed
   * by the writer's detail cycle from the completion histograms. Null until
   * the first detail cycle lands.
   */
  latencyWindows: latencyWindowsSchema.nullable(),
  phases: z.object({
    commands: phaseMetricsSchema,
    projections: phaseMetricsSchema,
    reactions: phaseMetricsSchema,
  }),
  jobNameMetrics: z.array(jobNameMetricsSchema),
  pausedKeys: z.array(z.string()),
  topErrors: z.array(errorClusterSchema),
  /**
   * Tenants sitting at their in-flight cap, deepest first (ADR-090).
   *
   * Always tenant soft-cap parking — the poison-group guard's unrelated "park"
   * puts a crash-looping group in the BLOCKED set and never appears here.
   */
  parkedTenants: z.array(parkedTenantSchema),
  parkedTenantsBound: boundedSchema,
  /** How much of the blocked set the error clusters actually cover. */
  errorClustersBound: boundedSchema,
  /** Provenance of the served snapshot, so the page can report its own age. */
  snapshot: snapshotProvenanceSchema,
});
export type DashboardData = z.infer<typeof dashboardDataSchema>;

export type SSEEvent =
  | { type: "dashboard"; data: DashboardData }
  | { type: "heartbeat"; data: { timestamp: number } };
