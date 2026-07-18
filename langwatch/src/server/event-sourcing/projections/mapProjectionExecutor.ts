import { createLogger } from "@langwatch/observability";
import type { Event } from "../domain/types";
import type {
  BulkAppendContext,
  MapProjectionDefinition,
} from "./mapProjection.types";
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
   * Maps a same-tenant queue batch and persists it with ONE `bulkAppend` call.
   *
   * `bulkAppend` is required, not preferred. Queue delivery is at-least-once:
   * a batch that throws part-way is re-dispatched in full, so persistence has
   * to be all-or-nothing for the retry to be safe. A per-record `append` loop
   * would commit records 1..N, fail on N+1, and duplicate that prefix on the
   * retry — and map projections write to additive stores, where a duplicate is
   * an extra row rather than an overwrite. `ProjectionRouter` enforces this by
   * refusing to enable coalescing for a store without `bulkAppend`; the throw
   * below is the backstop for any other caller.
   */
  async executeBatch<Record, E extends Event>(
    projection: MapProjectionDefinition<Record, E>,
    events: readonly E[],
    contexts: readonly ProjectionStoreContext[],
  ): Promise<Array<{ event: E; record: Record }>> {
    if (events.length !== contexts.length) {
      throw new Error("Map projection batch events and contexts must align");
    }

    const bulkAppend = projection.store.bulkAppend;
    if (!bulkAppend) {
      throw new Error(
        `Map projection "${projection.name}" cannot be batched: its store has no bulkAppend, and a partially-committed batch would duplicate records when the queue retries it`,
      );
    }

    const mapped: Array<{
      event: E;
      record: Record;
      context: ProjectionStoreContext;
    }> = [];
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

    if (mapped.length === 0) return [];

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
    await bulkAppend.call(
      projection.store,
      mapped.map(({ record }) => record),
      bulkContext,
    );

    return mapped.map(({ event, record }) => ({ event, record }));
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
