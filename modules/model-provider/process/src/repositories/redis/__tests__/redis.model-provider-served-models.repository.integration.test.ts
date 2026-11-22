/**
 * @vitest-environment node
 * @see specs/model-providers/model-picker-callable-ids.feature
 */
import { type RedisConnection, RedisConnectionService } from "@langwatch/redis-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RedisModelProviderServedModelsRepository } from "../redis.model-provider-served-models.repository.ts";

const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
const KEY = `served-models-${process.pid}-${Math.random().toString(36).slice(2)}`;

describe.skipIf(!redisUrl)("the model list cache over the process's Redis", () => {
  let redis: RedisConnection;

  beforeAll(() => {
    redis = new RedisConnectionService().connect({
      url: redisUrl,
      clusterEndpoints: undefined,
      dbIndex: undefined,
    })!;
  });

  afterAll(async () => {
    await redis?.del(`model-provider:served-models:${KEY}`);
    await redis?.quit();
  });

  describe("when one replica saves a credential's model list", () => {
    /** @scenario A provider's model list is held in Redis for every replica */
    it("is read back by another replica, with its expiry set", async () => {
      const replicaA = RedisModelProviderServedModelsRepository.create(redis);
      const replicaB = RedisModelProviderServedModelsRepository.create(redis);

      await replicaA.saveListing({ key: KEY, ids: ["gpt-6-sol"], listedAt: 1_000, ttlSeconds: 60 });

      expect(await replicaB.findListings({ keys: [KEY, `${KEY}-absent`] })).toEqual([
        { key: KEY, ids: ["gpt-6-sol"], listedAt: 1_000 },
      ]);
      expect(await redis.ttl(`model-provider:served-models:${KEY}`)).toBeGreaterThan(0);
    });
  });
});
