import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  InMemoryDistributedLock,
  type LockHandle,
  type RedisClient,
  RedisDistributedLock,
} from "../distributedLock";

describe("InMemoryDistributedLock", () => {
  let lock: InMemoryDistributedLock;
  let originalRandom: typeof Math.random;
  let randomValues: number[];

  beforeEach(() => {
    vi.useFakeTimers();
    lock = new InMemoryDistributedLock();
    randomValues = [];
    originalRandom = Math.random;
    Math.random = vi.fn(() => {
      const value = randomValues.shift() ?? 0.5;
      return value;
    });
  });

  afterEach(() => {
    lock.destroy();
    vi.useRealTimers();
    Math.random = originalRandom;
    vi.restoreAllMocks();
  });

  describe("acquire", () => {
    describe("when lock is available", () => {
      it("successfully acquires lock and returns handle", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.12345);

        const handle = await lock.acquire("test-key", 5000);

        expect(handle).not.toBeNull();
        expect(handle?.key).toBe("test-key");
        expect(handle?.value).toBe(`${baseTime}-0.12345`);
      });

      it("generates unique lock values", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1, 0.2);

        const handle1 = await lock.acquire("key1", 5000);
        const handle2 = await lock.acquire("key2", 5000);

        expect(handle1?.value).not.toBe(handle2?.value);
        expect(handle1?.value).toBe(`${baseTime}-0.1`);
        expect(handle2?.value).toBe(`${baseTime}-0.2`);
      });
    });

    describe("when lock is already held", () => {
      it("returns null when lock is held by another process", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1, 0.2);

        const handle1 = await lock.acquire("test-key", 5000);
        expect(handle1).not.toBeNull();

        const handle2 = await lock.acquire("test-key", 5000);
        expect(handle2).toBeNull();
      });
    });

    describe("when lock has expired", () => {
      it("allows acquiring lock after TTL expires", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1, 0.2);

        const handle1 = await lock.acquire("test-key", 5000);
        expect(handle1).not.toBeNull();

        vi.setSystemTime(baseTime + 6000);

        const handle2 = await lock.acquire("test-key", 5000);
        expect(handle2).not.toBeNull();
        expect(handle2?.value).not.toBe(handle1?.value);
      });

      it("allows acquiring lock after cleanup interval removes expired lock", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1, 0.2);

        const handle1 = await lock.acquire("test-key", 5000);
        expect(handle1).not.toBeNull();

        vi.setSystemTime(baseTime + 6000);
        vi.advanceTimersByTime(5000);

        const handle2 = await lock.acquire("test-key", 5000);
        expect(handle2).not.toBeNull();
      });
    });

    describe("when handling edge cases", () => {
      it("handles zero TTL", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1);

        const handle = await lock.acquire("test-key", 0);

        expect(handle).not.toBeNull();

        vi.setSystemTime(baseTime + 1);
        const handle2 = await lock.acquire("test-key", 5000);
        expect(handle2).not.toBeNull();
      });

      it("handles special characters in keys", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1);

        const specialKey = "test:key:with:colons:and/slashes@and#symbols";
        const handle = await lock.acquire(specialKey, 5000);

        expect(handle).not.toBeNull();
        expect(handle?.key).toBe(specialKey);
      });
    });
  });

  describe("release", () => {
    describe("when handle is correct", () => {
      it("successfully releases lock", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1, 0.2);

        const handle = await lock.acquire("test-key", 5000);
        expect(handle).not.toBeNull();

        await lock.release(handle!);

        const handle2 = await lock.acquire("test-key", 5000);
        expect(handle2).not.toBeNull();
      });
    });

    describe("when handle value doesn't match", () => {
      it("does not release lock when value is different", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1, 0.2);

        const handle = await lock.acquire("test-key", 5000);
        expect(handle).not.toBeNull();

        const wrongHandle: LockHandle = {
          key: "test-key",
          value: "wrong-value",
        };

        await lock.release(wrongHandle);

        const handle2 = await lock.acquire("test-key", 5000);
        expect(handle2).toBeNull();
      });
    });

    describe("when handle key doesn't exist", () => {
      it("does not throw when releasing non-existent lock", async () => {
        const nonExistentHandle: LockHandle = {
          key: "non-existent-key",
          value: "some-value",
        };

        await expect(lock.release(nonExistentHandle)).resolves.not.toThrow();
      });

      it("does not affect other locks when releasing non-existent key", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1);

        const handle = await lock.acquire("test-key", 5000);
        expect(handle).not.toBeNull();

        const nonExistentHandle: LockHandle = {
          key: "other-key",
          value: "some-value",
        };

        await lock.release(nonExistentHandle);

        const handle2 = await lock.acquire("test-key", 5000);
        expect(handle2).toBeNull();
      });
    });

    describe("when handle is invalid", () => {
      it("handles handle with empty value", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1);

        const handle = await lock.acquire("test-key", 5000);
        expect(handle).not.toBeNull();

        const invalidHandle: LockHandle = {
          key: "test-key",
          value: "",
        };

        await lock.release(invalidHandle);

        const handle2 = await lock.acquire("test-key", 5000);
        expect(handle2).toBeNull();
      });
    });
  });

  describe("cleanup interval", () => {
    it("removes expired locks after cleanup interval", async () => {
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);
      randomValues.push(0.1, 0.2);

      const handle1 = await lock.acquire("key1", 2000);
      const handle2 = await lock.acquire("key2", 10000);
      expect(handle1).not.toBeNull();
      expect(handle2).not.toBeNull();

      vi.setSystemTime(baseTime + 3000);
      vi.advanceTimersByTime(5000);

      const handle3 = await lock.acquire("key1", 5000);
      expect(handle3).not.toBeNull();

      const handle4 = await lock.acquire("key2", 5000);
      expect(handle4).toBeNull();
    });

    it("does not remove active locks during cleanup", async () => {
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);
      randomValues.push(0.1);

      const handle = await lock.acquire("test-key", 10000);
      expect(handle).not.toBeNull();

      vi.setSystemTime(baseTime + 2000);
      vi.advanceTimersByTime(5000);

      const handle2 = await lock.acquire("test-key", 5000);
      expect(handle2).toBeNull();
    });
  });

  describe("destroy", () => {
    it("clears all locks", async () => {
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);
      randomValues.push(0.1, 0.2);

      const handle1 = await lock.acquire("key1", 5000);
      const handle2 = await lock.acquire("key2", 5000);
      expect(handle1).not.toBeNull();
      expect(handle2).not.toBeNull();

      lock.destroy();

      const handle3 = await lock.acquire("key1", 5000);
      const handle4 = await lock.acquire("key2", 5000);
      expect(handle3).not.toBeNull();
      expect(handle4).not.toBeNull();
    });

    it("stops cleanup interval", async () => {
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);
      randomValues.push(0.1);

      const handle = await lock.acquire("test-key", 2000);
      expect(handle).not.toBeNull();

      lock.destroy();

      vi.setSystemTime(baseTime + 3000);
      vi.advanceTimersByTime(10000);

      expect(() => lock.destroy()).not.toThrow();
    });

    it("can be called multiple times safely", async () => {
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);
      randomValues.push(0.1);

      const handle = await lock.acquire("test-key", 5000);
      expect(handle).not.toBeNull();

      lock.destroy();
      expect(() => lock.destroy()).not.toThrow();
      expect(() => lock.destroy()).not.toThrow();
    });

    it("prevents memory leaks by clearing locks and stopping interval", async () => {
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);
      randomValues.push(0.1, 0.2, 0.3, 0.4, 0.5);

      for (let i = 0; i < 10; i++) {
        await lock.acquire(`key-${i}`, 5000);
      }

      lock.destroy();

      for (let i = 0; i < 10; i++) {
        const handle = await lock.acquire(`key-${i}`, 5000);
        expect(handle).not.toBeNull();
      }
    });
  });

  describe("concurrency and race conditions", () => {
    it("handles multiple concurrent acquire attempts on same key", async () => {
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);
      randomValues.push(0.1, 0.2, 0.3, 0.4, 0.5);

      const results = await Promise.all([
        lock.acquire("test-key", 5000),
        lock.acquire("test-key", 5000),
        lock.acquire("test-key", 5000),
        lock.acquire("test-key", 5000),
        lock.acquire("test-key", 5000),
      ]);

      // Only one should succeed
      const successful = results.filter((r) => r !== null);
      expect(successful.length).toBe(1);
    });

    it("handles lock expiration during concurrent operations", async () => {
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);
      randomValues.push(0.1, 0.2, 0.3);

      const handle1 = await lock.acquire("test-key", 2000);
      expect(handle1).not.toBeNull();

      vi.setSystemTime(baseTime + 3000);
      vi.advanceTimersByTime(5000);

      const [result1, result2] = await Promise.all([
        lock.acquire("test-key", 5000),
        lock.acquire("test-key", 5000),
      ]);

      const successful = [result1, result2].filter((r) => r !== null);
      expect(successful.length).toBe(1);
    });

    it("safely releases already-released lock", async () => {
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);
      randomValues.push(0.1, 0.2);

      const handle = await lock.acquire("test-key", 5000);
      expect(handle).not.toBeNull();

      await lock.release(handle!);
      await expect(lock.release(handle!)).resolves.not.toThrow();
    });

    it("returns null when acquiring same key with different TTL while held", async () => {
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);
      randomValues.push(0.1, 0.2);

      const handle1 = await lock.acquire("test-key", 5000);
      expect(handle1).not.toBeNull();

      const handle2 = await lock.acquire("test-key", 10000);
      expect(handle2).toBeNull();
    });
  });
});

