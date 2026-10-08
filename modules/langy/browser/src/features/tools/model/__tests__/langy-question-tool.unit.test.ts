/**
 * The quiet and bare marks on a question travel from the tool call to the choices card.
 * @see specs/langy/langy-guided-onboarding.feature
 * @see specs/langy/langy-choice-questions.feature
 */
import { describe, expect, it } from "vitest";

import { questionToolCardParts } from "../langy-question-tool.ts";

function questionPart(question: Record<string, unknown>, toolCallId = "call-1") {
  return {
    type: "tool-question",
    state: "input-available",
    toolCallId,
    input: { questions: [question] },
  };
}

describe("questionToolCardParts", () => {
  describe("given a question whose second option is quiet", () => {
    /** @scenario "A question option marked quiet reaches the card" */
    it("carries the quiet mark on that option only", () => {
      const [card] = questionToolCardParts(
        questionPart({
          question: "Can I create and run it for you?",
          options: [{ label: "Sure, go ahead!" }, { label: "Chat about this", quiet: true }],
        }),
      );

      expect(card?.card.kind).toBe("choices");
      if (card?.card.kind !== "choices") return;
      expect(card.card.options).toEqual([
        { id: "opt-1", label: "Sure, go ahead!" },
        { id: "opt-2", label: "Chat about this", quiet: true },
      ]);
    });

    it("ignores a quiet value that is not exactly true", () => {
      const [card] = questionToolCardParts(
        questionPart({
          question: "Which one?",
          options: [{ label: "A", quiet: "yes" }, { label: "B" }],
        }),
      );
      if (card?.card.kind !== "choices") throw new Error("expected choices");
      expect(card.card.options[0]).not.toHaveProperty("quiet");
    });
  });

  describe("given a bare question", () => {
    /** @scenario "A bare question offers no Other row" */
    it("marks the card bare and offers no Other row, where a question that is not bare does", () => {
      const [bare] = questionToolCardParts(
        questionPart({
          question: "Create the first scenario test?",
          bare: true,
          options: [{ label: "Create it" }, { label: "Chat about this", quiet: true }],
        }),
      );
      if (bare?.card.kind !== "choices") throw new Error("expected choices");
      expect(bare.card.bare).toBe(true);
      expect(bare.card).not.toHaveProperty("allowOther");

      const [plain] = questionToolCardParts(
        questionPart({ question: "Which one?", options: [{ label: "A" }] }, "call-2"),
      );
      if (plain?.card.kind !== "choices") throw new Error("expected choices");
      expect(plain.card).not.toHaveProperty("bare");
      expect(plain.card.allowOther).toBe(true);
    });
  });
});
