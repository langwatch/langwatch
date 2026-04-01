import type { TenantId } from "../domain/tenantId";
import type { FoldProjectionDefinition } from "../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../projections/projectionStoreContext";
import type { ReplayEvent } from "./replayEventLoader";

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
 * Accumulates fold state incrementally as events are fed in one at a time.
 *
 * Memory is bounded by the number of unique (tenantId, projectionKey) pairs
 * (i.e. the aggregateBatchSize), NOT by the total number of events.
 * Events are applied immediately and can be GC'd — only the fold states
 * remain in memory.
 */
export class FoldAccumulator {
  private keyStates = new Map<string, any>();
  private keyAggregateIds = new Map<string, string>();
  private keyTenantIds = new Map<string, string>();
  private touchedKeys = new Set<string>();
  private _processed = 0;

  constructor(private readonly projection: FoldProjectionDefinition<any, any>) {}

  get processed(): number {
    return this._processed;
  }

  apply(event: ReplayEvent): void {
    const projectionKey = this.projection.key?.(event) ?? event.aggregateId;
    const scopedKey = tenantScopedKey(event.tenantId, projectionKey);

    const state = this.keyStates.get(scopedKey) ?? this.projection.init();
    const newState = this.projection.apply(state, event);
    this.keyStates.set(scopedKey, newState);
    this.keyAggregateIds.set(scopedKey, event.aggregateId);
    this.keyTenantIds.set(scopedKey, event.tenantId);
    this.touchedKeys.add(scopedKey);
    this._processed++;
  }

  async flush(writeBatchSize = DEFAULT_WRITE_BATCH_SIZE): Promise<void> {
    if (this.touchedKeys.size === 0 || !this.projection.store.storeBatch) return;

    // Group by tenant so each CH INSERT targets a single tenant
    const byTenant = new Map<string, Array<{ state: any; context: ProjectionStoreContext }>>();

    for (const scopedKey of this.touchedKeys) {
      const tenantId = this.keyTenantIds.get(scopedKey)!;
      const aggregateId = this.keyAggregateIds.get(scopedKey)!;
      const projectionKey = scopedKey.slice(tenantId.length + 2);

      const entry = {
        state: this.keyStates.get(scopedKey),
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

    for (const [_tenantId, entries] of byTenant) {
      for (let i = 0; i < entries.length; i += writeBatchSize) {
        const chunk = entries.slice(i, i + writeBatchSize);
        await this.projection.store.storeBatch(chunk);
      }
    }
  }
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
  const accumulator = new FoldAccumulator(projection);

  for (const event of events) {
    accumulator.apply(event);
    onEvent?.();
  }

  await accumulator.flush(writeBatchSize);
  return accumulator.processed;
}
