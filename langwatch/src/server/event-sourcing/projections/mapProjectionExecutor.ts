import { createLogger } from "@langwatch/telemetry";
import type { Event } from "../domain/types";
import type { MapProjectionDefinition } from "./mapProjection.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

const logger = createLogger("langwatch:event-sourcing:map-executor");

/**
 * Executes a map projection for a single event.
 *
 * Flow:
 * 1. If `options.dedupeByIdempotencyKey` and the event is a duplicate
 *    delivery of an earlier event with the same idempotency key → skip
 * 2. `record = projection.map(event)`
 * 3. If record is not null: `projection.store.append(record, context)`
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
   *          or the event was skipped as a duplicate delivery
   */
  async execute<Record, E extends Event>(
    projection: MapProjectionDefinition<Record, E>,
    event: E,
    context: ProjectionStoreContext,
  ): Promise<Record | null> {
    if (
      projection.options?.dedupeByIdempotencyKey &&
      (await this.isDuplicateDelivery(projection, event, context))
    ) {
      return null;
    }

    const record = projection.map(event);

    if (record === null) {
      return null;
    }

    await projection.store.append(record, context);

    return record;
  }

  /**
   * Whether `event` is a duplicate delivery: an EARLIER event in the
   * aggregate's log holds the same idempotency key. The history read
   * (`eventLoaderUpTo`) applies the store's first-occurrence dedup, so the
   * surviving holder of the key IS the first occurrence — if that isn't
   * this event, this event is a duplicate.
   *
   * Fail-open on both "no key" and "key holder not visible" (event-log
   * read lag): the event maps normally, so the worst case is the transient
   * over-count the additive sink already tolerates — never an undercount.
   * A failed history read propagates so the queue retries the delivery.
   */
  private async isDuplicateDelivery<Record, E extends Event>(
    projection: MapProjectionDefinition<Record, E>,
    event: E,
    context: ProjectionStoreContext,
  ): Promise<boolean> {
    const key = event.idempotencyKey;
    if (!key || !projection.eventLoaderUpTo) return false;

    const history = await projection.eventLoaderUpTo({
      tenantId: context.tenantId,
      aggregateId: context.aggregateId,
      upToEvent: event,
    });
    const holder = history.find((e) => e.idempotencyKey === key);
    const isDuplicate = holder !== undefined && holder.id !== event.id;

    if (isDuplicate) {
      logger.info(
        {
          projection: projection.name,
          aggregateId: context.aggregateId,
          tenantId: context.tenantId,
          eventId: event.id,
          firstEventId: holder.id,
          idempotencyKey: key,
        },
        "Skipping duplicate delivery — idempotency key already held by an earlier event",
      );
    }

    return isDuplicate;
  }
}
