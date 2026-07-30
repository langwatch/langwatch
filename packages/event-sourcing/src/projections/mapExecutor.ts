/**
 * Executes a map projection (ADR-098 §2, ADR-100).
 *
 * A map has no accumulator: each event independently produces zero or more
 * records, and there is nothing to read back. That makes the whole delivery a
 * pure fan-out followed by one write, unlike a fold's read-apply-write cycle.
 *
 * Batching is the primary path, not an optimisation. One `writeBatch` call per
 * event is what creates a part per event in a column store, and that shape has
 * already caused an incident — so this executor always flattens a delivery's
 * events down to one write.
 */

import type { Metrics } from "../ports/metrics";
import { noopMetrics } from "../ports/metrics";
import { withSpan } from "../ports/tracing";
import type { AppendStore, MergeStore } from "./store.types";

/**
 * `Array.isArray` alone does not narrow a generic `Record | readonly Record[]`
 * union in the `else` branch — the type parameter could itself be an array
 * type, so TypeScript keeps both arms live. An explicit type predicate over
 * the same generic tells it what the runtime check already guarantees.
 */
function isRecordArray<Record>(
  value: Record | readonly Record[],
): value is readonly Record[] {
  return Array.isArray(value);
}

/** One delivery of events for a map projection, all belonging to one tenant. */
export interface MapDelivery<Event> {
  readonly tenantId: string;
  readonly events: readonly Event[];
  readonly retentionDays?: number;
}

/** What a map executor needs at construction: the store, the mapping, identity. */
export interface MapExecutorDeps<Event, Record> {
  readonly store: AppendStore<Record> | MergeStore<Record>;
  /**
   * Pure projection from one event to zero, one, or many records. Never
   * instrumented — a span around a pure computation costs more than it
   * explains, and this function may run once per event in a large delivery.
   */
  readonly map: (event: Event) => Record | readonly Record[] | null;
  readonly projectionName: string;
  readonly metrics?: Metrics;
}

/**
 * Builds the executor for a map projection.
 *
 * A `merge` store is not idempotent under redelivery (ADR-098 §2): the engine
 * adds rather than replaces, so a redelivered batch changes the answer. Fixing
 * that is not this executor's job — the store declares its `idempotency` story
 * and the mount checks it — but every write against a `merge` store is counted
 * separately by store kind, so a merge-backed map stays visible in operations
 * rather than only in a migration file.
 */
export function createMapExecutor<Event, Record>(
  deps: MapExecutorDeps<Event, Record>,
): { apply(delivery: MapDelivery<Event>): Promise<{ written: number }> } {
  // Defaulted to a no-op rather than left optional, for the reason `noopMetrics`
  // exists: `metrics?.inc(...)` at each call site is a line someone eventually
  // writes without the `?`, or forgets entirely, and the result is a gap in a
  // dashboard rather than a failure.
  const metrics = deps.metrics ?? noopMetrics;
  const writeCounter = metrics.counter({
    name: "es_map_write_batch_total",
    help: "Map projection batch writes, by projection, store kind and outcome.",
    labelNames: ["projection", "storeKind", "outcome"],
  });
  const recordsHistogram = metrics.histogram({
    name: "es_map_records_written",
    help: "Records written per map projection batch, by store kind.",
    labelNames: ["projection", "storeKind"],
  });

  return {
    async apply(delivery: MapDelivery<Event>): Promise<{ written: number }> {
      const records: Record[] = [];
      for (const event of delivery.events) {
        const mapped = deps.map(event);
        if (mapped === null) continue;
        if (isRecordArray(mapped)) {
          records.push(...mapped);
        } else {
          records.push(mapped);
        }
      }

      const labels = {
        projection: deps.projectionName,
        storeKind: deps.store.kind,
      };

      if (records.length === 0) {
        writeCounter.inc({ ...labels, outcome: "empty" });
        recordsHistogram.observe(0, labels);
        return { written: 0 };
      }

      try {
        await withSpan(
          "es.map.write",
          {
            "es.projection": deps.projectionName,
            "es.store_kind": deps.store.kind,
            "es.record_count": records.length,
          },
          async () => {
            await deps.store.writeBatch(records, {
              tenantId: delivery.tenantId,
              retentionDays: delivery.retentionDays,
            });
          },
        );
      } catch (error) {
        // Counted on the same metric as a success, so the denominator is every
        // attempt — the same rule `foldExecutor` states. A counter that only
        // moves when the write landed makes a projection whose store is down
        // look like a quiet one: its success rate reads 100% while its
        // throughput falls to nothing, which is the shape an alert cannot see.
        writeCounter.inc({ ...labels, outcome: "failed" });
        throw error;
      }

      writeCounter.inc({ ...labels, outcome: "written" });
      recordsHistogram.observe(records.length, labels);

      return { written: records.length };
    },
  };
}
