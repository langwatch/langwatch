import { describe, expect, it } from "vitest";
import {
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
});
