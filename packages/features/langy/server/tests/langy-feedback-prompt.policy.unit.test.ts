import { describe, expect, it } from "vitest";
import {
  FEEDBACK_LONG_CONVERSATION_ANSWERS,
  FEEDBACK_QUIET_PERIOD_MS,
  LangyFeedbackPromptPolicy,
  type LangyFeedbackPromptRedis,
} from "../src/ports/langy-feedback-prompt.port";

const NOW = 1_700_000_000_000;

function memoryRedis(): LangyFeedbackPromptRedis & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
      return "OK";
    },
  };
}

function service(
  redis: LangyFeedbackPromptRedis | null,
  now = NOW,
): LangyFeedbackPromptPolicy {
  return LangyFeedbackPromptPolicy.create({ redis, now: () => now });
}

describe("LangyFeedbackPromptPolicy", () => {
  it("does not ask before two assistant answers", async () => {
    await expect(
      service(memoryRedis()).shouldAsk({
        userId: "u1",
        conversationId: "c1",
        assistantAnswerCount: 1,
      }),
    ).resolves.toBe(false);
  });

  it("asks after two answers when there is no prior record", async () => {
    await expect(
      service(memoryRedis()).shouldAsk({
        userId: "u1",
        conversationId: "c1",
        assistantAnswerCount: 2,
      }),
    ).resolves.toBe(true);
  });

  it("keeps a user quiet for three days after the card is shown", async () => {
    const redis = memoryRedis();
    await service(redis).markShown({ userId: "u1", conversationId: "c1" });
    await expect(
      service(redis, NOW + 60_000).shouldAsk({
        userId: "u1",
        conversationId: "c2",
        assistantAnswerCount: 3,
      }),
    ).resolves.toBe(false);
    await expect(
      service(redis, NOW + FEEDBACK_QUIET_PERIOD_MS).shouldAsk({
        userId: "u1",
        conversationId: "c2",
        assistantAnswerCount: 2,
      }),
    ).resolves.toBe(true);
  });

  it("allows one long-conversation exception in another conversation", async () => {
    const redis = memoryRedis();
    await service(redis).markShown({ userId: "u1", conversationId: "c1" });
    await expect(
      service(redis, NOW + 60_000).shouldAsk({
        userId: "u1",
        conversationId: "c2",
        assistantAnswerCount: FEEDBACK_LONG_CONVERSATION_ANSWERS,
      }),
    ).resolves.toBe(true);
    await service(redis).markShown({ userId: "u1", conversationId: "c2" });
    await expect(
      service(redis, NOW + 120_000).shouldAsk({
        userId: "u1",
        conversationId: "c2",
        assistantAnswerCount: FEEDBACK_LONG_CONVERSATION_ANSWERS + 4,
      }),
    ).resolves.toBe(false);
  });

  it("fails closed on reads and keeps writes best-effort", async () => {
    const broken: LangyFeedbackPromptRedis = {
      get: async () => {
        throw new Error("redis down");
      },
      set: async () => {
        throw new Error("redis down");
      },
    };
    await expect(
      service(broken).shouldAsk({
        userId: "u1",
        conversationId: "c1",
        assistantAnswerCount: 5,
      }),
    ).resolves.toBe(false);
    await expect(
      service(broken).markShown({ userId: "u1", conversationId: "c1" }),
    ).resolves.toBeUndefined();
  });

  it("fails closed when Redis is not configured", async () => {
    await expect(
      service(null).shouldAsk({
        userId: "u1",
        conversationId: "c1",
        assistantAnswerCount: 5,
      }),
    ).resolves.toBe(false);
    await expect(
      service(null).markShown({ userId: "u1", conversationId: "c1" }),
    ).resolves.toBeUndefined();
  });

  it("isolates cadence records per user", async () => {
    const redis = memoryRedis();
    await service(redis).markShown({ userId: "u1", conversationId: "c1" });
    await expect(
      service(redis, NOW + 60_000).shouldAsk({
        userId: "u2",
        conversationId: "c1",
        assistantAnswerCount: 2,
      }),
    ).resolves.toBe(true);
  });

  it("treats corrupt records as absent and writes a thirty-day ttl", async () => {
    const redis = memoryRedis();
    redis.store.set("langy:feedback:last-asked:u1", "not-json{");
    await expect(
      service(redis).shouldAsk({
        userId: "u1",
        conversationId: "c1",
        assistantAnswerCount: 2,
      }),
    ).resolves.toBe(true);

    const calls: unknown[][] = [];
    const recordingRedis: LangyFeedbackPromptRedis = {
      get: redis.get,
      set: async (...args) => {
        calls.push(args);
        return redis.set(...args);
      },
    };
    await service(recordingRedis).markShown({ userId: "u1", conversationId: "c1" });
    const stored = JSON.parse(
      calls[0]?.[1] as string,
    ) as { atMs: unknown };
    expect(stored.atMs).toBe(NOW);
    expect(calls[0]?.slice(0, 3)).toEqual([
      "langy:feedback:last-asked:u1",
      expect.any(String),
      "EX",
    ]);
    expect(calls[0]?.[3]).toBe(30 * 24 * 60 * 60);
  });
});
