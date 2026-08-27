import { describe, expect, it, vi } from "vitest";
import {
  LANGY_HANDOFF_TTL_SECONDS,
  LangyTurnHandoffStore,
  type LangyHandoffRedis,
} from "@langwatch/langy-server";

function fakeRedis(): LangyHandoffRedis & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async set(key, value) {
      values.set(key, value);
      return "OK";
    },
    async get(key) {
      return values.get(key) ?? null;
    },
    async expire(key, _ttl) {
      return values.has(key) ? 1 : 0;
    },
  };
}

const handoff = {
  projectId: "project-1",
  conversationId: "conversation-1",
  turnId: "turn-1",
  actorUserId: "user-1",
  prompt: "hello",
  system: "be helpful",
  credentials: {
    llmVirtualKey: "virtual-key",
    langwatchEndpoint: "https://langwatch.example",
    gatewayBaseUrl: "https://gateway.example/v1",
    organizationId: "organization-1",
  },
  runToken: "run-token",
  permitReserved: false,
};

describe("LangyTurnHandoffStore", () => {
  it("round-trips a handoff by conversation and turn", async () => {
    const redis = fakeRedis();
    const store = LangyTurnHandoffStore.create({ redis });

    await store.stash(handoff);

    await expect(
      store.read({ conversationId: handoff.conversationId, turnId: handoff.turnId }),
    ).resolves.toEqual(handoff);
  });

  it("returns null for a missing or corrupt handoff", async () => {
    const redis = fakeRedis();
    const store = LangyTurnHandoffStore.create({ redis });

    await expect(
      store.read({ conversationId: handoff.conversationId, turnId: handoff.turnId }),
    ).resolves.toBeNull();

    redis.values.set("langy:handoff:{conversation-1}:turn-1", "not-json");
    await expect(
      store.read({ conversationId: handoff.conversationId, turnId: handoff.turnId }),
    ).resolves.toBeNull();

    redis.values.set(
      "langy:handoff:{conversation-1}:turn-1",
      JSON.stringify({ ...handoff, credentials: {} }),
    );
    await expect(
      store.read({ conversationId: handoff.conversationId, turnId: handoff.turnId }),
    ).resolves.toBeNull();
  });

  it("refreshes a live handoff without rewriting it", async () => {
    const redis = fakeRedis();
    const expire = vi.spyOn(redis, "expire");
    const set = vi.spyOn(redis, "set");
    const store = LangyTurnHandoffStore.create({ redis });
    await store.stash(handoff);
    set.mockClear();

    await expect(
      store.refresh({ conversationId: handoff.conversationId, turnId: handoff.turnId }),
    ).resolves.toBe(true);
    expect(expire).toHaveBeenCalledWith(
      "langy:handoff:{conversation-1}:turn-1",
      LANGY_HANDOFF_TTL_SECONDS,
    );
    expect(set).not.toHaveBeenCalled();
  });

  it("does not recreate an expired handoff", async () => {
    const redis = fakeRedis();
    const store = LangyTurnHandoffStore.create({ redis });

    await expect(
      store.refresh({ conversationId: handoff.conversationId, turnId: handoff.turnId }),
    ).resolves.toBe(false);
  });
});
