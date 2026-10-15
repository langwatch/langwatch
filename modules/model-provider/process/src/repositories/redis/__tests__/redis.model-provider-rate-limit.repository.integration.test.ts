/**
 * @vitest-environment node
 * @see specs/worker/worker-capability-mount.feature
 */
import { type RedisConnection, RedisConnectionService } from "@langwatch/redis-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RedisModelProviderRateLimitRepository } from "../redis.model-provider-rate-limit.repository.ts";

const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
const KEY = `worker-mount-${Date.now()}`;

describe.skipIf(!redisUrl)("the connection-test counter over the process's Redis", () => {
  let redis: RedisConnection;

  beforeAll(() => {
    redis = new RedisConnectionService().connect({
      url: redisUrl,
      clusterEndpoints: undefined,
      dbIndex: undefined,
    })!;
  });

  afterAll(async () => {
    await redis?.del(`model-provider:rate-limit:${KEY}`);
    await redis?.quit();
  });

  describe("when two replicas count the same window", () => {
    /** @scenario "A worker holding Redis counts its connection windows" */
    it("shares one count between them, refusing past the ceiling", async () => {
      const replicaA = RedisModelProviderRateLimitRepository.create(redis);
      const replicaB = RedisModelProviderRateLimitRepository.create(redis);
      const window = { key: KEY, windowSeconds: 60, max: 2 };

      expect((await replicaA.consume(window)).allowed).toBe(true);
      expect((await replicaB.consume(window)).allowed).toBe(true);
      expect((await replicaA.consume(window)).allowed).toBe(false);
      expect(await redis.get(`model-provider:rate-limit:${KEY}`)).toBe("3");
    });
  });
});
