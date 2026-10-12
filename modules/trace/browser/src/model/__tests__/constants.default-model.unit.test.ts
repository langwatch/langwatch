import { findAliasTarget, findModelById } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { DEFAULT_MODEL } from "../constants.ts";

/**
 * `DEFAULT_MODEL` is what `openai/latest` resolves to, and the registry serves
 * it with structured outputs.
 * @see specs/model-providers/latest-alias-resolution.feature
 */
describe("given the committed model catalog", () => {
  describe("when the platform default model is read", () => {
    /** @scenario "The default prompt model is a current model the registry still serves" */
    it("is a registry chat model with structured outputs", () => {
      const entry = findModelById(DEFAULT_MODEL)[0];
      expect(entry, `${DEFAULT_MODEL} is not in the model registry`).toBeTruthy();
      expect(entry!.supportedParameters).toEqual(expect.arrayContaining(["response_format"]));
      expect(DEFAULT_MODEL).not.toMatch(/^openai\/gpt-[0-4]([.-]|$)/);
    });

    /** @scenario "The platform fallback model equals what OpenAI latest resolves to" */
    it("equals the model openai/latest resolves to", () => {
      const latest = findAliasTarget("openai/latest")[0];
      expect(latest, "registry has no openai main-tier model").toBeTruthy();
      expect(DEFAULT_MODEL).toBe(latest);
      expect(DEFAULT_MODEL).not.toBe("openai/gpt-5.5");
    });
  });
});
