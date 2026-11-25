import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { RedisApiKeyAnswerCacheRepository } from "../redis.api-key-answer-cache.repository.ts";

describe("RedisApiKeyAnswerCacheRepository", () => {
  describe("when an answer is held for longer than the cap", () => {
    it("writes it with an expiry of five seconds at most, in one command", async () => {
      const redis = memoryRedisDouble();
      const answers = RedisApiKeyAnswerCacheRepository.create({ redis });

      await answers.set({ key: "pat:lookup", value: "{}", ttlMs: 60_000 });

      expect(await redis.ttl("api-key-answer:pat:lookup")).toBe(5);
    });
  });

  describe("when a fill arrives for a key that already holds an entry", () => {
    it("leaves the entry there, so a late fill never replaces a revoke's refusal", async () => {
      const redis = memoryRedisDouble();
      const answers = RedisApiKeyAnswerCacheRepository.create({ redis });
      await answers.set({ key: "pat:lookup", value: "revoked", ttlMs: 5_000 });

      await answers.set({ key: "pat:lookup", value: "{}", ttlMs: 5_000, onlyIfAbsent: true });

      await expect(answers.findValues({ key: "pat:lookup" })).resolves.toEqual(["revoked"]);
      expect(await redis.ttl("api-key-answer:pat:lookup")).toBe(5);
    });
  });

  describe("when a held answer is deleted", () => {
    it("is gone for every reader", async () => {
      const redis = memoryRedisDouble();
      const answers = RedisApiKeyAnswerCacheRepository.create({ redis });
      await answers.set({ key: "pat:lookup", value: "{}", ttlMs: 5_000 });

      await answers.delete({ key: "pat:lookup" });

      await expect(
        RedisApiKeyAnswerCacheRepository.create({ redis: redis.duplicate() }).findValues({
          key: "pat:lookup",
        }),
      ).resolves.toEqual([]);
    });
  });
});
