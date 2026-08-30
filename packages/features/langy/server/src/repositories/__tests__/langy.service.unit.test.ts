/**
 * @vitest-environment node
 *
 * What is left of `LangyService`'s own behaviour once the composed services own
 * the rest: the feedback cadence.
 *
 * This suite used to carry four more cases over the repository-backed head —
 * conversation identity, relay delegation, "turns repository absence into the
 * contract error", and visibility-before-messages. That head had no production
 * construction (`createComposed` passed `null` for it) and no caller, so those
 * cases proved only that the abstractions they defined were self-consistent.
 * They went with it.
 */
import { describe, expect, it } from "vitest";
import { LangyFeedbackPromptPolicy } from "../../ports/langy-feedback-prompt.port";
import { LangyService } from "../../services/langy.service";
import type { LangyConversationService } from "../../services/langy-conversation.service";
import type { LangyCredentialService } from "../../services/langy-credential.service";
import type { LangyMessageService } from "../../services/langy-message.service";
import type { LangyTurnService } from "../../services/langy-turn.service";

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
  return LangyService.createComposed(
    {} as unknown as LangyConversationService,
    {} as unknown as LangyTurnService,
    {} as unknown as LangyMessageService,
    {} as unknown as LangyCredentialService,
    prompt,
  );
}

describe("LangyService", () => {
  describe("when a conversation has enough assistant answers to ask", () => {
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
