import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { RedisShareCacheRepository } from "../redis.share-cache.repository.ts";

describe("RedisShareCacheRepository", () => {
  describe("when it caches an assembled shared trace", () => {
    it("writes the payload with its one-minute expiry in the same command", async () => {
      const redis = memoryRedisDouble();
      const cache = RedisShareCacheRepository.create({ redis });

      await cache.setPayload("share-1", { trace: "t-1" });

      expect(await redis.ttl("shared_trace:share-1")).toBe(60);
    });
  });

  describe("when it records a viewing", () => {
    it("claims the dedupe key with its window in the same command", async () => {
      const redis = memoryRedisDouble();
      const cache = RedisShareCacheRepository.create({ redis });

      await cache.isNewViewing({ shareId: "share-1", viewerKey: "viewer-1" });

      expect(await redis.ttl("share_view:share-1:viewer-1")).toBeGreaterThan(0);
    });
  });
});
