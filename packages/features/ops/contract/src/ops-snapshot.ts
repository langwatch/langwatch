import { z } from "zod";
import {
  boundedSchema,
  errorClusterSchema,
  jobNameMetricsSchema,
  parkedTenantSchema,
  phaseMetricsSchema,
  pipelineNodeSchema,
  queueSummaryInfoSchema,
  throughputPointSchema,
} from "./ops-dashboard";
import { latencyWindowsSchema } from "./ops-latency";

/** Unknown wire versions are absent during rolling deploys. */
export const SNAPSHOT_VERSION = 1;

export const liveSnapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  computedAt: z.number(),
  writerId: z.string(),
  leaseEpoch: z.number(),

  queues: z.array(queueSummaryInfoSchema),
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
