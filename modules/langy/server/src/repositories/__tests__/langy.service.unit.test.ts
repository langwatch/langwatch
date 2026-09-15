/**
 * What is left of `LangyService`'s own behaviour once the composed services own the rest: the
 * feedback cadence.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { LangyFeedbackPromptPolicy } from "../../services/langy-feedback-prompt.service.ts";
import { LangyService } from "../../services/langy.service.ts";
import type { LangyConversationService } from "../../services/langy-conversation.service.ts";
import type { LangyCredentialService } from "../../services/langy-credential.service.ts";
import type { LangyMessageService } from "../../services/langy-message.service.ts";
import type { LangyTurnService } from "../../services/langy-turn.service.ts";

function feedbackPrompt() {
  const values = new Map<string, string>();
  return {
    service: LangyFeedbackPromptPolicy.create({
      redis: {
        get: async (key: string) => values.get(key) ?? null,
        set: async (key: string, value: string) => {
          values.set(key, value);
          return "OK" as const;
        },
      } as never,
    }),
    values,
  };
}

/** Composed the way production composes it; feedback reaches no collaborator. */
function service(prompt: LangyFeedbackPromptPolicy) {
  return LangyService.create({
    conversations: {} as unknown as LangyConversationService,
    turns: {} as unknown as LangyTurnService,
    messages: {} as unknown as LangyMessageService,
    credentials: {} as unknown as LangyCredentialService,
    feedbackPrompt: prompt,
  });
}

describe("LangyService", () => {
  describe("when a conversation has enough assistant answers to ask", () => {
    /** @scenario "feedback prompt keeps its existing cadence" */
    it("owns the feedback cadence on the flat service boundary", async () => {
      const prompt = feedbackPrompt();
      const langy = service(prompt.service);

      await expect(
        langy.shouldAskFeedback({
          userId: "user_1",
          conversationId: "conversation_1",
          assistantAnswerCount: 2,
        }),
      ).resolves.toBe(true);

      await langy.markFeedbackShown({
        userId: "user_1",
        conversationId: "conversation_1",
      });

      expect(prompt.values.get("langy:feedback:last-asked:user_1")).toBeDefined();
    });
  });
});
