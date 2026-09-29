import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";

import { parseDispatchSettings, pickGenerationParams } from "../evaluator-settings.rules.ts";

const judgeSchema = z.object({ model: z.string(), prompt: z.string() });

describe("pickGenerationParams", () => {
  describe("when the settings carry generation parameters next to evaluator fields", () => {
    it("keeps the whitelisted parameters and drops everything else", () => {
      expect(
        pickGenerationParams({
          model: "anthropic/claude-sonnet-4-5",
          prompt: "judge it",
          temperature: 1,
          top_p: 1,
          max_tokens: 64000,
          top_k: 40,
          verbosity: "medium",
          seed: null,
        }),
      ).toEqual({ temperature: 1, top_p: 1, max_tokens: 64000 });
    });
  });

  describe("when there are no settings", () => {
    it("returns nothing", () => {
      expect(pickGenerationParams(undefined)).toEqual({});
      expect(pickGenerationParams(null)).toEqual({});
    });
  });
});

describe("parseDispatchSettings", () => {
  describe("when the evaluator's schema declares no generation parameters", () => {
    /** @scenario "Generation parameters survive the settings schema parse on the API route" */
    it("keeps the temperature and top_p and drops a field neither names", () => {
      const settings = parseDispatchSettings({
        schema: judgeSchema,
        settings: {
          model: "openai/gpt-5",
          prompt: "judge it",
          temperature: 0.2,
          top_p: 1,
          top_k: 40,
        },
      });

      expect(settings).toEqual({
        model: "openai/gpt-5",
        prompt: "judge it",
        temperature: 0.2,
        top_p: 1,
      });
    });
  });

  describe("when the evaluator's own settings are invalid", () => {
    /** @scenario "Invalid evaluator settings are refused even when generation parameters ride along" */
    it("throws the schema's error instead of dispatching the generation parameters alone", () => {
      expect(() =>
        parseDispatchSettings({
          schema: judgeSchema,
          settings: { model: 42, temperature: 0.2 },
        }),
      ).toThrow(ZodError);
    });
  });

  describe("when the evaluator has no generated schema", () => {
    it("returns no parsed settings", () => {
      expect(
        parseDispatchSettings({ schema: undefined, settings: { temperature: 0.2 } }),
      ).toBeUndefined();
    });
  });
});
