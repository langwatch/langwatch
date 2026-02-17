import type { TenantId } from "../../../src/server/event-sourcing/library/domain/tenantId";
import type { FoldProjectionDefinition } from "../../../src/server/event-sourcing/library/projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../src/server/event-sourcing/library/projections/projectionStoreContext";
import type { ReplayEvent } from "./clickhouse";

/**
 * Replays events through a fold projection using in-memory state tracking.
 *
 * Two-phase approach:
 * - Phase 1 (apply): Loop through events, accumulate state in memory per key.
 * - Phase 2 (store): Call store.storeBatch() once with all coalesced entries.
 *   For ClickHouse stores this produces 1 INSERT (1 part) instead of N.
 */
export async function replayEvents({
  projection,
  events,
  tenantId,
  keyStates,
  onEvent,
}: {
  projection: FoldProjectionDefinition<any, any>;
  events: ReplayEvent[];
  tenantId: string;
  keyStates: Map<string, any>;
  onEvent?: () => void;
}): Promise<number> {
  let processed = 0;

  // Track the last aggregateId seen for each key (needed for store context)
  const keyAggregateIds = new Map<string, string>();
  const touchedKeys = new Set<string>();

  // Phase 1: Apply all events in memory
  for (const event of events) {
    const key = projection.key?.(event) ?? event.aggregateId;
    const state = keyStates.get(key) ?? projection.init();
    const newState = projection.apply(state, event);
    keyStates.set(key, newState);
    keyAggregateIds.set(key, event.aggregateId);
    touchedKeys.add(key);

    processed++;
    onEvent?.();
  }

  // Phase 2: Store all unique keys in a single batch call.
  // For ClickHouse stores, this produces 1 INSERT (1 part) instead of N.
  const entries = [...touchedKeys].map((key) => ({
    state: keyStates.get(key),
    context: {
      aggregateId: keyAggregateIds.get(key)!,
      tenantId: tenantId as TenantId,
      key,
    } as ProjectionStoreContext,
  }));

  await projection.store.storeBatch(entries);

  return processed;
}
