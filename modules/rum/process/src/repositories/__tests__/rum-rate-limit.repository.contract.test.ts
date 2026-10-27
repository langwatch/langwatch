/**
 * @vitest-environment node
 * The ingest door's fixed-window counters, stated once and run against the
 * memory twin and, when a test Redis is configured, the Redis repository.
 */
import { randomUUID } from "node:crypto";

import { RedisConnectionService, type RedisConnection } from "@langwatch/redis-client";
import { afterAll, describe, expect, it } from "vitest";

import { MemoryRumRateLimitRepository } from "../memory/memory.rum-rate-limit.repository.ts";
import { RedisRumRateLimitRepository } from "../redis/redis.rum-rate-limit.repository.ts";
import type { RumRateLimitRepository } from "../rum-rate-limit.repository.ts";

type Backend = { name: string; create: () => RumRateLimitRepository };

const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
const connection: RedisConnection | null = redisUrl
  ? new RedisConnectionService().connect({ url: redisUrl })
  : null;

const memory: Backend = { name: "memory", create: () => MemoryRumRateLimitRepository.create() };

const backends: readonly Backend[] = connection
  ? [memory, { name: "redis", create: () => RedisRumRateLimitRepository.create({ connection }) }]
  : [memory];

afterAll(async () => {
  await connection?.quit();
});

describe.each(backends)("given the $name RUM rate limit repository", ({ create }) => {
  describe("when a bucket is asked within its budget", () => {
    it("allows each call and counts down what remains", async () => {
      const limits = create();
      const key = `contract:${randomUUID()}`;

      const first = await limits.limit({ key, windowSeconds: 60, max: 2 });
      const second = await limits.limit({ key, windowSeconds: 60, max: 2 });

      expect([first.allowed, first.remaining]).toEqual([true, 1]);
      expect([second.allowed, second.remaining]).toEqual([true, 0]);
    });
  });

  describe("when a bucket is asked past its budget", () => {
    it("refuses the call with nothing remaining", async () => {
      const limits = create();
      const key = `contract:${randomUUID()}`;
      await limits.limit({ key, windowSeconds: 60, max: 1 });

      const refused = await limits.limit({ key, windowSeconds: 60, max: 1 });

      expect([refused.allowed, refused.remaining]).toEqual([false, 0]);
    });
  });

  describe("when two buckets are asked", () => {
    it("counts each on its own", async () => {
      const limits = create();
      const first = `contract:${randomUUID()}`;
      const second = `contract:${randomUUID()}`;
      await limits.limit({ key: first, windowSeconds: 60, max: 1 });

      const other = await limits.limit({ key: second, windowSeconds: 60, max: 1 });

      expect(other.allowed).toBe(true);
    });
  });

  describe("when a bucket is open", () => {
    it("answers a reset time in the future", async () => {
      const limits = create();
      const key = `contract:${randomUUID()}`;

      const answer = await limits.limit({ key, windowSeconds: 60, max: 5 });

      expect(answer.resetAt).toBeGreaterThan(Date.now());
    });
  });
});
