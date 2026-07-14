import type { DiscoveryResult, ReplayContext } from "./types";
import type { DiscoveredAggregate } from "./replayEventLoader";
import {
  discoverAffectedAggregates,
  countEventsForAggregates,
} from "./replayEventLoader";

/**
 * Discovers the aggregates (and total event count) a projection's replay must
 * cover — every aggregate with at least one of the given event types since
 * `since`, grouped per tenant. Takes the projection's `eventTypes` directly so
 * fold and map projections share it without casts.
 */
export async function discoverProjectionAggregates({
  resolveClient,
  eventTypes,
  since,
  tenantId,
}: {
  resolveClient: ReplayContext["resolveClient"];
  eventTypes: readonly string[];
  since: string;
  tenantId?: string;
}): Promise<DiscoveryResult> {
  const client = await resolveClient(tenantId);
  const sinceMs = new Date(since).getTime();
  const [aggregates, totalEvents] = await Promise.all([
    discoverAffectedAggregates({
      client,
      eventTypes,
      sinceMs,
      tenantId,
    }),
    countEventsForAggregates({
      client,
      eventTypes,
      sinceMs,
      tenantId,
    }),
  ]);

  const byTenant = new Map<string, DiscoveredAggregate[]>();
  for (const agg of aggregates) {
    const list = byTenant.get(agg.tenantId) ?? [];
    list.push(agg);
    byTenant.set(agg.tenantId, list);
  }

  return { aggregates, byTenant, tenantCount: byTenant.size, totalEvents };
}

/**
 * Restrict discovered aggregates to a caller-supplied `aggregateIds` allow-list
 * (single-/scoped-aggregate replay). Mutates `byTenant` in place to stay in
 * sync and returns the filtered `allAggregates`. A no-op when the list is
 * empty/absent (full replay). The optimized path applies the same filter
 * against its aggregate→projection map.
 */
export function filterDiscoveredByAggregateIds(
  allAggregates: DiscoveredAggregate[],
  byTenant: Map<string, DiscoveredAggregate[]>,
  aggregateIds?: string[],
): DiscoveredAggregate[] {
  if (!aggregateIds || aggregateIds.length === 0) return allAggregates;
  const allowed = new Set(aggregateIds);
  for (const [tid, aggs] of byTenant) {
    const kept = aggs.filter((a) => allowed.has(a.aggregateId));
    if (kept.length > 0) byTenant.set(tid, kept);
    else byTenant.delete(tid);
  }
  return allAggregates.filter((a) => allowed.has(a.aggregateId));
}