type MockRedisClient = {
  set: ReturnType<
    typeof vi.fn<
      (
        key: string,
        value: string,
        ...args: (string | number)[]
      ) => Promise<string | null>
    >
  >;
  del: ReturnType<typeof vi.fn<(key: string) => Promise<number>>>;
  get: ReturnType<typeof vi.fn<(key: string) => Promise<string | null>>>;
  eval?: ReturnType<
    typeof vi.fn<
      (
        script: string,
        numKeys: number,
        ...args: (string | number)[]
      ) => Promise<unknown>
    >
  >;
};

describe("RedisDistributedLock", () => {
  let mockRedis: MockRedisClient;
  let lock: RedisDistributedLock;
  let originalRandom: typeof Math.random;
  let randomValues: number[];

  beforeEach(() => {
    vi.useFakeTimers();
    randomValues = [];
    originalRandom = Math.random;
    Math.random = vi.fn(() => {
      const value = randomValues.shift() ?? 0.5;
      return value;
    });

    // IORedis set signature: set(key, value, ...args: (string | number)[])
    const setMock =
      vi.fn<
        (
          key: string,
          value: string,
          ...args: (string | number)[]
        ) => Promise<string | null>
      >();
    const delMock = vi.fn<(key: string) => Promise<number>>();
    const getMock = vi.fn<(key: string) => Promise<string | null>>();
    const evalMock =
      vi.fn<
        (
          script: string,
          numKeys: number,
          ...args: (string | number)[]
        ) => Promise<unknown>
      >();

    mockRedis = {
      set: setMock,
      del: delMock,
      get: getMock,
      eval: evalMock,
    };

    lock = new RedisDistributedLock(mockRedis as unknown as RedisClient);
  });

  afterEach(() => {
    vi.useRealTimers();
    Math.random = originalRandom;
    vi.restoreAllMocks();
  });

  describe("acquire", () => {
    describe("when lock is available", () => {
      it("successfully acquires lock when redis.set returns OK", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.12345);

        mockRedis.set.mockResolvedValue("OK");

        const handle = await lock.acquire("test-key", 5000);

        expect(handle).not.toBeNull();
        expect(handle?.key).toBe("test-key");
        expect(handle?.value).toBe(`${baseTime}-0.12345`);
        expect(mockRedis.set).toHaveBeenCalledWith(
          "test-key",
          `${baseTime}-0.12345`,
          "EX",
          5,
          "NX",
        );
      });

      it("generates unique lock values", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1, 0.2);

        mockRedis.set.mockResolvedValueOnce("OK").mockResolvedValueOnce("OK");

        const handle1 = await lock.acquire("key1", 5000);
        const handle2 = await lock.acquire("key2", 5000);

        expect(handle1?.value).not.toBe(handle2?.value);
        expect(handle1?.value).toBe(`${baseTime}-0.1`);
        expect(handle2?.value).toBe(`${baseTime}-0.2`);
      });
    });

    describe("when lock is already held", () => {
      it("returns null when redis.set returns null", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1);

        mockRedis.set.mockResolvedValue(null);

        const handle = await lock.acquire("test-key", 5000);

        expect(handle).toBeNull();
        expect(mockRedis.set).toHaveBeenCalledWith(
          "test-key",
          expect.stringContaining(`${baseTime}-`),
          "EX",
          expect.any(Number),
          "NX",
        );
      });
    });

    describe("when converting TTL", () => {
      it("converts milliseconds to seconds using Math.ceil", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1);

        mockRedis.set.mockResolvedValue("OK");

        await lock.acquire("test-key", 1000);

        expect(mockRedis.set).toHaveBeenCalledWith(
          "test-key",
          expect.any(String),
          "EX",
          1,
          "NX",
        );
      });

      it("rounds up fractional seconds", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1);

        mockRedis.set.mockResolvedValue("OK");

        await lock.acquire("test-key", 1500);

        expect(mockRedis.set).toHaveBeenCalledWith(
          "test-key",
          expect.any(String),
          "EX",
          2,
          "NX",
        );
      });

      it("handles zero TTL", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1);

        mockRedis.set.mockResolvedValue("OK");

        await lock.acquire("test-key", 0);

        expect(mockRedis.set).toHaveBeenCalledWith(
          "test-key",
          expect.any(String),
          "EX",
          0,
          "NX",
        );
      });

      it("handles very large TTL", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1);

        mockRedis.set.mockResolvedValue("OK");

        await lock.acquire("test-key", 86400000);

        expect(mockRedis.set).toHaveBeenCalledWith(
          "test-key",
          expect.any(String),
          "EX",
          86400,
          "NX",
        );
      });
    });

    describe("when handling edge cases", () => {
      it("handles special characters in keys", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1);

        mockRedis.set.mockResolvedValue("OK");

        const specialKey = "test:key:with:colons:and/slashes@and#symbols";
        const handle = await lock.acquire(specialKey, 5000);

        expect(handle).not.toBeNull();
        expect(handle?.key).toBe(specialKey);
        expect(mockRedis.set).toHaveBeenCalledWith(
          specialKey,
          expect.any(String),
          "EX",
          5,
          "NX",
        );
      });
    });

    describe("when redis.set throws an error", () => {
      it("propagates error from redis.set", async () => {
        const baseTime = 1000000;
        vi.setSystemTime(baseTime);
        randomValues.push(0.1);

        const error = new Error("Redis connection failed");
        mockRedis.set.mockRejectedValue(error);

        await expect(lock.acquire("test-key", 5000)).rejects.toThrow(
          "Redis connection failed",
        );
      });
    });
  });

  describe("release", () => {
    describe("when eval is available", () => {
      it("successfully releases lock when value matches using Lua script", async () => {
        const handle: LockHandle = {
          key: "test-key",
          value: "test-value",
        };

        if (mockRedis.eval) {
          mockRedis.eval.mockResolvedValue(1);
        }

        await lock.release(handle);

        expect(mockRedis.eval).toHaveBeenCalledWith(
          expect.stringContaining("redis.call"),
          1,
          "test-key",
          "test-value",
        );
        expect(mockRedis.get).not.toHaveBeenCalled();
        expect(mockRedis.del).not.toHaveBeenCalled();
      });

      it("does not release lock when value doesn't match", async () => {
        const handle: LockHandle = {
          key: "test-key",
          value: "test-value",
        };

        if (mockRedis.eval) {
          mockRedis.eval.mockResolvedValue(0);
        }

        await lock.release(handle);

        expect(mockRedis.eval).toHaveBeenCalled();
        expect(mockRedis.del).not.toHaveBeenCalled();
      });

      it("does not release lock when key doesn't exist", async () => {
        const handle: LockHandle = {
          key: "test-key",
          value: "test-value",
        };

        if (mockRedis.eval) {
          mockRedis.eval.mockResolvedValue(0);
        }

        await lock.release(handle);

        expect(mockRedis.eval).toHaveBeenCalled();
        expect(mockRedis.del).not.toHaveBeenCalled();
      });

      it("calls eval with correct script, numKeys, and args", async () => {
        const handle: LockHandle = {
          key: "test-key",
          value: "test-value-123",
        };

        if (mockRedis.eval) {
          mockRedis.eval.mockResolvedValue(1);
        }

        await lock.release(handle);

        expect(mockRedis.eval).toHaveBeenCalledTimes(1);
        if (mockRedis.eval) {
          const callArgs = mockRedis.eval.mock.calls[0]!;
          expect(callArgs[0]).toContain("redis.call");
          expect(callArgs[0]).toContain("get");
          expect(callArgs[0]).toContain("del");
          expect(callArgs[1]).toBe(1);
          expect(callArgs[2]).toBe("test-key");
          expect(callArgs[3]).toBe("test-value-123");
        }
      });

      it("handles eval errors gracefully", async () => {
        const handle: LockHandle = {
          key: "test-key",
          value: "test-value",
        };

        const error = new Error("Lua script error");
        if (mockRedis.eval) {
          mockRedis.eval.mockRejectedValue(error);
        }

        await expect(lock.release(handle)).rejects.toThrow("Lua script error");
      });
    });

    describe("when eval is not available", () => {
      beforeEach(() => {
        const setMock =
          vi.fn<
            (
              key: string,
              value: string,
              ...args: (string | number)[]
            ) => Promise<string | null>
          >();
        const delMock = vi.fn<(key: string) => Promise<number>>();
        const getMock = vi.fn<(key: string) => Promise<string | null>>();

        mockRedis = {
          set: setMock,
          del: delMock,
          get: getMock,
        };
        lock = new RedisDistributedLock(mockRedis as unknown as RedisClient);
      });

      it("throws error when eval is not available (atomic release required)", async () => {
        const handle: LockHandle = {
          key: "test-key",
          value: "test-value",
        };

        await expect(lock.release(handle)).rejects.toThrow(
          "RedisDistributedLock requires eval() support for atomic lock release",
        );
      });
    });
  });

  describe("concurrency", () => {
    it("handles multiple concurrent acquire attempts", async () => {
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);
      randomValues.push(0.1, 0.2, 0.3, 0.4, 0.5);

      mockRedis.set
        .mockResolvedValueOnce("OK")
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const results = await Promise.all([
        lock.acquire("test-key", 5000),
        lock.acquire("test-key", 5000),
        lock.acquire("test-key", 5000),
        lock.acquire("test-key", 5000),
        lock.acquire("test-key", 5000),
      ]);

      const successful = results.filter((r) => r !== null);
      expect(successful.length).toBe(1);
    });

    it("safely releases already-released lock", async () => {
      const handle: LockHandle = {
        key: "test-key",
        value: "test-value",
      };

      if (mockRedis.eval) {
        mockRedis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      }

      await lock.release(handle);
      await expect(lock.release(handle)).resolves.not.toThrow();
    });

    it("returns null when acquiring same key with different TTL while held", async () => {
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);
      randomValues.push(0.1);

      mockRedis.set.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);

      const handle1 = await lock.acquire("test-key", 5000);
      expect(handle1).not.toBeNull();

      const handle2 = await lock.acquire("test-key", 10000);
      expect(handle2).toBeNull();
    });
  });
});
