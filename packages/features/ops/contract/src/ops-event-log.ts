/**
 * The input shapes the operator event-log surface parses: the aggregate
 * explorer, the projection replay runner, and the tenant lookup both pickers
 * share.
 */
import { z } from "zod";

export const opsDiscoverAggregatesInputSchema = z.object({
  projectionNames: z.array(z.string()).min(1),
  since: z.string(),
  tenantIds: z.array(z.string()).optional(),
});

export const opsSearchAggregatesInputSchema = z.object({
  query: z.string(),
  tenantId: z.string().optional(),
  sinceMs: z.number().int().positive().optional(),
});

export const opsLoadAggregateEventsInputSchema = z.object({
  aggregateId: z.string(),
  tenantId: z.string(),
  limit: z.number().int().min(1).max(5000).default(500),
});

export const opsComputeProjectionStateInputSchema = z.object({
  aggregateId: z.string(),
  tenantId: z.string(),
  projectionName: z.string(),
  eventIndex: z.number().int().min(0),
});

/** The tenant picker behind the explorer and the replay form. */
export const opsSearchTenantsInputSchema = z.object({ query: z.string() });

export const opsDryRunReplayInputSchema = z.object({
  projectionNames: z.array(z.string()).min(1),
  since: z.string(),
  tenantIds: z.array(z.string()),
  sampleSize: z.number().int().min(1).max(20).default(5),
});

export const opsGetReplayRunInputSchema = z.object({ runId: z.string() });

export const opsStartReplayInputSchema = z.object({
  projectionNames: z.array(z.string()).min(1),
  since: z.string(),
  tenantIds: z.array(z.string()).optional(),
  aggregateIds: z.array(z.string()).optional(),
  fullRebuild: z.boolean().optional(),
  description: z.string(),
});
