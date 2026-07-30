import { UndecodableStateError } from "../errors";
import { noopMetrics } from "../ports/metrics";
import type { Metrics } from "../ports/metrics";
import { withSpan } from "../ports/tracing";
import type { ReplaceStore, StoreContext, StoredState } from "./store.types";

/**
 * Executes a fold against its `ReplaceStore` (ADR-098 §3, §5, §6, §7).
 *
 * This is the one place a fold's read-decide-write cycle happens. Everything
 * it enforces exists because getting it wrong corrupts state silently rather
 * than failing loudly: reading `undecodable` as genesis overwrites live
 * aggregates, skipping the redelivery check double-applies a retried job, and
 * reading the event log here (which this module never does) would make a
 * "projection" secretly a second write path with its own consistency story.
 */

/**
 * One unit of work: a batch of events for one aggregate, plus the identity the
 * executor needs to tell a retry from a new delivery.
 *
 * `deliverySeq` is assigned when the job is staged onto the group, not derived
 * from anything about the events themselves — it is what lets the executor
 * recognise a redelivered job without inspecting event content.
 */
export interface FoldDelivery<Event> {
  readonly key: string;
  readonly tenantId: string;
  /** Monotonic per-group sequence assigned when the job was staged. */
  readonly deliverySeq: number;
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
 * `skipped-redelivery` is a distinct outcome, not a variant of `applied` with a
 * zero count, so a caller cannot mistake "nothing new happened" for "nothing
 * happened because this batch was empty" — the two have different operational
 * meanings and different alerting thresholds.
 */
export type FoldOutcome =
  | { readonly kind: "applied"; readonly events: number }
  | { readonly kind: "skipped-redelivery"; readonly deliverySeq: number };

/**
 * Builds the executor for one fold. One instance per projection: the metric
 * handles it resolves are shared across every delivery that projection
 * receives, which is why the projection name is fixed at construction rather
 * than passed per call.
 */
export function createFoldExecutor<State, Event>(
  deps: FoldExecutorDeps<State, Event>,
): { apply(delivery: FoldDelivery<Event>): Promise<FoldOutcome> } {
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
    async apply(delivery: FoldDelivery<Event>): Promise<FoldOutcome> {
      return withSpan(
        "es.fold.apply",
        { "es.projection": deps.projectionName, "es.key": delivery.key },
        async () => {
          const context: StoreContext = {
            tenantId: delivery.tenantId,
            retentionDays: delivery.retentionDays,
          };

          let read;
          try {
            read = await deps.store.read(delivery.key, context);
          } catch (error) {
            // Failures are counted on the same metric as successes, so the
            // denominator is every attempt. Counting only the outcomes that
            // returned would make a failing projection look like a quiet one:
            // its success rate would read 100% while its throughput fell to
            // nothing, which is the shape an alert cannot see.
            outcomes.inc({ projection: deps.projectionName, kind: "failed" });
            throw error;
          }

          if (read.kind === "undecodable") {
            outcomes.inc({
              projection: deps.projectionName,
              kind: "undecodable",
            });
            // The single most dangerous mistake available in this design: an
            // undecodable row is never genesis. Treating it as absent would
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

          if (
            read.kind === "found" &&
            read.stored.deliverySeq >= delivery.deliverySeq
          ) {
            outcomes.inc({
              projection: deps.projectionName,
              kind: "skipped-redelivery",
            });
            return {
              kind: "skipped-redelivery",
              deliverySeq: delivery.deliverySeq,
            };
          }

          let state: State;
          try {
            state = read.kind === "found" ? read.stored.state : deps.init();
            // The batch is applied in the order it arrived because it is one
            // unit of work, not because this asserts any ordering guarantee —
            // ordering across deliveries is best effort (ADR-098), and folds
            // must stay correct regardless of the order deliveries arrive in.
            for (const event of delivery.events) {
              state = deps.apply(state, event);
            }
          } catch (error) {
            // `apply` and `init` are the fold's own code and are expected to be
            // pure, but pure code still throws — a missing field, an assertion,
            // an event shape a later deploy introduced. Counted here for the
            // same reason as a store failure: if the only unlabelled failure in
            // this executor is the one in the domain logic, a fold that throws
            // on every delivery registers as a fold that stopped receiving
            // deliveries.
            outcomes.inc({ projection: deps.projectionName, kind: "failed" });
            throw error;
          }

          const stored: StoredState<State> = {
            state,
            deliverySeq: delivery.deliverySeq,
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
          return { kind: "applied", events: delivery.events.length };
        },
      );
    },
  };
}
