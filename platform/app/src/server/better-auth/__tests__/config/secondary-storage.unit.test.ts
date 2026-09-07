/**
 * @vitest-environment node
 *
 * @see specs/server/redis-client-ownership.feature
 * @see dev/docs/adr/093-redis-is-an-owned-client.md
 * @see dev/docs/adr/129-better-auth-is-a-boundary-over-identity-services.md
 *
 * better-auth's secondary storage after ADR-093.
 *
 * WHY THIS FILE EXISTS (#6950)
 *
 * On main, `secondaryStorage` closed over an eagerly-created singleton: once
 * configured, the connection object always existed, and a command issued while
 * Redis was unreachable sat in ioredis's offline queue until it wasn't.
 * ADR-093 replaced that with `tryGetApp()?.redis ?? null`, resolved per call —
 * which answers `null` before the App boots, and permanently in a process that
 * never builds one.
 *
 * A dropped READ is a cache miss and better-auth recovers it from the database.
 * A dropped WRITE has no recovery, and the credential sign-in rate-limit
 * counters live only in secondary storage: dropping their `set` is a rate limit
 * that fails OPEN. So the degrade is allowed, but it is not allowed to be
 * quiet, and neither half of that was covered by a test.
 *
 * The storage is a CLASS now (ADR-129 rule 5), handed the connection it
 * resolves per call, so these cases hand it one and read the counter back
 * instead of stubbing env, resetting the module registry and booting an App to
 * reach a module binding.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("@langwatch/observability", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/observability")
  >("@langwatch/observability");
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    }),
  };
});

import {
  RedisSecondaryStorage,
  secondaryStorage,
} from "../../config/secondary-storage";

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

/** The storage over a connection that is there, or over one that is not. */
const storageOver = (redis: ReturnType<typeof fakeRedis> | null) =>
  new RedisSecondaryStorage({ connection: () => redis as never });

describe("better-auth secondary storage", () => {
  beforeEach(() => {
    warn.mockClear();
  });

  describe("given a deployment that configures no Redis", () => {
    /** @scenario A deployment with no Redis drops writes the same way */
    it("hands better-auth no storage at all, so sessions stay in the database", () => {
      expect(
        secondaryStorage({ configured: false, connection: () => null }),
      ).toBeUndefined();
    });

    it("hands better-auth a storage when one is configured", () => {
      expect(
        secondaryStorage({ configured: true, connection: () => null }),
      ).toBeInstanceOf(RedisSecondaryStorage);
    });
  });

  describe("given an application holding a Redis connection", () => {
    /** @scenario Secondary storage reads and writes the application's connection */
    it("namespaces every operation and reaches that connection", async () => {
      const redis = fakeRedis();
      const store = storageOver(redis);

      expect(await store.get("session-key")).toBe("stored");
      await store.set("session-key", "value", 60);
      await store.set("no-ttl", "value");
      await store.delete("session-key");

      expect(redis.get).toHaveBeenCalledWith("better-auth:session-key");
      expect(redis.set).toHaveBeenCalledWith(
        "better-auth:session-key",
        "value",
        "EX",
        60,
      );
      expect(redis.set).toHaveBeenCalledWith("better-auth:no-ttl", "value");
      expect(redis.del).toHaveBeenCalledWith("better-auth:session-key");
      expect(warn).not.toHaveBeenCalled();
    });
  });

  /**
   * `getAndDelete` and `increment` arrived with better-auth 1.7. The limiter
   * used to read-modify-write a serialized record, which two pods could
   * interleave; `increment` is the atomic replacement, so how it handles the
   * window is now load-bearing for whether a rate limit works at all.
   */
  describe("given the counter behind distributed rate limiting", () => {
    it("counts in one round trip rather than reading and writing back", async () => {
      const redis = fakeRedis();
      redis.incr.mockResolvedValue(4);

      expect(await storageOver(redis).increment("rate-limit:ip", 60)).toBe(4);

      expect(redis.incr).toHaveBeenCalledWith("better-auth:rate-limit:ip");
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("dates the window from the first hit in it", async () => {
      const redis = fakeRedis();
      redis.incr.mockResolvedValue(1);

      await storageOver(redis).increment("rate-limit:ip", 60);

      expect(redis.expire).toHaveBeenCalledWith(
        "better-auth:rate-limit:ip",
        60,
      );
    });

    /**
     * The one worth pinning. Re-applying the TTL on every hit means a key
     * under sustained traffic never expires, and the limit somebody tripped
     * once becomes permanent.
     */
    it("never extends the window on a later hit in the same one", async () => {
      const redis = fakeRedis();
      redis.incr.mockResolvedValue(2);

      await storageOver(redis).increment("rate-limit:ip", 60);

      expect(redis.expire).not.toHaveBeenCalled();
    });

    it("reads and clears a single-use value in one round trip", async () => {
      const redis = fakeRedis();

      expect(await storageOver(redis).getAndDelete("one-time")).toBe("stored");

      expect(redis.getdel).toHaveBeenCalledWith("better-auth:one-time");
      // Two calls would let a second caller read the value between them.
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe("given a process with no connection to reach", () => {
    /** @scenario A read with no connection degrades to a cache miss */
    it("answers a read with a miss instead of throwing", async () => {
      expect(await storageOver(null).get("session-key")).toBeNull();

      // A miss is a complete answer here: better-auth re-reads the session from
      // the database. Nothing was lost, so nothing is reported.
      expect(warn).not.toHaveBeenCalled();
    });

    /** @scenario A dropped write is reported rather than silently discarded */
    it("drops a write loudly, naming the operation but never the key", async () => {
      const store = storageOver(null);

      await store.set("rate-limit:count", "3", 60);
      await store.delete("rate-limit:count");

      expect(warn).toHaveBeenCalledTimes(2);

      const operations = warn.mock.calls.map(([fields]) => fields.operation);
      expect(operations).toEqual(["set", "delete"]);

      // The count separates "one request raced boot" from "this process has been
      // serving auth with no secondary storage all along". Counted on the
      // storage that dropped them, so the absolute numbers are assertable —
      // when the counter was a module binding they depended on every other
      // case in the file having run first.
      expect(
        warn.mock.calls.map(([fields]) => fields.droppedSecondaryWrites),
      ).toEqual([1, 2]);

      // better-auth keys secondary storage BY SESSION TOKEN, so the key is a
      // credential. It must not reach the logs, in a field or in the message.
      for (const [fields, message] of warn.mock.calls) {
        expect(JSON.stringify(fields)).not.toContain("rate-limit:count");
        expect(message).not.toContain("rate-limit:count");
      }
    });

    /** @scenario A dropped write is reported rather than silently discarded */
    it("counts per storage rather than per process", async () => {
      await storageOver(null).set("k", "v");
      await storageOver(null).set("k", "v");

      expect(
        warn.mock.calls.map(([fields]) => fields.droppedSecondaryWrites),
      ).toEqual([1, 1]);
    });

    /** @scenario A dropped write does not fail the request that caused it */
    it("resolves rather than rejecting, so the caller degrades open", async () => {
      const store = storageOver(null);

      await expect(store.set("k", "v")).resolves.toBeUndefined();
      await expect(store.delete("k")).resolves.toBeUndefined();
    });

    it("answers the counter as a first hit, leaving the limiter open", async () => {
      // Not zero: a post-increment is never zero, and the limiter compares
      // this against a maximum. One is the honest "as if this were the first
      // request in the window" — open, and reported as dropped.
      expect(await storageOver(null).increment("rate-limit:ip", 60)).toBe(1);

      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0].operation).toBe("increment");
    });
  });
});
