import { z } from "zod";
import type { PipelineNode } from "../types";

/**
 * Wire version of the ops snapshot (ADR-090).
 *
 * Readers treat an unrecognised version as an ABSENT snapshot rather than
 * trying to coerce it: during a rolling deploy the two releases genuinely
 * disagree about the shape, and rendering a half-understood payload is worse
 * than rendering the loading state for one pod-termination cycle.
 *
 * Bump this only for a breaking shape change. Every field below is required,
 * so any field ADDED without a bump has to be declared `.optional()` to stay
 * readable by the build that does not write it — adding a required one is a
 * breaking change and needs the bump.
 */
export const SNAPSHOT_VERSION = 1;

const throughputPointSchema = z.object({
  timestamp: z.number(),
  ingestedPerSec: z.number(),
  completedPerSec: z.number(),
  failedPerSec: z.number(),
  pendingCount: z.number(),
  blockedCount: z.number(),
  parkedCount: z.number(),
});

const queueSummarySchema = z.object({
  name: z.string(),
  displayName: z.string(),
  pendingGroupCount: z.number(),
  blockedGroupCount: z.number(),
  activeGroupCount: z.number(),
  totalPendingJobs: z.number(),
  dlqCount: z.number(),
  parkedGroupCount: z.number(),
});

const phaseMetricsSchema = z.object({
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

const jobNameMetricsSchema = z.object({
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

// Recursive schemas are the one case zod cannot infer: the annotation is
// required to break the cycle. It reuses the existing `PipelineNode` rather
// than restating its shape, so the two cannot drift.
const pipelineNodeSchema: z.ZodType<PipelineNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    pending: z.number(),
    active: z.number(),
    blocked: z.number(),
    children: z.array(pipelineNodeSchema),
  }),
);

const errorClusterSchema = z.object({
  normalizedMessage: z.string(),
  sampleMessage: z.string(),
  sampleStack: z.string().nullable(),
  count: z.number(),
  pipelineName: z.string().nullable(),
  queueName: z.string(),
  sampleGroupIds: z.array(z.string()),
});

/**
 * One tenant sitting at its in-flight cap, with enough context to act.
 *
 * "Parked" here is ALWAYS tenant soft-cap parking (a group moved out of the
 * ready zset into the tenant's parked set). The poison-group guard's unrelated
 * "park" puts a crash-looping group in the BLOCKED set; it never appears here.
 */
const parkedTenantSchema = z.object({
  tenantId: z.string(),
  queueName: z.string(),
  groupCount: z.number(),
  /** Age of the longest-waiting parked group, in ms; null when unknown. */
  oldestParkedMs: z.number().nullable(),
});

/**
 * How much of a bounded section the writer actually included.
 *
 * Every bound the snapshot applies reports itself. Silent truncation is the
 * defect ADR-090 exists to remove — reintroducing it inside the snapshot would
 * be the same bug with better plumbing.
 */
const boundedSchema = z.object({
  /** Rows included in this snapshot. */
  included: z.number(),
  /** Rows that exist. Equal to `included` when nothing was dropped. */
  total: z.number(),
});

export const liveSnapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  computedAt: z.number(),
  writerId: z.string(),
  leaseEpoch: z.number(),

  queues: z.array(queueSummarySchema),
  totalGroups: z.number(),
  totalPendingJobs: z.number(),
  pendingDrift: z.number(),

  throughputIngestedPerSec: z.number(),
  completedPerSec: z.number(),
  failedPerSec: z.number(),
  totalCompleted: z.number(),
  totalFailed: z.number(),
  peakCompletedPerSec: z.number(),
  peakFailedPerSec: z.number(),
  peakIngestedPerSec: z.number(),

  latencyP50Ms: z.number(),
  latencyP99Ms: z.number(),
  peakLatencyP50Ms: z.number(),
  peakLatencyP99Ms: z.number(),

  redisMemoryUsedBytes: z.number(),
  redisMemoryPeakBytes: z.number(),
  redisMemoryMaxBytes: z.number(),
  redisConnectedClients: z.number(),
  redisEngineCpuPercent: z.number().nullable(),
  processCpuPercent: z.number(),
  processMemoryUsedMb: z.number(),
  processMemoryTotalMb: z.number(),

  pausedKeys: z.array(z.string()),
  throughputHistory: z.array(throughputPointSchema),
});

const latencyWindowPercentilesSchema = z.object({
  p50Ms: z.number(),
  p99Ms: z.number(),
  count: z.number(),
});

/** Bucketed-histogram percentiles per window; null = no completions there. */
export const latencyWindowsSchema = z.object({
  hour: latencyWindowPercentilesSchema.nullable(),
  day: latencyWindowPercentilesSchema.nullable(),
  week: latencyWindowPercentilesSchema.nullable(),
  allTime: latencyWindowPercentilesSchema.nullable(),
});

export const detailSnapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  computedAt: z.number(),
  writerId: z.string(),
  leaseEpoch: z.number(),

  /** Exhaustive: every blocked group is clustered, not a sample of them. */
  topErrors: z.array(errorClusterSchema),
  errorClustersBound: boundedSchema,

  parkedTenants: z.array(parkedTenantSchema),
  parkedTenantsBound: boundedSchema,

  pipelineTree: z.array(pipelineNodeSchema),
  phases: z.object({
    commands: phaseMetricsSchema,
    projections: phaseMetricsSchema,
    reactions: phaseMetricsSchema,
  }),
  jobNameMetrics: z.array(jobNameMetricsSchema),

  // Optional so an artifact written by a pre-windows writer still parses
  // during a rolling handover; readers coalesce absence to null.
  latencyWindows: latencyWindowsSchema.nullable().optional(),
});

export type LiveSnapshot = z.infer<typeof liveSnapshotSchema>;
export type DetailSnapshot = z.infer<typeof detailSnapshotSchema>;
export type ParkedTenant = z.infer<typeof parkedTenantSchema>;
export type BoundedSection = z.infer<typeof boundedSchema>;

/**
 * Parse a stored snapshot, treating anything unreadable as absent.
 *
 * Version mismatch, malformed JSON and schema drift all collapse to `null` on
 * purpose: the caller's only sensible response to each is the same (wait for a
 * snapshot it understands), and distinguishing them at the call site would
 * invite rendering a partial payload.
 */
export function parseSnapshot<T>(
  schema: z.ZodType<T>,
  raw: string | null,
): T | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
