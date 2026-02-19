import type { Event } from "../domain/types";
import type { FoldProjectionDefinition } from "./foldProjection.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

/**
 * Executes a fold projection incrementally by applying a single event to existing state.
 *
 * Flow:
 * 1. Load existing state via `store.get()` (or `init()` if none)
 * 2. `state = projection.apply(state, event)`
 * 3. `projection.store.store(state, context)`
 *
 * The executor is stateless — it receives event and context each time.
 */
export class FoldProjectionExecutor {
  /**
   * Executes an incremental fold projection by applying a single event to existing state.
   *
   * Loads the current stored state (or initializes if none exists), applies the
   * single event, and stores the result.
   *
   * @param projection - The fold projection definition
   * @param event - The single event to apply
   * @param context - Store context with aggregateId, tenantId, and optional key
   * @returns The updated state
   */
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

    state = projection.apply(state, event);
    await projection.store.store(state, context);
    return state;
  }

  /**
   * Checks if an event matches the projection's eventTypes filter.
   * Empty eventTypes array means "all events".
   */
  private matchesEventTypes<State, E extends Event>(
    projection: FoldProjectionDefinition<State, E>,
    event: E,
  ): boolean {
    return projection.eventTypes.length === 0 || projection.eventTypes.includes(event.type);
  }
}
