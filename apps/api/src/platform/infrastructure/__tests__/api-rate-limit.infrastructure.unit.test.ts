/**
 * The API process's own rate limiter: a consumer that receives its Redis by
 * injection and degrades to memory when the process composed none.
 *
 * @see specs/server/redis-client-ownership.feature
 */
import type { RedisConnection } from "@langwatch/redis-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRateLimitInfrastructure } from "../api-rate-limit.infrastructure";

const START = new Date("2026-09-01T10:00:00.000Z");

/**
 * The three commands the limiter issues, over a counter this test can read.
 * Cast because `RedisConnection` is the whole ioredis surface and the limiter
 * uses three of it; narrowing the port instead would state a dependency the
 * composed connection does not have.
 */
function fakeRedis(options: { ttl?: number } = {}) {
  const counts = new Map<string, number>();
  const expiries = new Map<string, number>();
  const connection = {
    incr: vi.fn(async (key: string) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      expiries.set(key, seconds);
      return 1;
    }),
    ttl: vi.fn(async () => options.ttl ?? 60),
  };
  return {
    connection: connection as unknown as RedisConnection,
    incr: connection.incr,
    expire: connection.expire,
    ttl: connection.ttl,
    expiries,
  };
}

describe("ApiRateLimitInfrastructure", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given the process composed no Redis", () => {
    it("counts one window in memory and refuses the hit past the maximum", async () => {
      const limiter = ApiRateLimitInfrastructure.create();
      const request = { key: "user-1", windowSeconds: 60, max: 2 };

      expect(await limiter.consume(request)).toEqual({
        allowed: true,
        remaining: 1,
        resetAt: START.getTime() + 60_000,
      });
      expect(await limiter.consume(request)).toEqual({
        allowed: true,
        remaining: 0,
        resetAt: START.getTime() + 60_000,
      });
      expect(await limiter.consume(request)).toEqual({
        allowed: false,
        remaining: 0,
        resetAt: START.getTime() + 60_000,
      });
    });

    it("keeps every hit in one window on the window the first hit opened", async () => {
      const limiter = ApiRateLimitInfrastructure.create();
      const request = { key: "user-1", windowSeconds: 60, max: 5 };

      await limiter.consume(request);
      vi.setSystemTime(new Date(START.getTime() + 59_000));

      expect(await limiter.consume(request)).toHaveProperty("resetAt", START.getTime() + 60_000);
    });

    it("opens a fresh window once the previous one has closed", async () => {
      const limiter = ApiRateLimitInfrastructure.create();
      const request = { key: "user-1", windowSeconds: 60, max: 1 };

      await limiter.consume(request);
      expect(await limiter.consume(request)).toHaveProperty("allowed", false);

      vi.setSystemTime(new Date(START.getTime() + 60_000));

      expect(await limiter.consume(request)).toEqual({
        allowed: true,
        remaining: 0,
        resetAt: START.getTime() + 120_000,
      });
    });

    it("counts each key against its own window", async () => {
      const limiter = ApiRateLimitInfrastructure.create();

      await limiter.consume({ key: "user-1", windowSeconds: 60, max: 1 });

      expect(await limiter.consume({ key: "user-2", windowSeconds: 60, max: 1 })).toHaveProperty(
        "allowed",
        true,
      );
      expect(limiter.retainedWindows()).toBe(2);
    });
  });

  describe("given a stream of distinct keys grows the in-memory store", () => {
    it("retains every window while the store stays under its bound", async () => {
      const limiter = ApiRateLimitInfrastructure.create();
      await fill(limiter, 999);

      vi.setSystemTime(new Date(START.getTime() + 60_000));
      await limiter.consume({ key: "late", windowSeconds: 60, max: 10 });

      expect(limiter.retainedWindows()).toBe(1000);
    });

    it("sweeps the closed windows once the store crosses its bound", async () => {
      const limiter = ApiRateLimitInfrastructure.create();
      await fill(limiter, 1000);

      vi.setSystemTime(new Date(START.getTime() + 60_000));
      await limiter.consume({ key: "late", windowSeconds: 60, max: 10 });

      expect(limiter.retainedWindows()).toBe(1);
    });

    it("keeps the windows that are still open when it sweeps", async () => {
      const limiter = ApiRateLimitInfrastructure.create();
      await fill(limiter, 1000);

      vi.setSystemTime(new Date(START.getTime() + 30_000));
      await limiter.consume({ key: "late", windowSeconds: 60, max: 10 });

      expect(limiter.retainedWindows()).toBe(1001);
    });
  });

  describe("given the process composed a Redis connection", () => {
    it("counts in the shared key space every process in the deployment reads", async () => {
      const redis = fakeRedis();
      const limiter = ApiRateLimitInfrastructure.create({ connection: () => redis.connection });

      await limiter.consume({ key: "user-1", windowSeconds: 60, max: 2 });

      expect(redis.incr).toHaveBeenCalledWith("langwatch:ratelimit:user-1");
      expect(limiter.retainedWindows()).toBe(0);
    });

    it("opens the window's expiry on the first hit and leaves it alone afterwards", async () => {
      const redis = fakeRedis();
      const limiter = ApiRateLimitInfrastructure.create({ connection: () => redis.connection });
      const request = { key: "user-1", windowSeconds: 60, max: 5 };

      await limiter.consume(request);
      await limiter.consume(request);

      expect(redis.expire).toHaveBeenCalledTimes(1);
      expect(redis.expire).toHaveBeenCalledWith("langwatch:ratelimit:user-1", 60);
    });

    it("reports the reset instant from the key's remaining time to live", async () => {
      const redis = fakeRedis({ ttl: 17 });
      const limiter = ApiRateLimitInfrastructure.create({ connection: () => redis.connection });

      expect(await limiter.consume({ key: "user-1", windowSeconds: 60, max: 5 })).toEqual({
        allowed: true,
        remaining: 4,
        resetAt: START.getTime() + 17_000,
      });
    });

    it("reports a whole window when the key carries no expiry to read", async () => {
      const redis = fakeRedis({ ttl: -1 });
      const limiter = ApiRateLimitInfrastructure.create({ connection: () => redis.connection });

      expect(await limiter.consume({ key: "user-1", windowSeconds: 60, max: 5 })).toHaveProperty(
        "resetAt",
        START.getTime() + 60_000,
      );
    });

    it("refuses the hit past the maximum and never reports a negative remainder", async () => {
      const redis = fakeRedis();
      const limiter = ApiRateLimitInfrastructure.create({ connection: () => redis.connection });
      const request = { key: "user-1", windowSeconds: 60, max: 1 };

      await limiter.consume(request);
      await limiter.consume(request);

      expect(await limiter.consume(request)).toEqual({
        allowed: false,
        remaining: 0,
        resetAt: START.getTime() + 60_000,
      });
    });

    it("raises a Redis failure rather than letting an uncounted request through", async () => {
      const failing = {
        incr: vi.fn(async () => {
          throw new Error("READONLY You can't write against a read only replica.");
        }),
      } as unknown as RedisConnection;
      const limiter = ApiRateLimitInfrastructure.create({ connection: () => failing });

      await expect(limiter.consume({ key: "user-1", windowSeconds: 60, max: 5 })).rejects.toThrow(
        "READONLY",
      );
    });
  });

  describe("given the process has Redis only some of the time", () => {
    it("counts wherever the connection port points at the moment of the hit", async () => {
      const redis = fakeRedis();
      let connection: RedisConnection | undefined;
      const limiter = ApiRateLimitInfrastructure.create({ connection: () => connection });

      await limiter.consume({ key: "user-1", windowSeconds: 60, max: 5 });
      expect(limiter.retainedWindows()).toBe(1);

      connection = redis.connection;
      await limiter.consume({ key: "user-1", windowSeconds: 60, max: 5 });

      expect(redis.incr).toHaveBeenCalledWith("langwatch:ratelimit:user-1");
      expect(limiter.retainedWindows()).toBe(1);
    });
  });
});

async function fill(limiter: ApiRateLimitInfrastructure, windows: number): Promise<void> {
  for (let index = 0; index < windows; index += 1) {
    await limiter.consume({ key: `key-${index}`, windowSeconds: 60, max: 10 });
  }
}
