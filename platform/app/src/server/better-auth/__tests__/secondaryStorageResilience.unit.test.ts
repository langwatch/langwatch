import { afterEach, describe, expect, it, vi } from "vitest";
import {
  betterAuthSecondaryStorageFailOpenTotal,
  DELETE_RETRY_INTERVAL_MS,
  DELETE_RETRY_WINDOW_MS,
  withRedisFailOpen,
} from "../secondaryStorageResilience";

function hangingStorage() {
  return {
    get: vi.fn(() => new Promise<string | null>(() => {})),
    set: vi.fn(() => new Promise<void>(() => {})),
    delete: vi.fn(() => new Promise<void>(() => {})),
  };
}

function erroringStorage() {
  const boom = async () => {
    throw new Error("connection refused");
  };
  return { get: vi.fn(boom), set: vi.fn(boom), delete: vi.fn(boom) };
}

async function failOpenCount(operation: string): Promise<number> {
  const metric = await betterAuthSecondaryStorageFailOpenTotal.get();
  return (
    metric.values.find((value) => value.labels.operation === operation)
      ?.value ?? 0
  );
}

describe("better-auth secondary storage fail-open (D02 seam b)", () => {
  describe("when Redis is configured but hanging", () => {
    /** @scenario "Session reads fail open to the database when Redis is down" */
    it("a get answers a miss within its budget, so Postgres serves the session", async () => {
      const storage = hangingStorage();
      const wrapped = withRedisFailOpen(storage, { timeoutMs: 20 });
      const before = await failOpenCount("get");

      await expect(wrapped?.get("session-token")).resolves.toBeNull();
      expect(await failOpenCount("get")).toBe(before + 1);
    });

    /** @scenario "Dropped secondary-storage writes are counted, never silent" */
    it("a set is dropped within its budget with the drop counted", async () => {
      const storage = hangingStorage();
      const wrapped = withRedisFailOpen(storage, { timeoutMs: 20 });
      const before = await failOpenCount("set");

      await expect(
        wrapped?.set("rate-limit-key", "1", 60),
      ).resolves.toBeUndefined();
      expect(await failOpenCount("set")).toBe(before + 1);
    });
  });

  describe("when Redis is configured but erroring", () => {
    it("get, set and delete all fail open instead of failing the request", async () => {
      const storage = erroringStorage();
      const wrapped = withRedisFailOpen(storage, { timeoutMs: 20 });

      await expect(wrapped?.get("key")).resolves.toBeNull();
      await expect(wrapped?.set("key", "value")).resolves.toBeUndefined();
      await expect(wrapped?.delete("key")).resolves.toBeUndefined();
      expect(storage.get).toHaveBeenCalledTimes(1);
      expect(storage.set).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a delete drops while Redis is down", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** @scenario "A dropped delete is retried out of band until Redis recovers" */
    it("retries the underlying delete on the interval and lands it once Redis recovers", async () => {
      vi.useFakeTimers();
      let redisIsDown = true;
      const storage = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {
          if (redisIsDown) throw new Error("connection refused");
        }),
      };
      const wrapped = withRedisFailOpen(storage, { timeoutMs: 20 });

      await wrapped?.delete("revoked-session-token");
      expect(storage.delete).toHaveBeenCalledTimes(1);

      redisIsDown = false;
      await vi.advanceTimersByTimeAsync(DELETE_RETRY_INTERVAL_MS);
      expect(storage.delete).toHaveBeenCalledTimes(2);

      // The set emptied, so the timer stopped: no further attempts run.
      await vi.advanceTimersByTimeAsync(DELETE_RETRY_INTERVAL_MS * 3);
      expect(storage.delete).toHaveBeenCalledTimes(2);
    });

    /** @scenario "A delete that never lands is abandoned after the retry window, counted" */
    it("abandons the key after the retry window with the abandonment counted", async () => {
      vi.useFakeTimers();
      const storage = erroringStorage();
      const wrapped = withRedisFailOpen(storage, { timeoutMs: 20 });
      const before = await failOpenCount("delete_retry_abandoned");

      await wrapped?.delete("revoked-session-token");
      await vi.advanceTimersByTimeAsync(
        DELETE_RETRY_WINDOW_MS + DELETE_RETRY_INTERVAL_MS,
      );

      expect(await failOpenCount("delete_retry_abandoned")).toBe(before + 1);

      // Abandoned means gone: further intervals attempt nothing.
      const attemptsSoFar = storage.delete.mock.calls.length;
      await vi.advanceTimersByTimeAsync(DELETE_RETRY_INTERVAL_MS * 2);
      expect(storage.delete.mock.calls.length).toBe(attemptsSoFar);
    });

    /** @scenario "A delete that never lands is abandoned after the retry window, counted" */
    it("abandons the oldest key when the retry set overflows its cap, counted", async () => {
      vi.useFakeTimers();
      const storage = erroringStorage();
      const wrapped = withRedisFailOpen(storage, {
        timeoutMs: 20,
        deleteRetryMaxKeys: 2,
      });
      const before = await failOpenCount("delete_retry_abandoned");

      await wrapped?.delete("revoked-token-1");
      await wrapped?.delete("revoked-token-2");
      expect(await failOpenCount("delete_retry_abandoned")).toBe(before);

      // The third key overflows the cap of two: the oldest is given up on.
      await wrapped?.delete("revoked-token-3");
      expect(await failOpenCount("delete_retry_abandoned")).toBe(before + 1);

      // The survivors keep retrying; the abandoned key attempts nothing.
      storage.delete.mockClear();
      await vi.advanceTimersByTimeAsync(DELETE_RETRY_INTERVAL_MS);
      const retriedKeys = storage.delete.mock.calls.map(([key]) => key);
      expect(retriedKeys.sort()).toEqual([
        "revoked-token-2",
        "revoked-token-3",
      ]);
    });
  });

  describe("when Redis is healthy", () => {
    it("calls pass through with their answers intact", async () => {
      const storage = {
        get: vi.fn(async () => "cached"),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
      };
      const wrapped = withRedisFailOpen(storage, { timeoutMs: 100 });

      await expect(wrapped?.get("key")).resolves.toBe("cached");
      await wrapped?.set("key", "value", 30);
      expect(storage.set).toHaveBeenCalledWith("key", "value", 30);
    });
  });

  describe("when the flag is off", () => {
    /** @scenario "The flag off keeps previous behavior exactly" */
    it("returns the raw storage: no wrapper, no budget", () => {
      const storage = hangingStorage();
      const wrapped = withRedisFailOpen(storage, { enabled: false });
      expect(wrapped).toBe(storage);
    });
  });

  describe("when no secondary storage is configured", () => {
    it("stays unconfigured — sessions live in the database as always", () => {
      expect(withRedisFailOpen(undefined)).toBeUndefined();
    });
  });
});
