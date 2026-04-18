import type { TenantId } from "../domain/tenantId";
import type { FoldProjectionDefinition } from "../projections/foldProjection.types";
import type { MapProjectionDefinition } from "../projections/mapProjection.types";
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
    if (this.touchedKeys.size === 0) return;
    if (writeBatchSize <= 0) throw new Error("writeBatchSize must be > 0");

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

    const store = this.projection.store;
    for (const [_tenantId, entries] of byTenant) {
      if (store.storeBatch) {
        for (let i = 0; i < entries.length; i += writeBatchSize) {
          const chunk = entries.slice(i, i + writeBatchSize);
          await store.storeBatch(chunk);
        }
      } else {
        // Fallback: sequential single-entry writes
        for (const entry of entries) {
          await store.store(entry.state, entry.context);
        }
      }
    }
  }
}

/**
 * Accumulates map projection records as events are fed in one at a time.
 *
 * Unlike FoldAccumulator (which merges state per aggregate), MapAccumulator
 * buffers one output record per event. Records are grouped by tenantId and
 * flushed in bulk via `store.bulkAppend()` (or sequential `store.append()`
 * as fallback).
 *
 * Memory is bounded by the number of events in a single aggregate batch
 * that match this projection's eventTypes.
 */
export class MapAccumulator {
  private byTenant = new Map<string, any[]>();
  private _processed = 0;
  private readonly eventTypeSet: Set<string>;

  constructor(private readonly projection: MapProjectionDefinition<any, any>) {
    this.eventTypeSet = new Set(projection.eventTypes);
  }

  get processed(): number {
    return this._processed;
  }

  apply(event: ReplayEvent): void {
    if (!this.eventTypeSet.has(event.type)) return;

    const record = this.projection.map(event as any);
    if (record === null) return;

    let list = this.byTenant.get(event.tenantId);
    if (!list) {
      list = [];
      this.byTenant.set(event.tenantId, list);
    }
    list.push(record);
    this._processed++;
  }

  async flush(writeBatchSize = DEFAULT_WRITE_BATCH_SIZE): Promise<void> {
    if (this.byTenant.size === 0) return;

    const store = this.projection.store;

    for (const [tenantId, records] of this.byTenant) {
      const context: ProjectionStoreContext = {
        aggregateId: "",
        tenantId: tenantId as unknown as TenantId,
      };

      if (store.bulkAppend) {
        for (let i = 0; i < records.length; i += writeBatchSize) {
          const chunk = records.slice(i, i + writeBatchSize);
          await store.bulkAppend(chunk, context);
        }
      } else {
        for (const record of records) {
          await store.append(record, context);
        }
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
