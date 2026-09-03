import { describe, expect, it, vi } from "vitest";
import { RedisReadinessService } from "./readiness";
import type { RedisConnection } from "./types";

function connectionThat(ping: () => Promise<unknown>): RedisConnection {
  return { ping } as unknown as RedisConnection;
}

function createLoggerSpy() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("RedisReadinessService", () => {
  describe("given a connection that answers", () => {
    /** @scenario "A responsive Redis is reported ready" */
    it("resolves", async () => {
      const logger = createLoggerSpy();

      await expect(
        new RedisReadinessService({ logger }).ping({
          connection: connectionThat(() => Promise.resolve("PONG")),
          target: "redis://localhost:6379",
        }),
      ).resolves.toBeUndefined();

      expect(logger.info).toHaveBeenCalledWith({ target: "redis://localhost:6379" }, "redis ready");
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("given a target carrying an AUTH password", () => {
    /** @scenario "A credential in the Redis URL never reaches the logs" */
    it("logs the host without the credential, on success and on failure", async () => {
      const logger = createLoggerSpy();
      const readiness = new RedisReadinessService({ logger });
      const target = "rediss://admin:hunter2@redis.internal:6379";

      await readiness.ping({
        connection: connectionThat(() => Promise.resolve("PONG")),
        target,
      });
      await expect(
        readiness.ping({
          connection: connectionThat(() => Promise.reject(new Error("down"))),
          target,
        }),
      ).rejects.toThrow("down");

      const everythingLogged = JSON.stringify([
        logger.info.mock.calls,
        logger.warn.mock.calls,
        logger.error.mock.calls,
      ]);
      expect(everythingLogged).not.toContain("hunter2");
      expect(everythingLogged).not.toContain("admin");
      expect(everythingLogged).toContain("rediss://redis.internal:6379");
    });

    it("drops a password containing a comma", async () => {
      const logger = createLoggerSpy();

      await new RedisReadinessService({ logger }).ping({
        connection: connectionThat(() => Promise.resolve("PONG")),
        target: "rediss://admin:p,a@redis.internal:6379",
      });

      // Splitting the target on commas first sent `rediss://admin:p` and
      // `a@redis.internal:6379` through the userinfo pattern separately, and
      // neither matched, so the whole credential reached the log.
      expect(logger.info).toHaveBeenCalledWith(
        { target: "rediss://redis.internal:6379" },
        "redis ready",
      );
    });

    it("drops a password passed as a query parameter, keeping the database index", async () => {
      const logger = createLoggerSpy();

      await new RedisReadinessService({ logger }).ping({
        connection: connectionThat(() => Promise.resolve("PONG")),
        target: "redis://redis.internal:6379/3?password=hunter2",
      });

      expect(logger.info).toHaveBeenCalledWith(
        { target: "redis://redis.internal:6379/3" },
        "redis ready",
      );
    });

    it("keeps a credential-free cluster endpoint list intact", async () => {
      const logger = createLoggerSpy();

      await new RedisReadinessService({ logger }).ping({
        connection: connectionThat(() => Promise.resolve("PONG")),
        target: "one:6379,two:6380",
      });

      expect(logger.info).toHaveBeenCalledWith({ target: "one:6379,two:6380" }, "redis ready");
    });
  });

  describe("given a connection that never answers", () => {
    /** @scenario "An unresponsive Redis fails the probe rather than the process" */
    it("rejects with a timeout error", async () => {
      const logger = createLoggerSpy();

      await expect(
        new RedisReadinessService({ logger }).ping({
          connection: connectionThat(() => new Promise(() => void 0)),
          timeoutMs: 5,
        }),
      ).rejects.toThrow("PING timeout after 5ms");

      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a connection that rejects", () => {
    it("propagates the failure as an Error", async () => {
      await expect(
        new RedisReadinessService().ping({
          connection: connectionThat(() => Promise.reject("ECONNREFUSED")),
          timeoutMs: 50,
        }),
      ).rejects.toThrow("ECONNREFUSED");
    });
  });

  describe("given no connection", () => {
    /** @scenario "Probing without a connection succeeds trivially" */
    it("resolves without probing anything", async () => {
      const readiness = new RedisReadinessService();

      await expect(readiness.ping({ connection: null })).resolves.toBeUndefined();
      await expect(readiness.ping({})).resolves.toBeUndefined();
    });
  });

  describe("when the ping succeeds well before the timeout", () => {
    it("leaves no pending timer behind", async () => {
      vi.useFakeTimers();
      try {
        await new RedisReadinessService().ping({
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
