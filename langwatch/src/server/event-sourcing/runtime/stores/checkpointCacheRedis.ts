import type { Cluster } from "ioredis";
import type IORedis from "ioredis";
import { createLogger } from "../../../../utils/logger";

/**
 * Cached checkpoint data stored in Redis.
 * Contains minimal information needed for ordering validation.
 */
export interface CachedCheckpoint {
  sequenceNumber: number;
  status: "pending" | "processed" | "failed";
  eventId: string;
  timestamp: number;
}

/**
 * Redis-based cache for processor checkpoints.
 * Provides immediate visibility of checkpoints after writes,
 * solving ClickHouse's eventual consistency lag with ReplacingMergeTree + FINAL.
 *
 * @example
 * ```typescript
 * const cache = new CheckpointCacheRedis(redisConnection);
 * await cache.set("checkpoint-key", {
 *   sequenceNumber: 10,
 *   status: "processed",
 *   eventId: "event-123",
 *   timestamp: Date.now(),
 * });
 * const checkpoint = await cache.get("checkpoint-key");
 * ```
 */
export class CheckpointCacheRedis {
  private readonly logger = createLogger(
    "langwatch:event-sourcing:checkpoint-cache:redis",
  );

  constructor(private readonly redis: IORedis | Cluster) {}

  /**
   * Stores a checkpoint in the cache.
   * TTL is set to 30 minutes.
   *
   * @param checkpointKey - The checkpoint key (e.g., "tenantId:pipeline:processor:type:aggregate")
   * @param checkpoint - The checkpoint data to cache
   */
  async set(
    checkpointKey: string,
    checkpoint: CachedCheckpoint,
  ): Promise<void> {
    try {
      const key = this.buildRedisKey(checkpointKey);
      await this.redis.hset(key, {
        sequenceNumber: checkpoint.sequenceNumber.toString(),
        status: checkpoint.status,
        eventId: checkpoint.eventId,
        timestamp: checkpoint.timestamp.toString(),
      });
      await this.redis.expire(key, 60 * 30);

      this.logger.debug(
        {
          checkpointKey,
          sequenceNumber: checkpoint.sequenceNumber,
          status: checkpoint.status,
        },
        "Cached checkpoint in Redis",
      );
    } catch (error) {
      // Cache failures should not break checkpoint storage
      // Log error but don't throw
      this.logger.error(
        {
          checkpointKey,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : void 0,
        },
        "Failed to cache checkpoint in Redis",
      );
    }
  }

  /**
   * Retrieves a checkpoint from the cache.
   *
   * @param checkpointKey - The checkpoint key to retrieve
   * @returns The cached checkpoint, or null if not found
   */
  async get(checkpointKey: string): Promise<CachedCheckpoint | null> {
    try {
      const key = this.buildRedisKey(checkpointKey);
      const data = await this.redis.hgetall(key);

      if (!data.sequenceNumber) {
        this.logger.debug({ checkpointKey }, "Checkpoint not found in cache");
        return null;
      }

      const checkpoint: CachedCheckpoint = {
        sequenceNumber: parseInt(data.sequenceNumber, 10),
        status: (data.status as CachedCheckpoint["status"]) ?? "pending",
        eventId: data.eventId ?? "",
        timestamp: parseInt(data.timestamp ?? "0", 10),
      };

      this.logger.debug(
        {
          checkpointKey,
          sequenceNumber: checkpoint.sequenceNumber,
          status: checkpoint.status,
        },
        "Retrieved checkpoint from cache",
      );

      return checkpoint;
    } catch (error) {
      // Cache read failures should not break checkpoint lookups
      // Log error and return null to fallback to ClickHouse
      this.logger.error(
        {
          checkpointKey,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : void 0,
        },
        "Failed to retrieve checkpoint from Redis cache",
      );
      return null;
    }
  }

  /**
   * Builds the Redis key for a checkpoint.
   * Format: event-sourcing:processor-checkpoint:{checkpointKey}
   */
  private buildRedisKey(checkpointKey: string): string {
    return `event-sourcing:processor-checkpoint:${checkpointKey}`;
  }
}
