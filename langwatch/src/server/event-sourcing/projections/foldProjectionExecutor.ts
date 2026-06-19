import { createLogger } from "~/utils/logger/server";
import type { Event } from "../domain/types";
import type { FoldProjectionDefinition } from "./foldProjection.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

const logger = createLogger("langwatch:event-sourcing:fold-executor");

/**
 * Executes a fold projection incrementally by applying a single event to existing state.
 *
 * Flow:
 * 1. Load existing state via `store.get()` (or `init()` if none)
 * 2. `state = projection.apply(state, event)`
 * 3. If out-of-order detected and `eventLoader` available → re-fold from scratch
 * 4. `projection.store.store(state, context)`
 *
 * Out-of-order detection: compares event.occurredAt against the state's
 * LastEventOccurredAt (tracked by AbstractFoldProjection). If the event
 * occurred earlier than what we've already seen, all events are re-loaded
 * in occurredAt order and replayed from init().
 */
export class FoldProjectionExecutor {
  async execute<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    event: E,
    context: ProjectionStoreContext,
  ): Promise<State> {
    if (!this.matchesEventTypes(projection, event)) {
      return projection.init();
    }

    const key = context.key ?? context.aggregateId;
    let state = (await projection.store.get(key, context)) ?? projection.init();

    // Capture the highest occurredAt before applying the new event.
    const prevLastOccurred =
      (state as Record<string, unknown>)[projection.LastEventOccurredAtKey] ??
      0;

    state = projection.apply(state, event);

    // Detect out-of-order: event's occurredAt is STRICTLY LESS than what we've already seen.
    // Same occurredAt (==) does NOT trigger re-fold — arrival order is the correct
    // tiebreaker for events at the same logical instant (e.g., SDK sends snapshot and
    // finished with identical occurredAt). The +1 on UpdatedAt in apply() guarantees
    // distinct ClickHouse rows regardless.
    const eventOccurredAt = (event as Record<string, unknown>).occurredAt;
    if (
      typeof eventOccurredAt === "number" &&
      eventOccurredAt > 0 &&
      typeof prevLastOccurred === "number" &&
      eventOccurredAt < prevLastOccurred
    ) {
      if (!projection.eventLoader) {
        logger.warn(
          { projection: projection.name, aggregateId: context.aggregateId },
          "Out-of-order event detected but no eventLoader available — cannot re-fold",
        );
        await projection.store.store(state, context);
        return state;
      }
      const allEvents = await projection.eventLoader({
        tenantId: context.tenantId,
        aggregateId: context.aggregateId,
        occurredAtMs:
          typeof eventOccurredAt === "number" ? eventOccurredAt : undefined,
      });

      logger.info(
        {
          projection: projection.name,
          aggregateId: context.aggregateId,
          tenantId: context.tenantId,
          eventType: event.type,
          eventOccurredAt,
          prevLastOccurred,
          refoldEventCount: allEvents.length,
        },
        "Out-of-order event detected, re-folding from scratch",
      );

      state = projection.init();
      for (const e of allEvents) {
        state = projection.apply(state, e as E);
      }
    }

    await projection.store.store(state, context);
    return state;
  }

  /**
   * Applies a batch of events for the same aggregate in a single load/store cycle.
   *
   * Equivalent to calling `execute()` once per event, but reads the existing
   * state once, folds every event in occurredAt order, and writes the result
   * once. This turns a backed-up group of N events from N load+store round-trips
   * (O(n²) on growing fold state) into a single one (O(n)).
   *
   * Out-of-order handling matches `execute()`: if the earliest event in the
   * batch occurred before the persisted checkpoint, the aggregate is re-folded
   * from scratch via `eventLoader` (when available).
   */
  async executeBatch<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    events: E[],
    context: ProjectionStoreContext,
  ): Promise<State> {
    const matching = events.filter((event) =>
      this.matchesEventTypes(projection, event),
    );
    if (matching.length === 0) {
      return projection.init();
    }
    if (matching.length === 1) {
      return this.execute(projection, matching[0]!, context);
    }

    // Process in occurredAt order so the fold sees events as they happened,
    // regardless of the order they were dispatched/drained in.
    const ordered = [...matching].sort(
      (a, b) =>
        (((a as Record<string, unknown>).occurredAt as number) ?? 0) -
        (((b as Record<string, unknown>).occurredAt as number) ?? 0),
    );

    const key = context.key ?? context.aggregateId;
    let state = (await projection.store.get(key, context)) ?? projection.init();

    const prevLastOccurred =
      (state as Record<string, unknown>)[projection.LastEventOccurredAtKey] ??
      0;
    const earliestOccurredAt = (ordered[0] as Record<string, unknown>)
      .occurredAt;

    // Out-of-order vs the persisted checkpoint: the batch starts earlier than
    // what we've already folded. Re-fold from scratch when we can load the full
    // history; otherwise fall through and apply the batch on top (matches the
    // single-event executor's degraded behavior when no eventLoader exists).
    const outOfOrder =
      typeof earliestOccurredAt === "number" &&
      earliestOccurredAt > 0 &&
      typeof prevLastOccurred === "number" &&
      earliestOccurredAt < prevLastOccurred;

    if (outOfOrder && projection.eventLoader) {
      const allEvents = await projection.eventLoader({
        tenantId: context.tenantId,
        aggregateId: context.aggregateId,
        occurredAtMs:
          typeof earliestOccurredAt === "number"
            ? earliestOccurredAt
            : undefined,
      });
      logger.info(
        {
          projection: projection.name,
          aggregateId: context.aggregateId,
          tenantId: context.tenantId,
          batchSize: ordered.length,
          earliestOccurredAt,
          prevLastOccurred,
          refoldEventCount: allEvents.length,
        },
        "Out-of-order batch detected, re-folding from scratch",
      );
      state = projection.init();
      for (const e of allEvents) {
        state = projection.apply(state, e as E);
      }
    } else {
      if (outOfOrder) {
        logger.warn(
          { projection: projection.name, aggregateId: context.aggregateId },
          "Out-of-order batch detected but no eventLoader available — cannot re-fold",
        );
      }
      for (const event of ordered) {
        state = projection.apply(state, event);
      }
    }

    await projection.store.store(state, context);
    return state;
  }

  private matchesEventTypes<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    event: E,
  ): boolean {
    return (
      projection.eventTypes.length === 0 ||
      projection.eventTypes.includes(event.type)
    );
  }
}
