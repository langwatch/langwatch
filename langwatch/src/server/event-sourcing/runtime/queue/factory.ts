import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { connection } from "../../../redis";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
} from "../../library/queues";
import { EventSourcedQueueProcessorBullMq } from "./bullmq";
import { EventSourcedQueueProcessorMemory } from "./memory";

/**
 * Factory interface for creating queue processors.
 * Allows dependency injection for testing and explicit control over implementation.
 */
export interface QueueProcessorFactory {
  /**
   * Creates a queue processor based on the provided definition.
   * The factory decides which implementation (BullMQ or memory) to use.
   */
  create<Payload>(
    definition: EventSourcedQueueDefinition<Payload>,
  ): EventSourcedQueueProcessor<Payload>;
}

/**
 * Default factory implementation that auto-detects Redis availability.
 *
 * Automatically selects the appropriate implementation based on environment:
 * - BullMQ (production): If Redis is available, provides persistence, retries, and multi-worker support
 * - Memory (development/testing): If Redis is unavailable, provides in-memory queues for local development
 */
export class DefaultQueueProcessorFactory implements QueueProcessorFactory {
  constructor(private readonly redisConnection?: IORedis | Cluster) {}

  create<Payload>(
    definition: EventSourcedQueueDefinition<Payload>,
  ): EventSourcedQueueProcessor<Payload> {
    const effectiveConnection = this.redisConnection ?? connection;
    if (effectiveConnection) {
      return new EventSourcedQueueProcessorBullMq<Payload>(
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

  create<Payload>(
    definition: EventSourcedQueueDefinition<Payload>,
  ): EventSourcedQueueProcessor<Payload> {
    return new EventSourcedQueueProcessorBullMq<Payload>(
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
  create<Payload>(
    definition: EventSourcedQueueDefinition<Payload>,
  ): EventSourcedQueueProcessor<Payload> {
    return new EventSourcedQueueProcessorMemory<Payload>(definition);
  }
}

/**
 * Default factory instance that auto-detects Redis availability.
 */
export const defaultQueueProcessorFactory = new DefaultQueueProcessorFactory();
