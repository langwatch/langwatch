/**
 * @vitest-environment node
 * @see specs/server/redis-client-ownership.feature — ADR-093: the store makes no
 * client, reads the connection its caller supplied, and namespaces every key.
 */
import type { RedisConnection } from "@langwatch/redis-client";
import { describe, expect, it, vi } from "vitest";

import { createSecondaryStorage } from "../better-auth.api";

function fakeRedis() {
  return {
    get: vi.fn().mockResolvedValue("stored"),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    getdel: vi.fn().mockResolvedValue("stored"),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  };
}

function storeOver(redis: ReturnType<typeof fakeRedis>) {
  const store = createSecondaryStorage(redis as unknown as RedisConnection);
  if (!store) throw new Error("a connection was supplied, so a store must have been built");
  return store;
}

describe("better-auth secondary storage", () => {
  describe("given an application holding a Redis connection", () => {
    /** @scenario "Secondary storage reads and writes the application's connection" */
    it("namespaces every operation and reaches that connection", async () => {
      const redis = fakeRedis();
      const store = storeOver(redis);

      expect(await store.get("session-key")).toBe("stored");
      await store.set("session-key", "value", 60);
      await store.set("no-ttl", "value");
      await store.delete("session-key");

      expect(redis.get).toHaveBeenCalledWith("better-auth:session-key");
      expect(redis.set).toHaveBeenCalledWith("better-auth:session-key", "value", "EX", 60);
      expect(redis.set).toHaveBeenCalledWith("better-auth:no-ttl", "value");
      expect(redis.del).toHaveBeenCalledWith("better-auth:session-key");
    });
  });

  /**
   * `getAndDelete` and `increment` arrived with better-auth 1.7. The limiter used
   * to read-modify-write a record two pods could interleave; `increment` is the
   * atomic replacement, so its window handling decides whether a limit works.
   */
  describe("given the counter behind distributed rate limiting", () => {
    it("counts in one round trip rather than reading and writing back", async () => {
      const redis = fakeRedis();
      redis.incr.mockResolvedValue(4);

      expect(await storeOver(redis).increment?.("rate-limit:ip", 60)).toBe(4);

      expect(redis.incr).toHaveBeenCalledWith("better-auth:rate-limit:ip");
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("dates the window from the first hit in it", async () => {
      const redis = fakeRedis();
      redis.incr.mockResolvedValue(1);

      await storeOver(redis).increment?.("rate-limit:ip", 60);

      expect(redis.expire).toHaveBeenCalledWith("better-auth:rate-limit:ip", 60);
    });

    /**
     * Re-applying the TTL on every hit means a key under sustained traffic
     * never expires, and the limit somebody tripped once becomes permanent.
     */
    it("never extends the window on a later hit in the same one", async () => {
      const redis = fakeRedis();
      redis.incr.mockResolvedValue(2);

      await storeOver(redis).increment?.("rate-limit:ip", 60);

      expect(redis.expire).not.toHaveBeenCalled();
    });

    it("reads and clears a single-use value in one round trip", async () => {
      const redis = fakeRedis();

      expect(await storeOver(redis).getAndDelete?.("one-time")).toBe("stored");

      expect(redis.getdel).toHaveBeenCalledWith("better-auth:one-time");
      // Two calls would let a second caller read the value between them.
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe("given a deployment that composed no Redis", () => {
    it("builds no store at all, rather than constructing a client of its own", () => {
      expect(createSecondaryStorage(null)).toBeUndefined();
    });
  });
});
