import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  InMemoryDistributedLock,
  RedisDistributedLock,
  type RedisClient,
} from "../distributedLock";

describe("DistributedLock", () => {
  describe("InMemoryDistributedLock", () => {
    let lock: InMemoryDistributedLock;

    beforeEach(() => {
      lock = new InMemoryDistributedLock();
    });

    afterEach(() => {
      lock.destroy();
    });

    it("acquires and releases lock", async () => {
      const handle = await lock.acquire("test-key", 5000);
      expect(handle).not.toBeNull();

      if (handle) {
        await expect(lock.release(handle)).resolves.not.toThrow();
      }
    });

    it("prevents acquiring same lock twice", async () => {
      const handle1 = await lock.acquire("test-key", 5000);
      expect(handle1).not.toBeNull();

      const handle2 = await lock.acquire("test-key", 5000);
      expect(handle2).toBeNull();

      if (handle1) {
        await lock.release(handle1);
      }
    });

    it("allows acquiring different locks concurrently", async () => {
      const handle1 = await lock.acquire("key-1", 5000);
      const handle2 = await lock.acquire("key-2", 5000);

      expect(handle1).not.toBeNull();
      expect(handle2).not.toBeNull();

      if (handle1) await lock.release(handle1);
      if (handle2) await lock.release(handle2);
    });

    it("releases lock after TTL expires", async () => {
      const handle1 = await lock.acquire("test-key", 100); // 100ms TTL
      expect(handle1).not.toBeNull();

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be able to acquire again
      const handle2 = await lock.acquire("test-key", 5000);
      expect(handle2).not.toBeNull();

      if (handle2) await lock.release(handle2);
    });

    it("only releases lock with correct handle", async () => {
      const handle1 = await lock.acquire("test-key", 5000);
      expect(handle1).not.toBeNull();

      // Try to release with wrong handle
      const wrongHandle = { key: "test-key", value: "wrong-value" };
      await lock.release(wrongHandle);

      // Lock should still be held
      const handle2 = await lock.acquire("test-key", 5000);
      expect(handle2).toBeNull();

      // Release with correct handle
      if (handle1) {
        await lock.release(handle1);
      }
    });
  });

  describe("RedisDistributedLock", () => {
    let mockRedis: RedisClient;
    let lock: RedisDistributedLock;

    beforeEach(() => {
      mockRedis = {
        set: vi.fn(),
        del: vi.fn(),
        get: vi.fn(),
        eval: vi.fn(),
      };
      lock = new RedisDistributedLock(mockRedis);
    });

    it("acquires lock when Redis returns OK", async () => {
      vi.mocked(mockRedis.set).mockResolvedValue("OK");

      const handle = await lock.acquire("test-key", 5000);

      expect(handle).not.toBeNull();
      expect(mockRedis.set).toHaveBeenCalledWith(
        "test-key",
        expect.any(String),
        { NX: true, EX: 5 },
      );
    });

    it("fails to acquire lock when Redis returns null", async () => {
      vi.mocked(mockRedis.set).mockResolvedValue(null);

      const handle = await lock.acquire("test-key", 5000);

      expect(handle).toBeNull();
    });

    it("releases lock using Lua script when available", async () => {
      vi.mocked(mockRedis.set).mockResolvedValue("OK");
      if (mockRedis.eval) {
        vi.mocked(mockRedis.eval).mockResolvedValue(1);
      }

      const handle = await lock.acquire("test-key", 5000);
      expect(handle).not.toBeNull();

      if (handle) {
        await lock.release(handle);

        expect(mockRedis.eval).toHaveBeenCalledWith(
          expect.stringContaining("redis.call"),
          1,
          handle.key,
          handle.value,
        );
        expect(mockRedis.del).not.toHaveBeenCalled();
      }
    });

    it("releases lock using get+del fallback when eval not available", async () => {
      let storedValue: string | null = null;
      const redisWithoutEval = {
        set: vi.fn().mockImplementation(async (key: string, value: string) => {
          storedValue = value;
          return "OK";
        }),
        del: vi.fn().mockResolvedValue(1),
        get: vi.fn().mockImplementation(async (key: string) => {
          return storedValue;
        }),
      };
      const lockWithoutEval = new RedisDistributedLock(redisWithoutEval);

      const handle = await lockWithoutEval.acquire("test-key", 5000);
      expect(handle).not.toBeNull();

      if (handle) {
        await lockWithoutEval.release(handle);

        expect(redisWithoutEval.get).toHaveBeenCalledWith(handle.key);
        expect(redisWithoutEval.del).toHaveBeenCalledWith(handle.key);
      }
    });

    it("does not release lock if value doesn't match (fallback)", async () => {
      const redisWithoutEval = {
        set: vi.fn().mockResolvedValue("OK"),
        del: vi.fn().mockResolvedValue(1),
        get: vi.fn().mockResolvedValue("different-value"),
      };
      const lockWithoutEval = new RedisDistributedLock(redisWithoutEval);

      const handle = await lockWithoutEval.acquire("test-key", 5000);
      expect(handle).not.toBeNull();

      if (handle) {
        await lockWithoutEval.release(handle);

        expect(redisWithoutEval.get).toHaveBeenCalledWith(handle.key);
        expect(redisWithoutEval.del).not.toHaveBeenCalled();
      }
    });
  });
});
