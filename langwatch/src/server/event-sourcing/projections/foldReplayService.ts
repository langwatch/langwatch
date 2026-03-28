import type { Redis } from "ioredis";
import { createLogger } from "~/utils/logger/server";
import { createTenantId } from "../domain/tenantId";
import type { TenantId } from "../domain/tenantId";
import type { Event } from "../domain/types";
import type { EventRepository } from "../stores/repositories/eventRepository.types";
import { recordToEvent } from "../stores/eventStoreUtils";
import type { FoldProjectionDefinition, FoldProjectionStore } from "./foldProjection.types";

const logger = createLogger("langwatch:event-sourcing:fold-replay");

export interface FoldReplayRequest {
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
}

/**
 * Rebuilds fold projection state from the event log.
 *
 * Reads ALL events for an aggregate, folds from init() through every event
 * in order, and writes the final state to the inner CH store (with durability
 * wait) and Redis cache.
 *
 * Used as a safety net when fire-and-forget CH writes fail. Since it replays
 * from init(), it's correct regardless of handler idempotency.
 */
export class FoldReplayService {
  constructor(
    private readonly eventRepository: EventRepository,
    private readonly redis: Redis,
  ) {}

  async replay<State>({
    projection,
    innerStore,
    request,
    redisKeyPrefix,
    ttlSeconds = 30,
  }: {
    /** Projection definition for init() + apply(). */
    projection: FoldProjectionDefinition<State, Event>;
    /** The inner (ClickHouse) store — bypasses the Redis cache for durable writes. */
    innerStore: FoldProjectionStore<State>;
    request: FoldReplayRequest;
    redisKeyPrefix: string;
    ttlSeconds?: number;
  }): Promise<State> {
    const { aggregateId, aggregateType, tenantId } = request;

    logger.info(
      { aggregateId, aggregateType, tenantId },
      "Replaying fold projection from event log",
    );

    // 1. Read all events for this aggregate
    const records = await this.eventRepository.getEventRecords(
      tenantId,
      aggregateType,
      aggregateId,
    );

    // 2. Fold from init through all events
    let state = projection.init();
    for (const record of records) {
      const event = recordToEvent<Event>(record, aggregateId);
      state = projection.apply(state, event);
    }

    // 3. Write to inner CH store directly (with durability wait — this is recovery)
    const context = {
      aggregateId,
      tenantId: createTenantId(tenantId) as TenantId,
    };
    await innerStore.store(state, context);

    // 4. Update Redis cache
    try {
      const key = `fold:${redisKeyPrefix}:${aggregateId}`;
      await this.redis.set(key, JSON.stringify(state), "EX", ttlSeconds);
    } catch (error) {
      logger.warn(
        { aggregateId, error: String(error) },
        "Failed to update Redis cache after replay",
      );
    }

    logger.info(
      { aggregateId, aggregateType, tenantId, eventCount: records.length },
      "Fold replay completed",
    );

    return state;
  }
}
