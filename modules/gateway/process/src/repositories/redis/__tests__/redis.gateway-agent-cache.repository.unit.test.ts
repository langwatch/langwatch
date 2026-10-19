import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { GatewayAgentCacheEntryUnreadableError } from "../../gateway-agent-cache.repository.ts";
import { RedisGatewayAgentCacheEntryRepository } from "../redis.gateway-agent-cache.repository.ts";

const cipher = {
  encrypt: (plaintext: string) => `sealed:${plaintext}`,
  decrypt: (ciphertext: string) => {
    if (!ciphertext.startsWith("sealed:")) throw new Error("bad ciphertext");
    return ciphertext.slice("sealed:".length);
  },
};

describe("RedisGatewayAgentCacheEntryRepository", () => {
  describe("when an agent stores or claims an entry", () => {
    it("writes the caller's lifetime in the same command", async () => {
      const redis = memoryRedisDouble();
      const store = RedisGatewayAgentCacheEntryRepository.create({ redis, cipher });

      await store.set("ttlcache:agent-cache:project-1:a", "v", 30_000);
      await store.claim("ttlcache:agent-cache:project-1:b", "v", 45_000);

      expect(await redis.ttl("ttlcache:agent-cache:project-1:a")).toBe(30);
      expect(await redis.ttl("ttlcache:agent-cache:project-1:b")).toBe(45);
    });

    it("rests each value sealed and reads it back opened", async () => {
      const redis = memoryRedisDouble();
      const store = RedisGatewayAgentCacheEntryRepository.create({ redis, cipher });

      await store.set("ttlcache:agent-cache:project-1:a", "first", 30_000);
      await store.claim("ttlcache:agent-cache:project-1:b", "second", 30_000);

      expect(await redis.get("ttlcache:agent-cache:project-1:a")).toBe("sealed:first");
      expect(await redis.get("ttlcache:agent-cache:project-1:b")).toBe("sealed:second");
      expect(await store.find("ttlcache:agent-cache:project-1:a")).toBe("first");
    });
  });

  describe("when a stored value can no longer be opened", () => {
    it("raises the unreadable-entry error without the stored value", async () => {
      const redis = memoryRedisDouble();
      await redis.set("ttlcache:agent-cache:project-1:a", "a-secret-nobody-may-log");
      const store = RedisGatewayAgentCacheEntryRepository.create({ redis, cipher });

      const read = store.find("ttlcache:agent-cache:project-1:a");

      await expect(read).rejects.toBeInstanceOf(GatewayAgentCacheEntryUnreadableError);
      await expect(read).rejects.not.toThrow("a-secret-nobody-may-log");
    });
  });

  describe("when the name holds nothing", () => {
    it("answers no value", async () => {
      const store = RedisGatewayAgentCacheEntryRepository.create({
        redis: memoryRedisDouble(),
        cipher,
      });

      expect(await store.find("ttlcache:agent-cache:project-1:missing")).toBeUndefined();
    });
  });
});
