import type { TenantId } from "../../../src/server/event-sourcing/domain/tenantId";
import type { FoldProjectionDefinition } from "../../../src/server/event-sourcing/projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../src/server/event-sourcing/projections/projectionStoreContext";
import type { ReplayEvent } from "./clickhouse";

/** Default number of projection entries per ClickHouse INSERT batch. */
const DEFAULT_WRITE_BATCH_SIZE = 5000;

/**
 * Composite key: `${tenantId}::${projectionKey}` — ensures tenant isolation
 * even when two tenants share the same aggregateId.
 */
function tenantScopedKey(tenantId: string, projectionKey: string): string {
  return `${tenantId}::${projectionKey}`;
}

/**
 * Replays events through a fold projection using in-memory state tracking.
 *
 * Two-phase approach:
 * - Phase 1 (apply): Loop through events, accumulate state in memory per
 *   tenant-scoped key. Each event's tenantId is taken from the event itself,
 *   never assumed from a shared parameter.
 * - Phase 2 (store): storeBatch() in chunks of writeBatchSize, grouped by
 *   tenantId so each ClickHouse INSERT targets a single tenant.
 */
export async function replayEvents({
  projection,
  events,
  onEvent,
  writeBatchSize = DEFAULT_WRITE_BATCH_SIZE,
}: {
  projection: FoldProjectionDefinition<any, any>;
  events: ReplayEvent[];
  onEvent?: () => void;
  writeBatchSize?: number;
}): Promise<number> {
  let processed = 0;

  // State keyed by `${tenantId}::${projectionKey}` for tenant isolation
  const keyStates = new Map<string, any>();
  const keyAggregateIds = new Map<string, string>();
  const keyTenantIds = new Map<string, string>();
  const touchedKeys = new Set<string>();

  // Phase 1: Apply all events in memory
  for (const event of events) {
    const projectionKey = projection.key?.(event) ?? event.aggregateId;
    const scopedKey = tenantScopedKey(event.tenantId, projectionKey);

    const state = keyStates.get(scopedKey) ?? projection.init();
    const newState = projection.apply(state, event);
    keyStates.set(scopedKey, newState);
    keyAggregateIds.set(scopedKey, event.aggregateId);
    keyTenantIds.set(scopedKey, event.tenantId);
    touchedKeys.add(scopedKey);

    processed++;
    onEvent?.();
  }

  // Phase 2: Group entries by tenantId, then store in chunked batches
  if (touchedKeys.size > 0 && projection.store.storeBatch) {
    // Group by tenant
    const byTenant = new Map<string, Array<{ state: any; context: ProjectionStoreContext }>>();

    for (const scopedKey of touchedKeys) {
      const tenantId = keyTenantIds.get(scopedKey)!;
      const aggregateId = keyAggregateIds.get(scopedKey)!;
      // Extract the original projection key (after the `::` separator)
      const projectionKey = scopedKey.slice(tenantId.length + 2);

      const entry = {
        state: keyStates.get(scopedKey),
        context: {
          aggregateId,
          tenantId: tenantId as TenantId,
          key: projectionKey,
        } as ProjectionStoreContext,
      };

      let list = byTenant.get(tenantId);
      if (!list) {
        list = [];
        byTenant.set(tenantId, list);
      }
      list.push(entry);
    }

    // Store each tenant's entries in chunks
    for (const [_tenantId, entries] of byTenant) {
      for (let i = 0; i < entries.length; i += writeBatchSize) {
        const chunk = entries.slice(i, i + writeBatchSize);
        await projection.store.storeBatch(chunk);
      }
    }
  }

  return processed;
}
