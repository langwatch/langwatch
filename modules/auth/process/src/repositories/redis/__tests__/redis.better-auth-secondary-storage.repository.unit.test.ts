/**
 * Better Auth's secondary storage on a noeviction Redis: no key it writes may outlive its
 * expiry, and a rate-limit counter is counted and expired in one script.
 * @see specs/server/redis-cache-ttl.feature
 */
import {
  memoryRedisDouble,
  memoryRedisStore,
  type MemoryRedisStore,
} from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it, vi } from "vitest";

import { RedisBetterAuthSecondaryStorageRepository } from "../redis.better-auth-secondary-storage.repository.ts";

/** The script's contract over the double's own keyspace: count, then expire one without. */
function storageOver(store: MemoryRedisStore) {
  const keyspace = memoryRedisDouble({ store });
  const evaluate = vi.fn(
    async (_script: unknown, _keys: unknown, key: unknown, seconds: unknown) => {
      const count = await keyspace.incr(String(key));
      if ((await keyspace.ttl(String(key))) < 0)
        await keyspace.expire(String(key), Number(seconds));
      return count;
    },
  );
  const redis = memoryRedisDouble({ store, script: { eval: evaluate } });

  return { storage: RedisBetterAuthSecondaryStorageRepository.create(redis), redis, evaluate };
}

describe("RedisBetterAuthSecondaryStorageRepository", () => {
  describe("when Better Auth stores a value with no time left", () => {
    /** @scenario "A Better Auth value with no time left is deleted, never written bare" */
    it("deletes the key instead of writing it without an expiry", async () => {
      const { storage, redis } = storageOver(memoryRedisStore());
      await storage.set("session-token", "held", 30);

      await storage.set("session-token", "stale", 0);

      expect(await redis.get("better-auth:session-token")).toBeNull();
    });

    it("writes a value with time left together with its expiry", async () => {
      const { storage, redis } = storageOver(memoryRedisStore());

      await storage.set("session-token", "held", 30);

      expect(await redis.ttl("better-auth:session-token")).toBe(30);
    });
  });

  describe("when a rate-limit counter is counted", () => {
    /** @scenario "A rate-limit counter is never left without its expiry" */
    it("counts and expires it in one script, never extending a live window", async () => {
      const { storage, redis, evaluate } = storageOver(memoryRedisStore());

      expect(await storage.increment("rate:1.2.3.4", 60)).toBe(1);
      expect(await storage.increment("rate:1.2.3.4", 600)).toBe(2);

      expect(evaluate).toHaveBeenCalledTimes(2);
      expect(await redis.ttl("better-auth:rate:1.2.3.4")).toBe(60);
    });

    it("gives a counter left without an expiry its window on the next count", async () => {
      const store = memoryRedisStore();
      store.strings.set("better-auth:rate:1.2.3.4", "7");
      const { storage, redis } = storageOver(store);

      await storage.increment("rate:1.2.3.4", 60);

      expect(await redis.ttl("better-auth:rate:1.2.3.4")).toBe(60);
    });
  });
});
