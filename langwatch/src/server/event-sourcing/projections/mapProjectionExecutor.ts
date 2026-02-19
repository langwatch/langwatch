import type { Event } from "../domain/types";
import type { MapProjectionDefinition } from "./mapProjection.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

/**
 * Executes a map projection for a single event.
 *
 * Flow:
 * 1. `record = projection.map(event)`
 * 2. If record is not null: `projection.store.append(record, context)`
 *
 * The executor is stateless — each event is processed independently.
 */
export class MapProjectionExecutor {
  /**
   * Executes a map projection for a single event.
   *
   * @param projection - The map projection definition
   * @param event - The event to transform
   * @param context - Store context with aggregateId and tenantId
   * @returns The mapped record, or null if the map function returned null
   */
  async execute<Record, E extends Event>(
    projection: MapProjectionDefinition<Record, E>,
    event: E,
    context: ProjectionStoreContext,
  ): Promise<Record | null> {
    const record = projection.map(event);

    if (record === null) {
      return null;
    }

    await projection.store.append(record, context);

    return record;
  }
}
