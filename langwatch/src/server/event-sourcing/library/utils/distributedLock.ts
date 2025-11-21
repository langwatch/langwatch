import { z } from "zod";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

/**
 * Distributed lock interface for preventing concurrent operations on the same resource.
 *
 * Used to prevent race conditions when multiple workers update projections for the same aggregate.
 * Without distributed locking, concurrent updates may result in lost updates (last write wins).
 */
export interface DistributedLock {
  /**
   * Acquires a lock for the given key.
   *
   * @param key - The lock key (e.g., "update:aggregateType:aggregateId:projectionName")
   * @param ttlMs - Time-to-live in milliseconds. Lock will be released after this time even if not explicitly released.
   *   Prevents locks from being held indefinitely if a process crashes.
   * @returns A lock handle that must be used to release the lock, or null if lock could not be acquired.
   */
  acquire(key: string, ttlMs: number): Promise<LockHandle | null>;

  /**
   * Releases a lock using the handle returned from acquire().
   *
   * @param handle - The lock handle returned from acquire()
   */
  release(handle: LockHandle): Promise<void>;
}

/**
 * Zod schema for lock handle.
 * Lock handles contain the key and a unique value to prevent releasing locks acquired by other processes.
 */
export const LockHandleSchema = z.object({
  key: z.string(),
  value: z.string(),
});

/**
 * Handle returned from lock acquisition, required to release the lock.
 * Contains the lock key and a unique value to ensure only the acquiring process can release it.
 */
export type LockHandle = z.infer<typeof LockHandleSchema>;


/**
 * In-memory lock implementation for single-instance deployments.
 * WARNING: This does NOT work across multiple instances. Use RedisDistributedLock for multi-instance deployments.
 */
export class InMemoryDistributedLock implements DistributedLock {
  private readonly locks = new Map<
    string,
    { value: string; expiresAt: number }
  >();
  private cleanupInterval?: NodeJS.Timeout;
  private readonly tracer = getLangWatchTracer(
    "langwatch.event-sourcing.distributed-lock",
  );

  constructor() {
    // Periodic cleanup prevents memory leaks from expired locks that were never explicitly released
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, lock] of this.locks.entries()) {
        if (lock.expiresAt < now) {
          this.locks.delete(key);
        }
      }
    }, 5000);
  }

  async acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    return await this.tracer.withActiveSpan(
      "DistributedLock.acquire",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "lock.key": key,
          "lock.ttl_ms": ttlMs,
          "lock.type": "in-memory",
        },
      },
      async (span) => {
        const now = Date.now();
        const existing = this.locks.get(key);

        if (existing && existing.expiresAt > now) {
          span.setAttributes({
            "lock.acquired": false,
          });
          return null;
        }

        // Unique value ensures only the acquiring process can release the lock
        const value = `${Date.now()}-${Math.random()}`;
        this.locks.set(key, {
          value,
          expiresAt: now + ttlMs,
        });

        span.setAttributes({
          "lock.acquired": true,
          "lock.value": value,
        });

        return { key, value };
      },
    );
  }

  async release(handle: LockHandle): Promise<void> {
    return await this.tracer.withActiveSpan(
      "DistributedLock.release",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "lock.key": handle.key,
          "lock.type": "in-memory",
        },
      },
      async (span) => {
        const existing = this.locks.get(handle.key);
        const released =
          existing !== undefined && existing.value === handle.value;
        if (released) {
          this.locks.delete(handle.key);
        }
        span.setAttributes({
          "lock.released": released,
        });
      },
    );
  }

  /**
   * Cleans up resources. Should be called when the lock is no longer needed.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = void 0;
    }
    this.locks.clear();
  }
}

/**
 * Redis client interface for distributed locking.
 * Compatible with ioredis, node-redis, and other Redis clients that support these methods.
 */
export interface RedisClient {
  /**
   * Sets a key with options. Should support NX (only if not exists) and EX (expiration in seconds).
   * Returns "OK" if successful, null if key already exists (with NX).
   */
  set(
    key: string,
    value: string,
    options: { NX: boolean; EX: number },
  ): Promise<string | null>;
  /**
   * Deletes a key. Returns number of keys deleted.
   */
  del(key: string): Promise<number>;
  /**
   * Gets a key value. Used for Lua script-based release.
   */
  get(key: string): Promise<string | null>;
  /**
   * Evaluates a Lua script. Used for atomic lock release.
   */
  eval?(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
}

/**
 * Redis-based distributed lock implementation.
 * Uses SET NX EX pattern for atomic lock acquisition.
 *
 * @example
 * ```typescript
 * import { RedisDistributedLock } from "./distributedLock";
 * import { connection } from "../../redis";
 *
 * const lock = new RedisDistributedLock(connection);
 * const handle = await lock.acquire("my-lock", 5000);
 * if (handle) {
 *   try {
 *     // Do work
 *   } finally {
 *     await lock.release(handle);
 *   }
 * }
 * ```
 */
export class RedisDistributedLock implements DistributedLock {
  private readonly tracer = getLangWatchTracer(
    "langwatch.event-sourcing.distributed-lock",
  );

  constructor(private readonly redis: RedisClient) {}

  async acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    return await this.tracer.withActiveSpan(
      "DistributedLock.acquire",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "lock.key": key,
          "lock.ttl_ms": ttlMs,
          "lock.type": "redis",
        },
      },
      async (span) => {
        // Unique value ensures only the acquiring process can release the lock
        const value = `${Date.now()}-${Math.random()}`;
        const ttlSeconds = Math.ceil(ttlMs / 1000);

        // SET NX EX: atomic operation that only succeeds if key doesn't exist, with expiration
        const result = await this.redis.set(key, value, {
          NX: true,
          EX: ttlSeconds,
        });

        const acquired = result === "OK";
        span.setAttributes({
          "lock.acquired": acquired,
          ...(acquired ? { "lock.value": value } : {}),
        });

        if (acquired) {
          return { key, value };
        }

        return null;
      },
    );
  }

  async release(handle: LockHandle): Promise<void> {
    return await this.tracer.withActiveSpan(
      "DistributedLock.release",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "lock.key": handle.key,
          "lock.type": "redis",
        },
      },
      async (span) => {
        // Use Lua script for atomic check-and-delete to prevent race conditions:
        // - Process A acquires lock, expires, Process B acquires same lock
        // - Process A tries to release: value check prevents deleting B's lock
        let released = false;
        if (this.redis.eval) {
          const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("del", KEYS[1])
            else
              return 0
            end
          `;
          const result = await this.redis.eval(
            script,
            1,
            handle.key,
            handle.value,
          );
          released = result === 1;
        } else {
          // Fallback: non-atomic but still safe (check-then-delete)
          const currentValue = await this.redis.get(handle.key);
          if (currentValue === handle.value) {
            await this.redis.del(handle.key);
            released = true;
          }
        }
        span.setAttributes({
          "lock.released": released,
        });
      },
    );
  }
}

export const DistributedLockUtils = {
  InMemoryDistributedLock,
  RedisDistributedLock,
} as const;
