import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRedisStore, mockRedis } = vi.hoisted(() => {
  const mockRedisStore = new Map<string, { value: string; ttl: number }>();
  const mockRedis = {
    get: vi.fn(async (key: string) => mockRedisStore.get(key)?.value ?? null),
    setex: vi.fn(async (key: string, ttl: number, value: string) => {
      mockRedisStore.set(key, { value, ttl });
    }),
    set: vi.fn(async (key: string, value: string, ex: string, ttl: number, nx: string) => {
      if (nx === "NX" && mockRedisStore.has(key)) return null;
      mockRedisStore.set(key, { value, ttl });
      return "OK";
    }),
    del: vi.fn(async (key: string) => { mockRedisStore.delete(key); }),
  };
  return { mockRedisStore, mockRedis };
});

let mockIsBuildOrNoRedis = false;

vi.mock("~/server/redis", () => ({
  get isBuildOrNoRedis() { return mockIsBuildOrNoRedis; },
  get connection() { return mockRedis; },
}));

import { TtlCache } from "../ttlCache";

describe("TtlCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisStore.clear();
    mockIsBuildOrNoRedis = false;
  });

  describe("when Redis is available", () => {
    it("stores and retrieves values from Redis", async () => {
      const cache = new TtlCache<number>(30_000, "test:");

      await cache.set("key1", 42);
      const result = await cache.get("key1");

      expect(result).toBe(42);
      expect(mockRedis.setex).toHaveBeenCalledOnce();
      expect(mockRedis.get).toHaveBeenCalledOnce();
    });

    it("returns undefined for missing keys", async () => {
      const cache = new TtlCache<string>(30_000, "test:");

      const result = await cache.get("nonexistent");

      expect(result).toBeUndefined();
    });

    it("deletes from Redis", async () => {
      const cache = new TtlCache<string>(30_000, "test:");

      await cache.set("key1", "value");
      await cache.delete("key1");
      const result = await cache.get("key1");

      expect(result).toBeUndefined();
      expect(mockRedis.del).toHaveBeenCalledOnce();
    });

    it("uses the correct TTL in seconds", async () => {
      const cache = new TtlCache<number>(45_000, "test:"); // 45s

      await cache.set("key1", 1);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.any(String), 45, expect.any(String)
      );
    });

    it("uses custom prefix for Redis keys", async () => {
      const cache = new TtlCache<number>(30_000, "my_prefix:");

      await cache.set("key1", 1);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        "my_prefix:key1", expect.any(Number), expect.any(String)
      );
    });

    it("serializes complex objects to JSON", async () => {
      const cache = new TtlCache<{ name: string; count: number }>(30_000, "test:");
      const obj = { name: "test", count: 42 };

      await cache.set("obj1", obj);
      const result = await cache.get("obj1");

      expect(result).toEqual(obj);
    });
  });

  describe("when claiming a key", () => {
    it("returns true and stores value when key is absent", async () => {
      const cache = new TtlCache<boolean>(30_000, "test:");

      const result = await cache.claim("lock1", true);

      expect(result).toBe(true);
      expect(await cache.get("lock1")).toBe(true);
    });

    it("returns false when key already exists", async () => {
      const cache = new TtlCache<boolean>(30_000, "test:");

      await cache.claim("lock1", true);
      const second = await cache.claim("lock1", true);

      expect(second).toBe(false);
    });

    it("uses SET NX EX on Redis", async () => {
      const cache = new TtlCache<boolean>(60_000, "test:");

      await cache.claim("lock1", true);

      expect(mockRedis.set).toHaveBeenCalledWith(
        "test:lock1", JSON.stringify(true), "EX", 60, "NX",
      );
    });
  });

  describe("when Redis fails on get", () => {
    it("falls back to in-memory cache", async () => {
      const cache = new TtlCache<number>(30_000, "test:");

      // Set succeeds (writes to both Redis and memory)
      await cache.set("key1", 42);

      // Redis get fails
      mockRedis.get.mockRejectedValueOnce(new Error("connection reset"));

      // Should fall back to memory
      const result = await cache.get("key1");
      expect(result).toBe(42);
    });
  });

  describe("when Redis fails on set", () => {
    it("still caches in memory", async () => {
      const cache = new TtlCache<number>(30_000, "test:");

      // Redis set fails
      mockRedis.setex.mockRejectedValueOnce(new Error("connection reset"));
      await cache.set("key1", 42);

      // Redis get also fails
      mockRedis.get.mockRejectedValueOnce(new Error("connection reset"));

      // Should still return from memory
      const result = await cache.get("key1");
      expect(result).toBe(42);
    });
  });

  describe("when Redis is not configured", () => {
    beforeEach(() => {
      mockIsBuildOrNoRedis = true;
    });

    it("uses in-memory cache only", async () => {
      const cache = new TtlCache<number>(30_000, "test:");

      await cache.set("key1", 42);
      const result = await cache.get("key1");

      expect(result).toBe(42);
      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it("respects TTL for in-memory entries", async () => {
      const cache = new TtlCache<number>(50, "test:"); // 50ms

      await cache.set("key1", 42);
      expect(await cache.get("key1")).toBe(42);

      await new Promise((r) => setTimeout(r, 60));
      expect(await cache.get("key1")).toBeUndefined();
    });

    it("deletes from memory", async () => {
      const cache = new TtlCache<number>(30_000, "test:");

      await cache.set("key1", 42);
      await cache.delete("key1");

      expect(await cache.get("key1")).toBeUndefined();
    });
  });
});
