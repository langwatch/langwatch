import type { Event } from "../domain/types";
import type { FoldProjectionDefinition } from "./foldProjection.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

/**
 * Executes a fold projection for an aggregate by replaying all events.
 *
 * Flow:
 * 1. `state = projection.init()`
 * 2. `for (event of events) state = projection.apply(state, event)`
 * 3. `projection.store.store(state, context)`
 *
 * The executor is stateless — it receives events and context each time.
 */
export class FoldProjectionExecutor {
  /**
   * Executes a fold projection by reducing all events into state and storing it.
   *
   * @param projection - The fold projection definition
   * @param events - All events for the aggregate, in chronological order
   * @param context - Store context with aggregateId and tenantId
   * @returns The computed state, or null if no events matched
   */
  async execute<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    events: readonly E[],
    context: ProjectionStoreContext,
  ): Promise<State | null> {
    if (events.length === 0) {
      return null;
    }

    let state = projection.init();

    for (const event of events) {
      if (projection.eventTypes.includes(event.type)) {
        state = projection.apply(state, event);
      }
    }

    await projection.store.store(state, context);

    return state;
  }
}
