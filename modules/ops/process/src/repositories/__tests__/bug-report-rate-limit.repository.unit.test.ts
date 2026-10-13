/**
 * @vitest-environment node
 * The intake's per-caller counters in Redis, over a stand-in connection.
 * @see modules/ops/specs/bug-report-intake-limit.feature
 */
import type { RedisConnection } from "@langwatch/redis-client";
import { describe, expect, it } from "vitest";

import { RedisBugReportRateLimitRepository } from "../redis/redis.bug-report-rate-limit.repository.ts";

const window = { key: "bug-report:203.0.113.7", windowSeconds: 3600, max: 2 };
const redisKey = "langwatch:ratelimit:bug-report:203.0.113.7";

/** Redis's counter commands over two maps: the counts, and the expiries asked for. */
function counterConnection(): {
  counts: Map<string, number>;
  expiries: Map<string, number>;
  connection: Pick<RedisConnection, "incr" | "expire" | "ttl">;
} {
  const counts = new Map<string, number>();
  const expiries = new Map<string, number>();
  const connection: Pick<RedisConnection, "incr" | "expire" | "ttl"> = {
    incr: (key: string) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return Promise.resolve(next);
    },
    ttl: (key: string) => Promise.resolve(expiries.get(key) ?? (counts.has(key) ? -1 : -2)),
    expire: (key: string, seconds: number) => {
      expiries.set(key, seconds);
      return Promise.resolve(1);
    },
  };
  return { counts, expiries, connection };
}

function unreachable(): Promise<number> {
  return Promise.reject(new Error("connection refused"));
}

describe("given the Redis bug report rate limit repository", () => {
  describe("when a caller spends past the allowance", () => {
    it("refuses the call past it and opens the window once", async () => {
      const { expiries, connection } = counterConnection();
      const limits = RedisBugReportRateLimitRepository.create({ connection });

      const answers = [];
      for (let sent = 0; sent < 3; sent++) answers.push((await limits.consume(window)).allowed);

      expect(answers).toEqual([true, true, false]);
      expect(expiries.get(redisKey)).toBe(3600);
    });
  });

  describe("when a caller's shared count has no expiry", () => {
    /** @scenario "A shared count left without a window is given one" */
    it("sets the window on the next call", async () => {
      const { counts, expiries, connection } = counterConnection();
      counts.set(redisKey, 5);
      const limits = RedisBugReportRateLimitRepository.create({ connection });

      await limits.consume(window);

      expect(expiries.get(redisKey)).toBe(3600);
    });
  });

  describe("when Redis cannot be reached", () => {
    /** @scenario "The allowance holds in this process when the shared count is unreachable" */
    it("counts in this process and refuses the excess", async () => {
      const limits = RedisBugReportRateLimitRepository.create({
        connection: { incr: unreachable, ttl: unreachable, expire: unreachable },
      });

      const answers = [];
      for (let sent = 0; sent < 3; sent++) answers.push((await limits.consume(window)).allowed);

      expect(answers).toEqual([true, true, false]);
    });
  });
});
