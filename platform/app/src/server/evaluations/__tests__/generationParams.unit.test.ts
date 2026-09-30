/**
 * @vitest-environment node
 *
 * Spec: specs/evaluators/evaluator-generation-params.feature
 */

import { describe, expect, it } from "vitest";
import { pickGenerationParams } from "../generationParams";

describe("pickGenerationParams", () => {
  describe("when the settings carry generation parameters next to evaluator fields", () => {
    /** @scenario "Generation parameters survive the settings schema parse on the API route" */
    it("keeps the generation parameters and drops everything else", () => {
      const picked = pickGenerationParams({
        model: "anthropic/claude-sonnet-4-5",
        prompt: "judge it",
        temperature: 1,
        top_p: 1,
        max_tokens: 64000,
        top_k: 40,
        verbosity: "medium",
        seed: null,
      });

      expect(picked).toEqual({ temperature: 1, top_p: 1, max_tokens: 64000 });
    });
  });

  describe("when there are no settings", () => {
    it("returns nothing", () => {
      expect(pickGenerationParams(undefined)).toEqual({});
      expect(pickGenerationParams(null)).toEqual({});
    });
  });
});
