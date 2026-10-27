import { describe, expect, it } from "vitest";

import { evaluationRenderBudget } from "../evaluation-render-budget.rules.ts";

describe("evaluationRenderBudget", () => {
  describe("when the evaluator keeps the default max tokens", () => {
    /** @scenario "The render budget follows the judge's max tokens and its model's window" */
    it("renders under half of the judge's 128k default", () => {
      expect(evaluationRenderBudget({ settings: undefined })).toBe(64_000);
      expect(evaluationRenderBudget({ settings: { model: "acme/unknown-model" } })).toBe(64_000);
    });
  });

  describe("when the max tokens setting is raised on a model with a larger window", () => {
    it("renders under half of the setting", () => {
      expect(
        evaluationRenderBudget({
          settings: { model: "anthropic/claude-opus-5-5", max_tokens: 400_000 },
        }),
      ).toBe(200_000);
    });
  });

  describe("when the setting is larger than the model's window", () => {
    it("is capped by the window less the room for the answer", () => {
      expect(
        evaluationRenderBudget({
          settings: { model: "anthropic/claude-opus-5-5", max_tokens: 5_000_000 },
        }),
      ).toBe(Math.floor((1_000_000 - 8_192) / 2));
    });
  });

  describe("when the setting is not a positive number", () => {
    it("falls back to the judge's default", () => {
      expect(evaluationRenderBudget({ settings: { max_tokens: "lots" } })).toBe(64_000);
      expect(evaluationRenderBudget({ settings: { max_tokens: 0 } })).toBe(64_000);
    });
  });
});
