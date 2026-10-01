import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { RedisGatewayAgentCacheEntryRepository } from "../redis.gateway-agent-cache.repository.ts";

describe("RedisGatewayAgentCacheEntryRepository", () => {
  describe("when an agent stores or claims an entry", () => {
    it("writes the caller's lifetime in the same command", async () => {
      const redis = memoryRedisDouble();
      const store = RedisGatewayAgentCacheEntryRepository.create(redis);

      await store.set("ttlcache:agent-cache:project-1:a", "v", 30_000);
      await store.claim("ttlcache:agent-cache:project-1:b", "v", 45_000);

      expect(await redis.ttl("ttlcache:agent-cache:project-1:a")).toBe(30);
      expect(await redis.ttl("ttlcache:agent-cache:project-1:b")).toBe(45);
    });
  });
});
