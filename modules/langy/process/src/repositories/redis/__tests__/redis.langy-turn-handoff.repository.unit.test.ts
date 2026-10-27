/**
 * The turn's revival record: refreshed by a heartbeat, never written back once it has aged out.
 * @see specs/langy/langy-turn-recovery.feature
 */
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LANGY_HANDOFF_TTL_SECONDS,
  type LangyTurnHandoff,
} from "../../langy-live-turn.repository.ts";
import {
  type LangyHandoffRedis,
  LangyTurnHandoffRedisRepository,
} from "../redis.langy-turn-handoff.repository.ts";

const ids = { conversationId: "conv_1", turnId: "turn_1" };

const handoff: LangyTurnHandoff = {
  projectId: "project_1",
  ...ids,
  actorUserId: "user_1",
  prompt: "prompt",
  system: "system",
  credentials: {
    llmVirtualKey: "vk",
    langwatchEndpoint: "https://langwatch.test",
    gatewayBaseUrl: "https://gateway.test/v1",
    organizationId: "org_1",
  },
  runToken: "run_token",
  permitReserved: false,
};

/** Keys that lapse on the (fake) clock; EXPIRE only touches a key that still exists. */
function makeExpiringRedis() {
  const values = new Map<string, { value: string; expiresAt: number }>();
  const live = (key: string) => {
    const entry = values.get(key);
    if (entry && entry.expiresAt <= Date.now()) values.delete(key);
    return values.get(key);
  };
  const set = vi.fn(async (...args: unknown[]) => {
    const [key, value, , seconds] = args as [string, string, string, number];
    values.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return "OK";
  });
  const redis: LangyHandoffRedis = redisDouble({
    set,
    get: async (...args: unknown[]) => live(String(args[0]))?.value ?? null,
    expire: async (...args: unknown[]) => {
      const entry = live(String(args[0]));
      if (!entry) return 0;
      entry.expiresAt = Date.now() + Number(args[1]) * 1000;
      return 1;
    },
  });
  return { redis, set };
}

describe("LangyTurnHandoffRedisRepository", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a heartbeat arrives while the record is still parked", () => {
    it("extends it past its original lapse", async () => {
      const { redis } = makeExpiringRedis();
      const repository = LangyTurnHandoffRedisRepository.create({ redis });
      await repository.stash(handoff);

      vi.advanceTimersByTime((LANGY_HANDOFF_TTL_SECONDS - 10) * 1000);
      expect(await repository.refresh(ids)).toBe(true);
      vi.advanceTimersByTime(60 * 1000);

      expect(await repository.read(ids)).toEqual({ kind: "hit", handoff });
    });
  });

  describe("given the revival record has already aged out", () => {
    /** @scenario "A revival record that already aged out is not recreated" */
    it("writes nothing back and reports that it was not refreshed", async () => {
      const { redis, set } = makeExpiringRedis();
      const repository = LangyTurnHandoffRedisRepository.create({ redis });
      await repository.stash(handoff);
      set.mockClear();

      vi.advanceTimersByTime((LANGY_HANDOFF_TTL_SECONDS + 1) * 1000);
      const refreshed = await repository.refresh(ids);

      expect(refreshed).toBe(false);
      expect(set).not.toHaveBeenCalled();
      expect(await repository.read(ids)).toEqual({ kind: "miss" });
    });
  });
});
