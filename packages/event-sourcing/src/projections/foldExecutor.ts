import { UndecodableStateError } from "../errors";
import type { Metrics } from "../ports/metrics";
import { noopMetrics } from "../ports/metrics";
import { withSpan } from "../ports/tracing";
import type { ReplaceStore, StoreContext, StoredState } from "./store.types";

/**
 * Executes a fold against its `ReplaceStore` (ADR-098 §3, §6, §7).
 *
 * This is the one place a fold's read-decide-write cycle happens. Nothing here
 * guards against redelivery: a fold is a function of the set of events it has
 * seen, so applying the same delivery twice reaches the same state (ADR-098
 * §5). `checkOrderInvariance` is where that property is enforced.
 */

/** One unit of work: a batch of events for one aggregate. */
export interface FoldDelivery<Event> {
  readonly key: string;
  readonly tenantId: string;
  readonly events: readonly Event[];
  readonly retentionDays?: number;
}

/** What one fold needs wired in to run: its store and its pure state machine. */
export interface FoldExecutorDeps<State, Event> {
  readonly store: ReplaceStore<State>;
  readonly init: () => State;
  readonly apply: (state: State, event: Event) => State;
  readonly stateVersion: string;
  readonly projectionName: string;
  readonly metrics?: Metrics;
}

/**
 * Builds the executor for one fold. One instance per projection: the metric
 * handles it resolves are shared across every delivery that projection
 * receives, which is why the projection name is fixed at construction rather
 * than passed per call.
 */
export function createFoldExecutor<State, Event>(
  deps: FoldExecutorDeps<State, Event>,
): { apply(delivery: FoldDelivery<Event>): Promise<{ events: number }> } {
  const metrics = deps.metrics ?? noopMetrics;
  const outcomes = metrics.counter({
    name: "es_fold_apply_outcomes_total",
    help: "Fold executor outcomes, by projection and kind.",
    labelNames: ["projection", "kind"],
  });
  const batchSize = metrics.histogram({
    name: "es_fold_apply_batch_size",
    help: "Number of events applied per fold delivery, by projection.",
    labelNames: ["projection"],
  });

  return {
    async apply(delivery: FoldDelivery<Event>): Promise<{ events: number }> {
      return withSpan(
        "es.fold.apply",
        { "es.projection": deps.projectionName, "es.key": delivery.key },
        async () => {
          const context: StoreContext = {
            tenantId: delivery.tenantId,
            retentionDays: delivery.retentionDays,
          };

          let read: Awaited<ReturnType<typeof deps.store.read>>;
          try {
            read = await deps.store.read(delivery.key, context);
          } catch (error) {
            // Failures land on the same counter as successes, so the
            // denominator is every attempt: otherwise a projection whose store
            // is down reads as one that is merely quiet.
            outcomes.inc({ projection: deps.projectionName, kind: "failed" });
            throw error;
          }

          if (read.kind === "undecodable") {
            outcomes.inc({
              projection: deps.projectionName,
              kind: "undecodable",
            });
            // An undecodable row is never genesis. Treating it as absent would
            // fold the next event onto a fresh accumulator and write that over
            // live state, so the first deploy that changed this fold's shape
            // would silently reset every aggregate it touched.
            throw new UndecodableStateError({
              projectionName: deps.projectionName,
              aggregateId: delivery.key,
              storedVersion: read.storedVersion,
              expectedVersion: deps.stateVersion,
              cause: read.cause,
            });
          }

          let state: State;
          try {
            state = read.kind === "found" ? read.stored.state : deps.init();
            // Applied in arrival order because the batch is one unit of work,
            // not because any order is guaranteed (ADR-098).
            for (const event of delivery.events) {
              state = deps.apply(state, event);
            }
          } catch (error) {
            // The fold's own code throws too, and it is counted for the same
            // reason a store failure is.
            outcomes.inc({ projection: deps.projectionName, kind: "failed" });
            throw error;
          }

          const stored: StoredState<State> = {
            state,
            version: deps.stateVersion,
          };
          try {
            await deps.store.write(delivery.key, stored, context);
          } catch (error) {
            outcomes.inc({ projection: deps.projectionName, kind: "failed" });
            throw error;
          }

          outcomes.inc({ projection: deps.projectionName, kind: "applied" });
          batchSize.observe(delivery.events.length, {
            projection: deps.projectionName,
          });
          return { events: delivery.events.length };
        },
      );
    },
  };
}
