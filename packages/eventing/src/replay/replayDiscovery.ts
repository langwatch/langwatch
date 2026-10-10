import { toEpochMs } from "@langwatch/time";

import type { DiscoveredAggregate } from "./replayEventSource.ts";
import type { DiscoveryResult, ReplayContext } from "./types.ts";

/**
 * Discovers the aggregates (and total event count) a projection's replay must
 * cover, grouped per tenant. Takes `eventTypes` directly so fold and map
 * projections share it without casts.
 */
export async function discoverProjectionAggregates({
  eventSource,
  eventTypes,
  since,
  tenantId,
}: {
  eventSource: ReplayContext["eventSource"];
  eventTypes: readonly string[];
  since: string;
  tenantId?: string;
}): Promise<DiscoveryResult> {
  const sinceMs = toEpochMs(since);
  const [aggregates, totalEvents] = await Promise.all([
    eventSource.discoverAffectedAggregates({
      eventTypes,
      sinceMs,
      tenantId,
    }),
    eventSource.countEventsForAggregates({
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
 * (scoped replay). Mutates `byTenant` in place to stay in sync; a no-op when
 * the list is empty/absent (full replay).
 */
export function filterDiscoveredByAggregateIds({
  allAggregates,
  byTenant,
  aggregateIds,
}: {
  allAggregates: DiscoveredAggregate[];
  byTenant: Map<string, DiscoveredAggregate[]>;
  aggregateIds?: string[];
}): DiscoveredAggregate[] {
  if (!aggregateIds || aggregateIds.length === 0) return allAggregates;
  const allowed = new Set(aggregateIds);
  for (const [tid, aggs] of byTenant) {
    const kept = aggs.filter((a) => allowed.has(a.aggregateId));
    if (kept.length > 0) byTenant.set(tid, kept);
    else byTenant.delete(tid);
  }
  return allAggregates.filter((a) => allowed.has(a.aggregateId));
}
