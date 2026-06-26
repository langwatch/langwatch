import type { TenantId } from "../domain/tenantId";
import type { FoldProjectionDefinition } from "../projections/foldProjection.types";
import type { MapProjectionDefinition } from "../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../projections/projectionStoreContext";
import type { ReplayEvent } from "./replayEventLoader";
import type { Event } from "../domain/types";
import { leanForProjection } from "~/server/app-layer/traces/lean-for-projection";

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
  private readonly eventTypeSet: Set<string>;

  constructor(private readonly projection: FoldProjectionDefinition<any, any>) {
    this.eventTypeSet = new Set(projection.eventTypes);
  }

  get processed(): number {
    return this._processed;
  }

  apply(event: ReplayEvent): void {
    // Optimized replay loads events for the union of all projections' event
    // types per aggregate (one CH query, no eventTypes filter), so each
    // accumulator must drop events its projection doesn't accept. Without
    // this guard, a fold projection co-discovered with another projection
    // through a different event type would be fed events of types it never
    // declared and `apply()` would corrupt or crash.
    if (!this.eventTypeSet.has(event.type)) return;

    const projectionKey = this.projection.key?.(event) ?? event.aggregateId;
    const scopedKey = tenantScopedKey(event.tenantId, projectionKey);

    // ADR-022: Apply leanForProjection before the projection handler — same utility
    // as the live dispatch interposition, ensuring replay and live produce
    // byte-identical projection state.
    const leanedEvent = leanForProjection(event as unknown as Event) as unknown as ReplayEvent;

    const state = this.keyStates.get(scopedKey) ?? this.projection.init();
    const newState = this.projection.apply(state, leanedEvent);
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
 * buffers one output record per event along with the originating event's
 * `ProjectionStoreContext`. Records are grouped by tenantId and flushed in
 * bulk via `store.bulkAppend()` (or sequential `store.append()` as fallback);
 * the per-event context is preserved on the fallback path so stores keying
 * off `context.aggregateId` behave the same as the non-optimized replay.
 *
 * Map records are append-only and need no cross-page state, so `apply`
 * flushes incrementally: once the buffer reaches `writeBatchSize` the
 * buffered records are written immediately instead of deferring everything
 * to the final `flush()`. Memory is therefore bounded by `writeBatchSize`,
 * not by the number of events in an aggregate batch.
 */
interface BufferedMapRecord {
  record: any;
  context: ProjectionStoreContext;
}

export class MapAccumulator {
  private byTenant = new Map<string, BufferedMapRecord[]>();
  private bufferedCount = 0;
  private _processed = 0;
  private readonly eventTypeSet: Set<string>;
  private readonly writeBatchSize: number;

  constructor(
    private readonly projection: MapProjectionDefinition<any, any>,
    opts?: { writeBatchSize?: number },
  ) {
    this.eventTypeSet = new Set(projection.eventTypes);
    this.writeBatchSize = opts?.writeBatchSize ?? DEFAULT_WRITE_BATCH_SIZE;
  }

  get processed(): number {
    return this._processed;
  }

  async apply(event: ReplayEvent): Promise<void> {
    if (!this.eventTypeSet.has(event.type)) return;

    const record = this.projection.map(event as any);
    if (record === null) return;

    const context: ProjectionStoreContext = {
      aggregateId: event.aggregateId,
      tenantId: event.tenantId as unknown as TenantId,
    };

    let list = this.byTenant.get(event.tenantId);
    if (!list) {
      list = [];
      this.byTenant.set(event.tenantId, list);
    }
    list.push({ record, context });
    this.bufferedCount++;
    this._processed++;

    if (this.bufferedCount >= this.writeBatchSize) {
      await this.drain(this.writeBatchSize);
    }
  }

  async flush(writeBatchSize = this.writeBatchSize): Promise<void> {
    await this.drain(writeBatchSize);
  }

  private async drain(writeBatchSize: number): Promise<void> {
    if (this.byTenant.size === 0) return;

    // Snapshot + reset synchronously so concurrent `apply` calls (optimized
    // replay runs aggregates with concurrency) never double-write a buffer.
    const byTenant = this.byTenant;
    this.byTenant = new Map();
    this.bufferedCount = 0;

    const store = this.projection.store;

    for (const [_tenantId, entries] of byTenant) {
      if (store.bulkAppend) {
        // Group by aggregateId so each `bulkAppend` call gets a real
        // per-aggregate context. Stores that key off `context.aggregateId`
        // (rather than reading it from the record) then see the same value
        // they would on the non-optimized `append()` path.
        const byAggregate = new Map<string, BufferedMapRecord[]>();
        for (const entry of entries) {
          const key = entry.context.aggregateId;
          let list = byAggregate.get(key);
          if (!list) {
            list = [];
            byAggregate.set(key, list);
          }
          list.push(entry);
        }

        for (const aggregateEntries of byAggregate.values()) {
          const groupContext = aggregateEntries[0]!.context;
          for (let i = 0; i < aggregateEntries.length; i += writeBatchSize) {
            const chunk = aggregateEntries.slice(i, i + writeBatchSize).map((e) => e.record);
            await store.bulkAppend(chunk, groupContext);
          }
        }
      } else {
        // Sequential fallback: pass each record's original per-event context
        // so stores that key off `context.aggregateId` get the real value.
        for (const entry of entries) {
          await store.append(entry.record, entry.context);
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
