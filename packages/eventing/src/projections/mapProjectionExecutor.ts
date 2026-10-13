import { createLogger } from "@langwatch/observability";

import type { Event } from "../domain/types.ts";
import type { BulkAppendContext, MapProjectionDefinition } from "./mapProjection.types.ts";
import type { ProjectionStoreContext } from "./projectionStoreContext.ts";

const logger = createLogger("langwatch:event-sourcing:map-executor");

/**
 * Executes a map projection for a single event. Stateless; each event is
 * processed independently.
 */
export class MapProjectionExecutor {
  /**
   * Transforms an event into a record; returns null if skipped as duplicate
   * or if map() returned null.
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
   * Maps a same-tenant queue batch and persists it with one store operation
   * when the projection exposes `bulkAppend`.
   */
  async executeBatch<Record, E extends Event>(
    projection: MapProjectionDefinition<Record, E>,
    events: readonly E[],
    contexts: readonly ProjectionStoreContext[],
  ): Promise<{ event: E; record: Record }[]> {
    if (events.length !== contexts.length) {
      throw new Error("Map projection batch events and contexts must align");
    }

    const mapped = await this.mapBatchItems(projection, events, contexts);
    if (mapped.length === 0) return [];

    await this.persistMappedBatch(projection, mapped);

    return mapped.map(({ event, record }) => ({ event, record }));
  }

  /** Maps each event in a batch, skipping duplicate deliveries and null records. */
  private async mapBatchItems<Record, E extends Event>(
    projection: MapProjectionDefinition<Record, E>,
    events: readonly E[],
    contexts: readonly ProjectionStoreContext[],
  ): Promise<{ event: E; record: Record; context: ProjectionStoreContext }[]> {
    const mapped: {
      event: E;
      record: Record;
      context: ProjectionStoreContext;
    }[] = [];
    for (let index = 0; index < events.length; index++) {
      const event = events[index]!;
      const context = contexts[index]!;
      if (
        projection.options?.dedupeByIdempotencyKey &&
        (await this.isDuplicateDelivery(projection, event, context))
      ) {
        continue;
      }
      const record = projection.map(event);
      if (record !== null) mapped.push({ event, record, context });
    }
    return mapped;
  }

  /** Persists a mapped batch, via `bulkAppend` when the store exposes one. */
  private async persistMappedBatch<Record, E extends Event>(
    projection: MapProjectionDefinition<Record, E>,
    mapped: { event: E; record: Record; context: ProjectionStoreContext }[],
  ): Promise<void> {
    if (projection.store.bulkAppend) {
      const first = mapped[0]!.context;
      const bulkContext: BulkAppendContext = {
        tenantId: first.tenantId,
        retentionPolicy: first.retentionPolicy,
      };
      for (const item of mapped) {
        if (item.context.tenantId !== bulkContext.tenantId) {
          throw new Error("Map projection batches cannot cross tenants");
        }
      }
      await projection.store.bulkAppend(
        mapped.map(({ record }) => record),
        bulkContext,
      );
    } else {
      for (const { record, context } of mapped) {
        await projection.store.append(record, context);
      }
    }
  }

  /**
   * Whether this event is a duplicate delivery: an earlier event holds the
   * same idempotency key. Fails open on key-holder lag (worst case: transient
   * over-count, never undercount).
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
