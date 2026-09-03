import { beforeEach, describe, expect, it, vi } from "vitest";
import { setTraceCacheRedis, TtlCache } from "../trace-ttl-cache.service";

const mockRedisStore = new Map<string, { value: string; ttl: number }>();
const mockRedis = {
  get: vi.fn(async (key: string) => mockRedisStore.get(key)?.value ?? null),
  setex: vi.fn(async (key: string, ttl: number, value: string) => {
    mockRedisStore.set(key, { value, ttl });
  }),
  set: vi.fn(
    async (
      key: string,
      value: string,
      ex: string,
      ttl: number,
      nx: string,
    ) => {
      if (nx === "NX" && mockRedisStore.has(key)) return null;
      mockRedisStore.set(key, { value, ttl });
      return "OK";
    },
  ),
  del: vi.fn(async (key: string) => {
    mockRedisStore.delete(key);
  }),
};

describe("TtlCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisStore.clear();
    setTraceCacheRedis(mockRedis);
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
        expect.any(String),
        45,
        expect.any(String),
      );
    });

    it("uses custom prefix for Redis keys", async () => {
      const cache = new TtlCache<number>(30_000, "my_prefix:");

      await cache.set("key1", 1);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        "my_prefix:key1",
        expect.any(Number),
        expect.any(String),
      );
    });

    it("serializes complex objects to JSON", async () => {
      const cache = new TtlCache<{ name: string; count: number }>(
        30_000,
        "test:",
      );
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
        "test:lock1",
        JSON.stringify(true),
        "EX",
        60,
        "NX",
      );
    });

    it("carries the lifetime the caller named, not the cache's own", async () => {
      const cache = new TtlCache<boolean>(60_000, "test:");

      await cache.claim("lock1", true, 30_000);

      expect(mockRedis.set).toHaveBeenCalledWith(
        "test:lock1",
        JSON.stringify(true),
        "EX",
        30,
        "NX",
      );
    });
  });

  describe("when Redis fails on claim", () => {
    /** @scenario "A claim the store cannot answer raises rather than naming a winner" */
    it("raises rather than naming this caller the winner", async () => {
      const cache = new TtlCache<boolean>(30_000, "test:");
      mockRedis.set.mockRejectedValueOnce(new Error("connection reset"));

      // A read and a write fall back to memory here, and the worst that
      // costs is a stale answer. A claim that fell back the same way would
      // name one winner per process, which is the one outcome it exists to
      // prevent, so it refuses instead and the caller decides.
      await expect(cache.claim("lock1", true)).rejects.toThrow(
        "connection reset",
      );

      // Nothing was recorded, so no later read finds a key this process
      // alone believes it holds.
      mockRedis.get.mockRejectedValueOnce(new Error("connection reset"));
      expect(await cache.get("lock1")).toBeUndefined();
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
      setTraceCacheRedis(null);
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

    // With no connection the memory map is the whole cache, so a claim
    // inside the one process is atomic and answers rather than refusing.
    it("claims in memory, and takes a key only once", async () => {
      const cache = new TtlCache<boolean>(30_000, "test:");

      expect(await cache.claim("lock1", true)).toBe(true);
      expect(await cache.claim("lock1", true)).toBe(false);
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it("frees a claimed key once its lifetime passes", async () => {
      const cache = new TtlCache<boolean>(30_000, "test:");

      expect(await cache.claim("lock1", true, 50)).toBe(true);
      await new Promise((r) => setTimeout(r, 60));

      expect(await cache.claim("lock1", true)).toBe(true);
    });
  });
});
