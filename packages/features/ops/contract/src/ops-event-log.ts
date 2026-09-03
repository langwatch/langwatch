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
export interface AggregateDiscovery {
  projections: Array<{
    projectionName: string;
    aggregateCount: number;
    tenantBreakdown: Array<{ tenantId: string; aggregateCount: number }>;
  }>;
}

/** One aggregate the operator's search matched. */
export interface AggregateSearchResult {
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  eventCount: number;
  lastEventTime: string;
}

/** One stored event, with its payload parsed when it parses. */
export interface AggregateEventView {
  eventId: string;
  eventType: string;
  eventTimestamp: string;
  payload: unknown;
}

/** A projection folded up to a chosen event, for the state viewer. */
export interface ProjectionStateAtEvent {
  state: unknown;
  appliedEventCount: number;
  projectionName: string;
  aggregateType: string;
}
