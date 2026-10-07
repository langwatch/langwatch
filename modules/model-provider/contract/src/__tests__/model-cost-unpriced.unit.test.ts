/**
 * Which spans count as unpriced: usage that no rule of the cost cascade prices.
 * @see modules/trace/specs/trace-unpriced-cost.feature
 */
import { describe, expect, it } from "vitest";

import { isModelCostUnpriced } from "../model-cost.ts";
import type { ModelCostRate } from "../model-provider.ts";

const CATALOGUE: readonly ModelCostRate[] = [
  { model: "gpt-4o", regex: "^gpt-4o$", inputCostPerToken: 0.0000025, outputCostPerToken: 0.00001 },
  { model: "local-free", regex: "^local-free$", inputCostPerToken: 0, outputCostPerToken: 0 },
];

function unpriced({
  attrs = {},
  model,
  promptTokens = 100,
  completionTokens = 50,
}: {
  attrs?: Record<string, unknown>;
  model?: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
}): boolean {
  return isModelCostUnpriced({
    input: { attrs, ...(model === undefined ? {} : { model }), promptTokens, completionTokens },
    staticCosts: CATALOGUE,
  });
}

describe("isModelCostUnpriced", () => {
  describe("given a span with token usage", () => {
    it("counts a model the catalogue does not know as unpriced", () => {
      expect(unpriced({ model: "my-finetune-v2" })).toBe(true);
    });

    it("counts usage with no model at all as unpriced", () => {
      expect(unpriced({})).toBe(true);
    });

    it("does not count a catalogue model", () => {
      expect(unpriced({ model: "gpt-4o" })).toBe(false);
    });

    it("does not count a catalogue model priced at zero", () => {
      expect(unpriced({ model: "local-free" })).toBe(false);
    });

    it("does not count a custom rate, even one of zero", () => {
      expect(
        unpriced({
          model: "my-finetune-v2",
          attrs: {
            "langwatch.model.inputCostPerToken": 0,
            "langwatch.model.outputCostPerToken": 0,
          },
        }),
      ).toBe(false);
    });

    it("does not count an explicit span cost", () => {
      expect(unpriced({ model: "my-finetune-v2", attrs: { "langwatch.span.cost": 0.12 } })).toBe(
        false,
      );
    });

    it("reads the model from the response model attribute when none is passed", () => {
      expect(unpriced({ attrs: { "gen_ai.response.model": "gpt-4o" } })).toBe(false);
    });
  });

  describe("given a span with no usage", () => {
    it("does not count it, whatever the model", () => {
      expect(unpriced({ model: "my-finetune-v2", promptTokens: 0, completionTokens: null })).toBe(
        false,
      );
    });

    it("counts usage reported only as characters", () => {
      expect(
        unpriced({
          model: "my-tts",
          promptTokens: null,
          completionTokens: null,
          attrs: { "gen_ai.usage.input_chars": 300 },
        }),
      ).toBe(true);
    });
  });
});
