/**
 * Who the playground says is speaking.
 *
 * The derivation only: `ConversationThread.integration.test.tsx` covers what a
 * thread handed these names actually draws.
 *
 * Spec: specs/prompts/playground-conversation.feature
 */
import { describe, expect, it } from "vitest";
import { playgroundConversationLabels } from "../conversationLabels";

describe("playgroundConversationLabels", () => {
  describe("given a profile with a name and a model to run", () => {
    /** @scenario The two sides are named after the person and the model */
    it("names one side after the person and the other after the model", () => {
      expect(
        playgroundConversationLabels({
          userName: "Ada Lovelace",
          model: "openai/gpt-5-mini",
        }),
      ).toEqual({ user: "Ada", assistant: "gpt-5-mini" });
    });

    it("keeps a model id that carries no provider prefix whole", () => {
      // The label is what a reader sees, and everything before the first slash
      // is all such an id has. Dropping it would leave an empty chip.
      expect(
        playgroundConversationLabels({
          userName: "Ada",
          model: "gpt-5-mini",
        }).assistant,
      ).toBe("gpt-5-mini");
    });
  });

  describe("given a profile with no usable name", () => {
    /** @scenario A profile with no usable name leaves my side unnamed */
    it("leaves the person's side unnamed and still names the model", () => {
      expect(
        playgroundConversationLabels({
          userName: "ada@example.com",
          model: "openai/gpt-5-mini",
        }),
      ).toEqual({ user: undefined, assistant: "gpt-5-mini" });
    });

    it("leaves the person's side unnamed while the session is still loading", () => {
      expect(
        playgroundConversationLabels({ model: "openai/gpt-5-mini" }).user,
      ).toBeUndefined();
    });
  });

  describe("given no model chosen yet", () => {
    it("leaves the replying side unnamed rather than blank", () => {
      expect(
        playgroundConversationLabels({ userName: "Ada", model: "  " })
          .assistant,
      ).toBeUndefined();
    });
  });
});
