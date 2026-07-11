/**
 * @vitest-environment node
 *
 * The synchronous gate that lets Stream B actually run.
 *
 * Stream B gated on the ClickHouse fold, which lands SECONDS after a turn starts
 * — but the browser subscribes the instant it reads the turn-id header. So on the
 * first turn of any conversation the fold did not exist, the gate 404'd, and the
 * fast path never once ran. This record is written synchronously in the POST, so
 * the answer is there the moment the browser asks.
 */
import { describe, expect, it } from "vitest";
import { LangyTurnAccessStore } from "../langyTurnAccess";

/** An in-memory stand-in for the Redis surface the store needs. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
      return "OK";
    },
  };
}

const ACCESS = {
  projectId: "p1",
  conversationId: "conv-1",
  turnId: "turn-1",
  userId: "alice",
};

describe("LangyTurnAccessStore", () => {
  describe("given the user who started the turn", () => {
    it("confirms them immediately — no fold to wait for", async () => {
      const redis = fakeRedis();
      const store = new LangyTurnAccessStore(redis);
      await store.grant(ACCESS);

      expect(await store.isTurnActor(ACCESS)).toBe(true);
    });
  });

  describe("given a different user", () => {
    it("does not confirm them — access is per-actor", async () => {
      const redis = fakeRedis();
      const store = new LangyTurnAccessStore(redis);
      await store.grant(ACCESS);

      expect(await store.isTurnActor({ ...ACCESS, userId: "mallory" })).toBe(
        false,
      );
    });

    it("does not confirm across projects, even for the same user", async () => {
      const redis = fakeRedis();
      const store = new LangyTurnAccessStore(redis);
      await store.grant(ACCESS);

      expect(await store.isTurnActor({ ...ACCESS, projectId: "p2" })).toBe(false);
    });
  });

  describe("given a turn nobody granted access to", () => {
    it("returns false, so the caller falls back to the visibility rule", async () => {
      // `false` is NOT a denial — it means "no fast answer". A shared-conversation
      // viewer has no record here and must fall through to the fold, which is
      // exactly what enforces sharing.
      const store = new LangyTurnAccessStore(fakeRedis());
      expect(await store.isTurnActor(ACCESS)).toBe(false);
    });
  });

  describe("given a corrupt record", () => {
    it("fails closed", async () => {
      const redis = fakeRedis();
      redis.store.set("langy:turn-access:{conv-1}:turn-1", "not json");
      const store = new LangyTurnAccessStore(redis);
      expect(await store.isTurnActor(ACCESS)).toBe(false);
    });
  });
});
