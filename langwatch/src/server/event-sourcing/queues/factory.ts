import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { connection } from "../../redis";
import type {
    EventSourcedQueueDefinition,
    EventSourcedQueueProcessor,
    QueueProcessorFactory,
} from "../queues";
import { GroupQueueProcessorBullMq } from "./groupQueue/groupQueue";
import { EventSourcedQueueProcessorMemory } from "./memory";
import { SimpleBullmqQueueProcessor } from "./simpleBullmq";

/**
 * Default factory implementation that auto-detects Redis availability.
 *
 * Automatically selects the appropriate implementation based on environment:
 * - BullMQ (production): If Redis is available, provides persistence, retries, and multi-worker support
 * - Memory (development/testing): If Redis is unavailable, provides in-memory queues for local development
 */
export class DefaultQueueProcessorFactory implements QueueProcessorFactory {
  constructor(private readonly redisConnection?: IORedis | Cluster | null) {}

  create<Payload extends Record<string, unknown>>(
    definition: EventSourcedQueueDefinition<Payload>,
  ): EventSourcedQueueProcessor<Payload> {
    const effectiveConnection = this.redisConnection ?? connection;
    if (effectiveConnection) {
      if (definition.groupKey) {
        return new GroupQueueProcessorBullMq<Payload>(
          definition,
          effectiveConnection,
        );
      }
      return new SimpleBullmqQueueProcessor<Payload>(
        definition,
        effectiveConnection,
      );
    }
    return new EventSourcedQueueProcessorMemory<Payload>(definition);
  }
}

/**
 * Factory that always creates BullMQ implementations.
 * Throws an error if Redis is not available.
 */
export class BullmqQueueProcessorFactory implements QueueProcessorFactory {
  constructor(private readonly redisConnection?: IORedis | Cluster) {}

  create<Payload extends Record<string, unknown>>(
    definition: EventSourcedQueueDefinition<Payload>,
  ): EventSourcedQueueProcessor<Payload> {
    if (definition.groupKey) {
      return new GroupQueueProcessorBullMq<Payload>(
        definition,
        this.redisConnection,
      );
    }
    return new SimpleBullmqQueueProcessor<Payload>(
      definition,
      this.redisConnection,
    );
  }
}

/**
 * Factory that always creates memory implementations.
 * Useful for testing or environments without Redis.
 */
export class MemoryQueueProcessorFactory implements QueueProcessorFactory {
  create<Payload extends Record<string, unknown>>(
    definition: EventSourcedQueueDefinition<Payload>,
  ): EventSourcedQueueProcessor<Payload> {
    return new EventSourcedQueueProcessorMemory<Payload>(definition);
  }
}

/**
 * Default factory instance that auto-detects Redis availability.
 */
export const defaultQueueProcessorFactory = new DefaultQueueProcessorFactory();
