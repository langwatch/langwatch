import type { Named } from "@langwatch/module";
/**
 * The input shapes the operator event-log surface parses: the aggregate
 * explorer, the projection replay runner, and the tenant lookup both pickers
 * share.
 */
import { z } from "zod";

const opsDiscoverAggregatesInputSchemaDefinition = z.object({
  projectionNames: z.array(z.string()).min(1),
  since: z.string(),
  tenantIds: z.array(z.string()).optional(),
});
export interface OpsDiscoverAggregatesInputSchema extends Named<
  typeof opsDiscoverAggregatesInputSchemaDefinition
> {}
export const opsDiscoverAggregatesInputSchema: OpsDiscoverAggregatesInputSchema =
  opsDiscoverAggregatesInputSchemaDefinition;

/** A search with neither a query nor a tenant would scan the whole event log. */
const opsSearchAggregatesInputSchemaDefinition = z
  .object({
    query: z.string(),
    tenantId: z.string().optional(),
    sinceMs: z.number().int().positive().optional(),
  })
  .refine((input) => input.query.trim().length > 0 || Boolean(input.tenantId), {
    message: "Enter a search query or pick at least one tenant before searching.",
  });
export interface OpsSearchAggregatesInputSchema extends Named<
  typeof opsSearchAggregatesInputSchemaDefinition
> {}
export const opsSearchAggregatesInputSchema: OpsSearchAggregatesInputSchema =
  opsSearchAggregatesInputSchemaDefinition;

const opsLoadAggregateEventsInputSchemaDefinition = z.object({
  aggregateId: z.string(),
  tenantId: z.string(),
  limit: z.number().int().min(1).max(5000).default(500),
});
export interface OpsLoadAggregateEventsInputSchema extends Named<
  typeof opsLoadAggregateEventsInputSchemaDefinition
> {}
export const opsLoadAggregateEventsInputSchema: OpsLoadAggregateEventsInputSchema =
  opsLoadAggregateEventsInputSchemaDefinition;

const opsComputeProjectionStateInputSchemaDefinition = z.object({
  aggregateId: z.string(),
  tenantId: z.string(),
  projectionName: z.string(),
  eventIndex: z.number().int().min(0),
});
export interface OpsComputeProjectionStateInputSchema extends Named<
  typeof opsComputeProjectionStateInputSchemaDefinition
> {}
export const opsComputeProjectionStateInputSchema: OpsComputeProjectionStateInputSchema =
  opsComputeProjectionStateInputSchemaDefinition;

/** The tenant picker behind the explorer and the replay form. */
const opsSearchTenantsInputSchemaDefinition = z.object({ query: z.string() });
export interface OpsSearchTenantsInputSchema extends Named<
  typeof opsSearchTenantsInputSchemaDefinition
> {}
export const opsSearchTenantsInputSchema: OpsSearchTenantsInputSchema =
  opsSearchTenantsInputSchemaDefinition;

const opsDryRunReplayInputSchemaDefinition = z.object({
  projectionNames: z.array(z.string()).min(1),
  since: z.string(),
  tenantIds: z.array(z.string()),
  sampleSize: z.number().int().min(1).max(20).default(5),
});
export interface OpsDryRunReplayInputSchema extends Named<
  typeof opsDryRunReplayInputSchemaDefinition
> {}
export const opsDryRunReplayInputSchema: OpsDryRunReplayInputSchema =
  opsDryRunReplayInputSchemaDefinition;

const opsGetReplayRunInputSchemaDefinition = z.object({ runId: z.string() });
export interface OpsGetReplayRunInputSchema extends Named<
  typeof opsGetReplayRunInputSchemaDefinition
> {}
export const opsGetReplayRunInputSchema: OpsGetReplayRunInputSchema =
  opsGetReplayRunInputSchemaDefinition;

const opsStartReplayInputSchemaDefinition = z.object({
  projectionNames: z.array(z.string()).min(1),
  since: z.string(),
  tenantIds: z.array(z.string()).optional(),
  aggregateIds: z.array(z.string()).optional(),
  fullRebuild: z.boolean().optional(),
  description: z.string(),
});
export interface OpsStartReplayInputSchema extends Named<
  typeof opsStartReplayInputSchemaDefinition
> {}
export const opsStartReplayInputSchema: OpsStartReplayInputSchema =
  opsStartReplayInputSchemaDefinition;

// Named schemas for types EventExplorerService declares inline; naming them
// lets the port publish them.

/** How many aggregates one projection would replay, and for whom. */
const aggregateDiscoverySchemaDefinition = z.object({
  projections: z.array(
    z.object({
      projectionName: z.string(),
      aggregateCount: z.number(),
      tenantBreakdown: z.array(z.object({ tenantId: z.string(), aggregateCount: z.number() })),
    }),
  ),
});
export interface AggregateDiscoverySchema extends Named<
  typeof aggregateDiscoverySchemaDefinition
> {}
export const aggregateDiscoverySchema: AggregateDiscoverySchema =
  aggregateDiscoverySchemaDefinition;
export type AggregateDiscovery = z.infer<typeof aggregateDiscoverySchema>;

/** One aggregate the operator's search matched. */
const aggregateSearchResultSchemaDefinition = z.object({
  aggregateId: z.string(),
  aggregateType: z.string(),
  tenantId: z.string(),
  eventCount: z.number(),
  lastEventTime: z.string(),
});
export interface AggregateSearchResultSchema extends Named<
  typeof aggregateSearchResultSchemaDefinition
> {}
export const aggregateSearchResultSchema: AggregateSearchResultSchema =
  aggregateSearchResultSchemaDefinition;
export type AggregateSearchResult = z.infer<typeof aggregateSearchResultSchema>;

/** One stored event, with its payload parsed when it parses. */
const aggregateEventViewSchemaDefinition = z.object({
  eventId: z.string(),
  eventType: z.string(),
  eventTimestamp: z.string(),
  payload: z.unknown(),
});
export interface AggregateEventViewSchema extends Named<
  typeof aggregateEventViewSchemaDefinition
> {}
export const aggregateEventViewSchema: AggregateEventViewSchema =
  aggregateEventViewSchemaDefinition;
export type AggregateEventView = z.infer<typeof aggregateEventViewSchema>;

/** A projection folded up to a chosen event, for the state viewer. */
const projectionStateAtEventSchemaDefinition = z.object({
  state: z.unknown(),
  appliedEventCount: z.number(),
  projectionName: z.string(),
  aggregateType: z.string(),
});
export interface ProjectionStateAtEventSchema extends Named<
  typeof projectionStateAtEventSchemaDefinition
> {}
export const projectionStateAtEventSchema: ProjectionStateAtEventSchema =
  projectionStateAtEventSchemaDefinition;
export type ProjectionStateAtEvent = z.infer<typeof projectionStateAtEventSchema>;

/** The operator DejaView address that opens one aggregate's event history. */
export function dejaViewHref({
  aggregateId,
  tenantId,
}: {
  aggregateId: string;
  tenantId: string;
}): string {
  return `/ops/dejaview#a=${encodeURIComponent(aggregateId)}&at=${encodeURIComponent(tenantId)}`;
}
