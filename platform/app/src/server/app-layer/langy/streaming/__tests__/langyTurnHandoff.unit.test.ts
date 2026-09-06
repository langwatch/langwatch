/**
 * @see specs/langy/langy-turn-recovery.feature
 */
import { describe, expect, it, vi } from "vitest";
import {
  LANGY_HANDOFF_TTL_SECONDS,
  type LangyHandoffRedis,
  type LangyTurnHandoff,
  LangyTurnHandoffStore,
} from "../langyTurnHandoff";

const AT = { conversationId: "conv-1", turnId: "turn-1" };
const KEY = "langy:handoff:{conv-1}:turn-1";

function fakeRedis(over: Partial<LangyHandoffRedis> = {}) {
  return {
    set: vi.fn(async () => "OK"),
    get: vi.fn(async () => null),
    expire: vi.fn(async () => 1),
    ...over,
  } satisfies LangyHandoffRedis;
}

describe("LangyTurnHandoffStore", () => {
  describe("when a heartbeat refreshes a live handoff", () => {
    /** @scenario "A heartbeat keeps the turn's revival record alive" */
    it("extends the key by a full TTL without rewriting the record", async () => {
      const redis = fakeRedis();
      const store = new LangyTurnHandoffStore(redis);

      const extended = await store.refresh(AT);

      expect(extended).toBe(true);
      expect(redis.expire).toHaveBeenCalledWith(KEY, LANGY_HANDOFF_TTL_SECONDS);
      // The record is the turn's resume inputs. A heartbeat says the worker is
      // alive, not that any of them changed.
      expect(redis.set).not.toHaveBeenCalled();
      expect(redis.get).not.toHaveBeenCalled();
    });
  });

  describe("when the handoff has already aged out", () => {
    /** @scenario "A revival record that already aged out is not recreated" */
    it("reports that there was nothing to extend and writes nothing", async () => {
      const redis = fakeRedis({ expire: vi.fn(async () => 0) });
      const store = new LangyTurnHandoffStore(redis);

      expect(await store.refresh(AT)).toBe(false);
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe("when a handoff is stashed", () => {
    it("writes it under its own TTL", async () => {
      const redis = fakeRedis();
      const store = new LangyTurnHandoffStore(redis);

      await store.stash({
        projectId: "project-1",
        conversationId: "conv-1",
        turnId: "turn-1",
        actorUserId: "user-1",
        prompt: "score it",
        system: "",
        credentials: {} as LangyTurnHandoff["credentials"],
        runToken: "token-1",
        permitReserved: false,
      });

      expect(redis.set).toHaveBeenCalledWith(
        KEY,
        expect.stringContaining("token-1"),
        "EX",
        LANGY_HANDOFF_TTL_SECONDS,
      );
    });
  });
});
