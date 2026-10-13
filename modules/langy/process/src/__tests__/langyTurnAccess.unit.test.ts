/**
 * @vitest-environment node
 */
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { beforeEach, describe, expect, it } from "vitest";

import { LangyTurnAccessRedisRepository } from "../repositories/redis/redis.langy-turn-access.repository.ts";

function fakeRedis() {
  return memoryRedisDouble();
}

const ACCESS = {
  projectId: "p1",
  conversationId: "conv-1",
  turnId: "turn-1",
  userId: "alice",
};

describe("LangyTurnAccessRedisRepository", () => {
  describe("given the user who started the turn", () => {
    it("confirms them immediately — no fold to wait for", async () => {
      const redis = fakeRedis();
      const store = LangyTurnAccessRedisRepository.create({ redis });
      await store.grant(ACCESS);

      expect(await store.isTurnActor(ACCESS)).toBe(true);
    });
  });

  describe("given a different user", () => {
    let store: LangyTurnAccessRedisRepository;

    beforeEach(async () => {
      store = LangyTurnAccessRedisRepository.create({ redis: fakeRedis() });
      await store.grant(ACCESS);
    });

    it("does not confirm them — access is per-actor", async () => {
      expect(await store.isTurnActor({ ...ACCESS, userId: "mallory" })).toBe(false);
    });

    it("does not confirm across projects, even for the same user", async () => {
      expect(await store.isTurnActor({ ...ACCESS, projectId: "p2" })).toBe(false);
    });
  });

  describe("given a turn nobody granted access to", () => {
    it("returns false, so the caller falls back to the visibility rule", async () => {
      // `false` is NOT a denial — it means "no fast answer". A shared-conversation
      // viewer has no record here and must fall through to the fold, which is
      // exactly what enforces sharing.
      const store = LangyTurnAccessRedisRepository.create({ redis: fakeRedis() });
      expect(await store.isTurnActor(ACCESS)).toBe(false);
    });
  });

  describe("given a corrupt record", () => {
    it("fails closed", async () => {
      const redis = fakeRedis();
      await redis.set("langy:turn-access:{conv-1}:turn-1", "not json");
      const store = LangyTurnAccessRedisRepository.create({ redis });
      expect(await store.isTurnActor(ACCESS)).toBe(false);
    });

    it("fails closed when valid JSON has the wrong shape", async () => {
      const redis = fakeRedis();
      await redis.set(
        "langy:turn-access:{conv-1}:turn-1",
        JSON.stringify({ ...ACCESS, userId: 123 }),
      );
      const store = LangyTurnAccessRedisRepository.create({ redis });
      expect(await store.isTurnActor(ACCESS)).toBe(false);
    });
  });
});
