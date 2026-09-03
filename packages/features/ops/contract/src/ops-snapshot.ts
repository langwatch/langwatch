import { z } from "zod";
import type { PipelineNode } from "./ops-dashboard";

/** Unknown wire versions are absent during rolling deploys. */
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

// The annotation breaks the recursive schema cycle.
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

/** Tenant soft-cap parking, not poison-group blocking. */
const parkedTenantSchema = z.object({
  tenantId: z.string(),
  queueName: z.string(),
  groupCount: z.number(),
  /** Age of the longest-waiting parked group, in ms; null when unknown. */
  oldestParkedMs: z.number().nullable(),
});

/** Included and total rows make bounded sections explicit. */
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

/** Cache one successful parse per fixed Redis artifact. */
function createSnapshotParser<T>(schema: z.ZodType<T>) {
  let lastParse: { raw: string; value: T } | null = null;

  return (raw: string | null): T | null => {
    if (!raw) return null;
    if (lastParse?.raw === raw) return lastParse.value;

    try {
      const result = schema.safeParse(JSON.parse(raw));
      if (!result.success) return null;

      lastParse = { raw, value: result.data };
      return result.data;
    } catch {
      return null;
    }
  };
}

export const tryParseLiveSnapshot = createSnapshotParser(liveSnapshotSchema);
export const tryParseDetailSnapshot = createSnapshotParser(detailSnapshotSchema);
