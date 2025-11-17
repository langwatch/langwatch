/**
 * Distributed lock interface for preventing concurrent operations on the same resource.
 * Used to prevent race conditions when multiple workers rebuild projections for the same aggregate.
 */

export interface DistributedLock {
  /**
   * Acquires a lock for the given key.
   * @param key - The lock key (e.g., "rebuild:tenant:aggregateType:aggregateId")
   * @param ttlMs - Time-to-live in milliseconds. Lock will be released after this time even if not explicitly released.
   * @returns A lock handle that must be used to release the lock, or null if lock could not be acquired.
   */
  acquire(key: string, ttlMs: number): Promise<LockHandle | null>;

  /**
   * Releases a lock using the handle returned from acquire().
   * @param handle - The lock handle returned from acquire()
   */
  release(handle: LockHandle): Promise<void>;
}

export interface LockHandle {
  key: string;
  value: string;
}

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

  constructor() {
    // Clean up expired locks every 5 seconds
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
    const now = Date.now();
    const existing = this.locks.get(key);

    // Check if lock exists and is still valid
    if (existing && existing.expiresAt > now) {
      return null; // Lock is held by someone else
    }

    // Acquire lock
    const value = `${Date.now()}-${Math.random()}`;
    this.locks.set(key, {
      value,
      expiresAt: now + ttlMs,
    });

    return { key, value };
  }

  async release(handle: LockHandle): Promise<void> {
    const existing = this.locks.get(handle.key);
    if (existing && existing.value === handle.value) {
      this.locks.delete(handle.key);
    }
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
  constructor(private readonly redis: RedisClient) {}

  async acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    const value = `${Date.now()}-${Math.random()}`;
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    // SET key value NX EX ttl - sets key only if it doesn't exist, with expiration
    const result = await this.redis.set(key, value, {
      NX: true,
      EX: ttlSeconds,
    });

    if (result === "OK") {
      return { key, value };
    }

    return null; // Lock is held by someone else
  }

  async release(handle: LockHandle): Promise<void> {
    // Use Lua script to ensure we only delete if the value matches
    // This prevents deleting a lock that was acquired by another process after expiration
    if (this.redis.eval) {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await this.redis.eval(script, 1, handle.key, handle.value);
    } else {
      // Fallback: check value before deleting
      const currentValue = await this.redis.get(handle.key);
      if (currentValue === handle.value) {
        await this.redis.del(handle.key);
      }
      // If values don't match, lock was already released or expired and reacquired
    }
  }
}

export const DistributedLockUtils = {
  InMemoryDistributedLock,
  RedisDistributedLock,
} as const;
