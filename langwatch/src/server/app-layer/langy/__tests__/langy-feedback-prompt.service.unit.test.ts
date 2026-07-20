/**
 * The backend-driven feedback cadence (specs/langy/langy-feedback.feature,
 * "Backend-driven cadence"): never under a first answer, a per-user quiet
 * period that starts when the card is SHOWN, and a once-per-conversation
 * escape for conversations that grow well past a few answers.
 */
import { describe, expect, it } from "vitest";

import {
  FEEDBACK_LONG_CONVERSATION_ANSWERS,
  FEEDBACK_QUIET_PERIOD_MS,
  LangyFeedbackPromptService,
  type LangyFeedbackPromptRedis,
} from "../langy-feedback-prompt.service";

function memoryRedis(): LangyFeedbackPromptRedis & {
  store: Map<string, string>;
} {
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

const NOW = 1_700_000_000_000;

function service(
  redis: LangyFeedbackPromptRedis | null,
  now: number = NOW,
): LangyFeedbackPromptService {
  return new LangyFeedbackPromptService({ redis, now: () => now });
}

describe("LangyFeedbackPromptService", () => {
  describe("given a conversation with fewer than two answers", () => {
    it("never asks, even with no prior ask on record", async () => {
      const redis = memoryRedis();
      await expect(
        service(redis).shouldAsk({
          userId: "u1",
          conversationId: "c1",
          assistantAnswerCount: 1,
        }),
      ).resolves.toBe(false);
    });
  });

  describe("given a couple of answers and no prior ask", () => {
    it("asks", async () => {
      const redis = memoryRedis();
      await expect(
        service(redis).shouldAsk({
          userId: "u1",
          conversationId: "c1",
          assistantAnswerCount: 2,
        }),
      ).resolves.toBe(true);
    });
  });

  describe("given the card was shown and then ignored", () => {
    it("does not ask again inside the quiet period", async () => {
      const redis = memoryRedis();
      await service(redis).markShown({ userId: "u1", conversationId: "c1" });
      await expect(
        service(redis, NOW + 60_000).shouldAsk({
          userId: "u1",
          conversationId: "c2",
          assistantAnswerCount: 3,
        }),
      ).resolves.toBe(false);
    });

    it("asks again once the quiet period has passed", async () => {
      const redis = memoryRedis();
      await service(redis).markShown({ userId: "u1", conversationId: "c1" });
      await expect(
        service(redis, NOW + FEEDBACK_QUIET_PERIOD_MS).shouldAsk({
          userId: "u1",
          conversationId: "c2",
          assistantAnswerCount: 2,
        }),
      ).resolves.toBe(true);
    });
  });

  describe("given a conversation grown well past a few answers", () => {
    it("may ask once despite a recent ask in another conversation", async () => {
      const redis = memoryRedis();
      await service(redis).markShown({ userId: "u1", conversationId: "c1" });
      await expect(
        service(redis, NOW + 60_000).shouldAsk({
          userId: "u1",
          conversationId: "c2",
          assistantAnswerCount: FEEDBACK_LONG_CONVERSATION_ANSWERS,
        }),
      ).resolves.toBe(true);
    });

    it("never asks twice in the same conversation via the escape", async () => {
      const redis = memoryRedis();
      await service(redis).markShown({ userId: "u1", conversationId: "c2" });
      await expect(
        service(redis, NOW + 60_000).shouldAsk({
          userId: "u1",
          conversationId: "c2",
          assistantAnswerCount: FEEDBACK_LONG_CONVERSATION_ANSWERS + 4,
        }),
      ).resolves.toBe(false);
    });
  });

  describe("given Redis is unavailable", () => {
    it("fails closed — a missed ask is free, a nag is not", async () => {
      await expect(
        service(null).shouldAsk({
          userId: "u1",
          conversationId: "c1",
          assistantAnswerCount: 5,
        }),
      ).resolves.toBe(false);
    });

    it("fails closed on a Redis error too", async () => {
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
      // markShown is best-effort and must not throw.
      await expect(
        service(broken).markShown({ userId: "u1", conversationId: "c1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("given a corrupt stored record", () => {
    it("treats it as no record and asks", async () => {
      const redis = memoryRedis();
      redis.store.set("langy:feedback:last-asked:u1", "not-json{");
      await expect(
        service(redis).shouldAsk({
          userId: "u1",
          conversationId: "c1",
          assistantAnswerCount: 2,
        }),
      ).resolves.toBe(true);
    });
  });

  describe("per-user isolation", () => {
    it("one user's ask does not quiet another user", async () => {
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
  });
});
