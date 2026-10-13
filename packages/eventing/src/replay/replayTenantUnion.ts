import type { ReplayEventSource } from "./replayEventSource.ts";

/**
 * A replay source whose tenant listing also names the tenants another listing holds (Round 51,
 * Alex 2026-10-08: the tenant directory's privately routed tenants), so a tenant held only on a
 * private dataplane is replayed through its routed target. Spec: projection-replay-step.feature.
 */
export function unionReplayTenants({
  source,
  listTenants,
}: {
  source: ReplayEventSource;
  listTenants: () => AsyncIterable<string>;
}): ReplayEventSource {
  const discover = source.discoverTenants?.bind(source);
  if (!discover) return source;
  return {
    async discoverTenants(input) {
      const tenants = new Set(await discover(input));
      for await (const tenantId of listTenants()) tenants.add(tenantId);
      return [...tenants];
    },
    discoverAffectedAggregates: (input) => source.discoverAffectedAggregates(input),
    countEventsForAggregates: (input) => source.countEventsForAggregates(input),
    getBoundedCutoffs: (input) => source.getBoundedCutoffs(input),
    streamEventsForAggregates: (input) => source.streamEventsForAggregates(input),
    loadAggregateEvents: (input) => source.loadAggregateEvents(input),
    ...(source.optimizeTables ? { optimizeTables: source.optimizeTables.bind(source) } : {}),
  };
}
