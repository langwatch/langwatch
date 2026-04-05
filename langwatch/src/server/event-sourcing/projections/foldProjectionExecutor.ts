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
    let state = await projection.store.get(key, context) ?? projection.init();

    // Capture the highest occurredAt before applying the new event
    const prevLastOccurred = (state as Record<string, unknown>).LastEventOccurredAt
      ?? (state as Record<string, unknown>).lastEventOccurredAt
      ?? 0;

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
        state = projection.apply(state, e);
      }
    }

    await projection.store.store(state, context);
    return state;
  }

  private matchesEventTypes<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    event: E,
  ): boolean {
    return projection.eventTypes.length === 0 || projection.eventTypes.includes(event.type);
  }
}
