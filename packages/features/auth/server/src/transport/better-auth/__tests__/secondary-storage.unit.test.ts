/**
 * @vitest-environment node
 * @see specs/server/redis-client-ownership.feature — ADR-093: the store makes no
 * client, reads the connection its caller supplied, and namespaces every key.
 */
import type { RedisConnection } from "@langwatch/redis-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

// Only better-auth's own logger feeds the spy: other loggers warm by this
// module legitimately warn about a missing Redis, and a shared spy would count
// those as dropped writes. The name is spelled inline because a `vi.mock`
// factory is hoisted above any const it might reference.
vi.mock("@langwatch/observability", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/observability")>(
    "@langwatch/observability",
  );
  return {
    ...actual,
    createLogger: (name: string) => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: name === "langwatch:better-auth" ? warn : vi.fn(),
      error: vi.fn(),
    }),
  };
});

import { createSecondaryStorage } from "../better-auth.api.ts";
import { betterAuthTransportFor } from "./better-auth-transport.test-helpers.ts";

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
  return createSecondaryStorage(redis as unknown as RedisConnection);
}

describe("better-auth secondary storage", () => {
  beforeEach(() => {
    warn.mockClear();
  });

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

  describe("given a process with no application", () => {
    /** @scenario "A read with no connection degrades to a cache miss" */
    it("answers a read with a miss instead of throwing", async () => {
      const store = createSecondaryStorage(null);

      expect(await store.get("session-key")).toBeNull();
      expect(await store.getAndDelete?.("session-key")).toBeNull();

      // A miss is a complete answer: better-auth re-reads the session from the
      // database, so nothing was lost and nothing is reported.
      expect(warn).not.toHaveBeenCalled();
    });

    /** @scenario "A dropped write is reported rather than silently discarded" */
    it("drops a write loudly, naming the operation but never the key", async () => {
      const store = createSecondaryStorage(null);

      await store.set("rate-limit:count", "3", 60);
      await store.delete("rate-limit:count");
      await store.increment?.("rate-limit:count", 60);

      expect(warn).toHaveBeenCalledTimes(3);
      expect(warn.mock.calls.map(([fields]) => fields.operation)).toEqual([
        "set",
        "delete",
        "increment",
      ]);
      // The count separates "one request raced boot" from "this process has
      // been serving auth with no secondary storage all along".
      expect(warn.mock.calls.map(([fields]) => fields.droppedSecondaryWrites)).toEqual([1, 2, 3]);

      // better-auth keys secondary storage BY SESSION TOKEN, so the key is a
      // credential. It must not reach the logs, in a field or in the message.
      for (const [fields, message] of warn.mock.calls) {
        expect(JSON.stringify(fields)).not.toContain("rate-limit:count");
        expect(message).not.toContain("rate-limit:count");
      }
    });

    /** @scenario "A dropped write does not fail the request that caused it" */
    it("resolves rather than rejecting, so the caller degrades open", async () => {
      const store = createSecondaryStorage(null);

      await expect(store.set("k", "v")).resolves.toBeUndefined();
      await expect(store.delete("k")).resolves.toBeUndefined();
      // Not zero: a post-increment is never zero, and the limiter compares this
      // against a maximum. One is the honest "as if this were the first request
      // in the window" — open, and reported as dropped.
      await expect(store.increment?.("k", 60)).resolves.toBe(1);
    });
  });

  describe("given a deployment that composed no Redis", () => {
    it("constructs no client of its own, and limits in memory instead", () => {
      expect(betterAuthTransportFor({}, { redis: null }).options.rateLimit?.storage).toBe("memory");
    });

    /** @scenario "A deployment with no Redis drops writes the same way" */
    it("degrades identically to a process holding no application", async () => {
      const composed = betterAuthTransportFor({}, { redis: null }).options.secondaryStorage;
      if (!composed) throw new Error("the transport composed no secondary storage to degrade");

      expect(await composed.get("k")).toBeNull();
      await composed.set("k", "v");

      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0].operation).toBe("set");
    });
  });
});
