import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { RedisAuthSessionCacheRepository } from "../redis.auth-session-cache.repository.ts";

describe("RedisAuthSessionCacheRepository", () => {
  describe("when it rewrites a session key", () => {
    it("writes the value and its expiry in one command", async () => {
      const redis = memoryRedisDouble();
      const cache = RedisAuthSessionCacheRepository.create({ redis });

      await cache.set({ key: "better-auth:active-sessions-user-1", value: "[]", ttlSeconds: 42 });

      expect(await redis.ttl("better-auth:active-sessions-user-1")).toBe(42);
    });
  });
});
