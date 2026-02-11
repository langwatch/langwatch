import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { createLogger } from "../../../../utils/logger/server";

/**
 * Cached checkpoint data stored in Redis.
 * Contains minimal information needed for ordering validation.
 */
export interface CachedCheckpoint {
  sequenceNumber: number;
  status: "pending" | "processed" | "failed";
  eventId: string;
  timestamp: number;
  processorType?: "handler" | "projection";
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
   * Stores the latest checkpoint for a checkpoint key (used by loadCheckpoint cache).
   * Uses field `latest` in the same hash key as sequence-based lookups.
   */
  async setByCheckpointKey(
    checkpointKey: string,
    checkpoint: CachedCheckpoint,
  ): Promise<void> {
    try {
      const key = this.buildRedisKey(checkpointKey);
      await this.redis.hset(
        key,
        "latest",
        JSON.stringify({
          sequenceNumber: checkpoint.sequenceNumber,
          status: checkpoint.status,
          eventId: checkpoint.eventId,
          timestamp: checkpoint.timestamp,
          processorType: checkpoint.processorType,
        }),
      );
      await this.redis.expire(key, 60 * 30);
    } catch (error) {
      this.logger.error(
        {
          checkpointKey,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to cache latest checkpoint in Redis",
      );
    }
  }

  /**
   * Retrieves the latest checkpoint for a checkpoint key (used by loadCheckpoint cache).
   */
  async getByCheckpointKey(
    checkpointKey: string,
  ): Promise<CachedCheckpoint | null> {
    try {
      const key = this.buildRedisKey(checkpointKey);
      const data = await this.redis.hget(key, "latest");

      if (!data) {
        return null;
      }

      return JSON.parse(data) as CachedCheckpoint;
    } catch (error) {
      this.logger.error(
        {
          checkpointKey,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to retrieve latest checkpoint from Redis cache",
      );
      return null;
    }
  }

  /**
   * Deletes the latest checkpoint cache entry for a checkpoint key.
   */
  async deleteByCheckpointKey(checkpointKey: string): Promise<void> {
    try {
      const key = this.buildRedisKey(checkpointKey);
      await this.redis.hdel(key, "latest");
    } catch (error) {
      this.logger.error(
        {
          checkpointKey,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to delete latest checkpoint from Redis cache",
      );
    }
  }

  /**
   * Stores the failure status for a checkpoint key.
   */
  async setFailureStatus(
    checkpointKey: string,
    hasFailed: boolean,
  ): Promise<void> {
    try {
      const key = this.buildFailureStatusKey(checkpointKey);
      await this.redis.set(key, hasFailed ? "true" : "false", "EX", 60 * 30);
    } catch (error) {
      this.logger.error(
        {
          checkpointKey,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to cache failure status in Redis",
      );
    }
  }

  /**
   * Retrieves the failure status for a checkpoint key.
   * Returns `true` if failed, `false` if not failed, `null` if not cached.
   */
  async getFailureStatus(checkpointKey: string): Promise<boolean | null> {
    try {
      const key = this.buildFailureStatusKey(checkpointKey);
      const data = await this.redis.get(key);

      if (data === null) {
        return null;
      }

      return data === "true";
    } catch (error) {
      this.logger.error(
        {
          checkpointKey,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to retrieve failure status from Redis cache",
      );
      return null;
    }
  }

  /**
   * Deletes the failure status cache entry for a checkpoint key.
   */
  async deleteFailureStatus(checkpointKey: string): Promise<void> {
    try {
      const key = this.buildFailureStatusKey(checkpointKey);
      await this.redis.del(key);
    } catch (error) {
      this.logger.error(
        {
          checkpointKey,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to delete failure status from Redis cache",
      );
    }
  }

  /**
   * Builds the Redis key for a checkpoint.
   * Format: event-sourcing:processor-checkpoint:{checkpointKey}
   */
  private buildRedisKey(checkpointKey: string): string {
    return `event-sourcing:processor-checkpoint:${checkpointKey}`;
  }

  /**
   * Builds the Redis key for failure status.
   * Format: event-sourcing:failure-status:{checkpointKey}
   */
  private buildFailureStatusKey(checkpointKey: string): string {
    return `event-sourcing:failure-status:${checkpointKey}`;
  }
}
