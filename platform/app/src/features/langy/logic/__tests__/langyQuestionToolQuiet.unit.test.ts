/**
 * The quiet mark on a question option travels from the tool call to the
 * choices card untouched.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { describe, expect, it } from "vitest";
import { questionToolCardParts } from "../langyQuestionTool";

describe("questionToolCardParts", () => {
  describe("given a question whose second option is quiet", () => {
    /** @scenario "A question option marked quiet reaches the card" */
    it("carries the quiet mark on that option only", () => {
      const [card] = questionToolCardParts({
        type: "tool-question",
        state: "input-available",
        toolCallId: "call-1",
        input: {
          questions: [
            {
              question: "Can I create and run it for you?",
              options: [
                { label: "Sure, go ahead!" },
                { label: "Chat about this", quiet: true },
              ],
            },
          ],
        },
      });

      expect(card?.card.kind).toBe("choices");
      if (card?.card.kind !== "choices") return;
      expect(card.card.options).toEqual([
        { id: "opt-1", label: "Sure, go ahead!" },
        { id: "opt-2", label: "Chat about this", quiet: true },
      ]);
    });

    it("ignores a quiet value that is not exactly true", () => {
      const [card] = questionToolCardParts({
        type: "tool-question",
        state: "input-available",
        toolCallId: "call-2",
        input: {
          questions: [
            {
              question: "Which one?",
              options: [{ label: "A", quiet: "yes" }, { label: "B" }],
            },
          ],
        },
      });
      if (card?.card.kind !== "choices") throw new Error("expected choices");
      expect(card.card.options[0]).not.toHaveProperty("quiet");
    });
  });
});
