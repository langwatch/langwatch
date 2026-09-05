/**
 * The frameNonce dedup is the relay's intra-turn replay guard.
 */
import { describe, expect, it, vi } from "vitest";
import { LangyFrameDedupAdapter, type LangyFrameDedupRedis } from "@langwatch/langy-server";

function fakeRedis(): LangyFrameDedupRedis & {
  sets: Map<string, Set<string>>;
  expire: ReturnType<typeof vi.fn>;
} {
  const sets = new Map<string, Set<string>>();
  const expire = vi.fn(async () => 1);
  return {
    sets,
    expire,
    async sadd(key, member) {
      const set = sets.get(key) ?? new Set<string>();
      const had = set.has(member);
      set.add(member);
      sets.set(key, set);
      return had ? 0 : 1;
    },
  };
}

const at = { conversationId: "conv-1", turnId: "turn-1" };

describe("LangyFrameDedupAdapter", () => {
  describe("given a nonce never seen for this turn", () => {
    it("reserves it as fresh and arms the TTL", async () => {
      const redis = fakeRedis();
      const dedup = LangyFrameDedupAdapter.create({ redis, ttlSeconds: 60 });
      expect(await dedup.reserveFrameNonce({ ...at, frameNonce: "n1" })).toBe(true);
      expect(redis.expire).toHaveBeenCalledWith("langy:seen:conv-1:turn-1", 60);
    });
  });

  describe("given the same nonce a second time", () => {
    it("reports it as a duplicate and does NOT re-arm the TTL", async () => {
      const redis = fakeRedis();
      const dedup = LangyFrameDedupAdapter.create({ redis });
      await dedup.reserveFrameNonce({ ...at, frameNonce: "n1" });
      redis.expire.mockClear();

      expect(await dedup.reserveFrameNonce({ ...at, frameNonce: "n1" })).toBe(false);
      expect(redis.expire).not.toHaveBeenCalled();
    });
  });

  describe("given the same nonce under a different turn", () => {
    it("is fresh — dedup is scoped per (conversation, turn)", async () => {
      const redis = fakeRedis();
      const dedup = LangyFrameDedupAdapter.create({ redis });
      await dedup.reserveFrameNonce({ ...at, frameNonce: "n1" });
      expect(
        await dedup.reserveFrameNonce({
          conversationId: "conv-1",
          turnId: "turn-2",
          frameNonce: "n1",
        }),
      ).toBe(true);
    });
  });
});
