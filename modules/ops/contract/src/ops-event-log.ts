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

// ---------------------------------------------------------------------------
// The event explorer's answers.
//
// `OpsEventExplorer` said `Promise<unknown>` for all four of its operations,
// so the replay wizard, the aggregate search and the projection-state viewer
// read their fields off `{}`. Every shape below is the one
// `EventExplorerService` already declares inline; naming them is what lets the
// port publish them.
// ---------------------------------------------------------------------------

/** How many aggregates one projection would replay, and for whom. */
export const aggregateDiscoverySchema = z.object({
  projections: z.array(
    z.object({
      projectionName: z.string(),
      aggregateCount: z.number(),
      tenantBreakdown: z.array(z.object({ tenantId: z.string(), aggregateCount: z.number() })),
    }),
  ),
});
export type AggregateDiscovery = z.infer<typeof aggregateDiscoverySchema>;

/** One aggregate the operator's search matched. */
export const aggregateSearchResultSchema = z.object({
  aggregateId: z.string(),
  aggregateType: z.string(),
  tenantId: z.string(),
  eventCount: z.number(),
  lastEventTime: z.string(),
});
export type AggregateSearchResult = z.infer<typeof aggregateSearchResultSchema>;

/** One stored event, with its payload parsed when it parses. */
export const aggregateEventViewSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  eventTimestamp: z.string(),
  payload: z.unknown(),
});
export type AggregateEventView = z.infer<typeof aggregateEventViewSchema>;

/** A projection folded up to a chosen event, for the state viewer. */
export const projectionStateAtEventSchema = z.object({
  state: z.unknown(),
  appliedEventCount: z.number(),
  projectionName: z.string(),
  aggregateType: z.string(),
});
export type ProjectionStateAtEvent = z.infer<typeof projectionStateAtEventSchema>;
