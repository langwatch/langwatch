import { LangyTurnHandoffRedisRepository } from "@langwatch/langy-process";
import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it, vi } from "vitest";

import { LANGY_HANDOFF_TTL_SECONDS } from "../repositories/langy-live-turn.repository.ts";

function fakeRedis() {
  return memoryRedisDouble();
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

describe("LangyTurnHandoffRedisRepository", () => {
  it("round-trips a handoff by conversation and turn", async () => {
    const redis = fakeRedis();
    const store = LangyTurnHandoffRedisRepository.create({ redis });

    await store.stash(handoff);

    await expect(
      store.read({ conversationId: handoff.conversationId, turnId: handoff.turnId }),
    ).resolves.toEqual(handoff);
  });

  it("returns null for a missing or corrupt handoff", async () => {
    const redis = fakeRedis();
    const store = LangyTurnHandoffRedisRepository.create({ redis });

    await expect(
      store.read({ conversationId: handoff.conversationId, turnId: handoff.turnId }),
    ).resolves.toBeNull();

    await redis.set("langy:handoff:{conversation-1}:turn-1", "not-json");
    await expect(
      store.read({ conversationId: handoff.conversationId, turnId: handoff.turnId }),
    ).resolves.toBeNull();

    await redis.set(
      "langy:handoff:{conversation-1}:turn-1",
      JSON.stringify({ ...handoff, credentials: {} }),
    );
    await expect(
      store.read({ conversationId: handoff.conversationId, turnId: handoff.turnId }),
    ).resolves.toBeNull();
  });

  it("refreshes a live handoff without rewriting it", async () => {
    const keys = memoryRedisStore();
    await LangyTurnHandoffRedisRepository.create({
      redis: memoryRedisDouble({ store: keys }),
    }).stash(handoff);
    const set = vi.fn(async () => "OK");
    const redis = memoryRedisDouble({ store: keys, script: { set } });
    const store = LangyTurnHandoffRedisRepository.create({ redis });

    await expect(
      store.refresh({ conversationId: handoff.conversationId, turnId: handoff.turnId }),
    ).resolves.toBe(true);
    expect(await redis.ttl("langy:handoff:{conversation-1}:turn-1")).toBe(
      LANGY_HANDOFF_TTL_SECONDS,
    );
    expect(set).not.toHaveBeenCalled();
  });

  it("does not recreate an expired handoff", async () => {
    const redis = fakeRedis();
    const store = LangyTurnHandoffRedisRepository.create({ redis });

    await expect(
      store.refresh({ conversationId: handoff.conversationId, turnId: handoff.turnId }),
    ).resolves.toBe(false);
  });
});
