import { describe, expect, it, vi } from "vitest";
import { pingRedis } from "./readiness";
import type { RedisConnection } from "./types";

function connectionThat(ping: () => Promise<unknown>): RedisConnection {
  return { ping } as unknown as RedisConnection;
}

describe("pingRedis", () => {
  describe("given a connection that answers", () => {
    /** @scenario "A responsive Redis is reported ready" */
    it("resolves", async () => {
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      await expect(
        pingRedis({
          connection: connectionThat(() => Promise.resolve("PONG")),
          target: "redis://localhost:6379",
          logger,
        }),
      ).resolves.toBeUndefined();

      expect(logger.info).toHaveBeenCalledWith(
        { target: "redis://localhost:6379" },
        "redis ready",
      );
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("given a connection that never answers", () => {
    /** @scenario "An unresponsive Redis fails the probe rather than the process" */
    it("rejects with a timeout error", async () => {
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      await expect(
        pingRedis({
          connection: connectionThat(() => new Promise(() => void 0)),
          timeoutMs: 5,
          logger,
        }),
      ).rejects.toThrow("PING timeout after 5ms");

      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a connection that rejects", () => {
    it("propagates the failure as an Error", async () => {
      await expect(
        pingRedis({
          connection: connectionThat(() => Promise.reject("ECONNREFUSED")),
          timeoutMs: 50,
        }),
      ).rejects.toThrow("ECONNREFUSED");
    });
  });

  describe("given no connection", () => {
    /** @scenario "Probing without a connection succeeds trivially" */
    it("resolves without probing anything", async () => {
      await expect(pingRedis({ connection: null })).resolves.toBeUndefined();
      await expect(pingRedis({})).resolves.toBeUndefined();
    });
  });

  describe("when the ping succeeds well before the timeout", () => {
    it("leaves no pending timer behind", async () => {
      vi.useFakeTimers();
      try {
        await pingRedis({
          connection: connectionThat(() => Promise.resolve("PONG")),
          timeoutMs: 15_000,
        });

        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
