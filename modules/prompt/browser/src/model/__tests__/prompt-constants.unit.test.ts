/**
 * `DEFAULT_MODEL` is derived from the model registry through the same tier
 * grammar as the `openai/latest` alias, so drift is impossible by construction.
 * @see specs/prompts/prompt-sync-fidelity.feature
 */
import { findModelById } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { DEFAULT_MODEL } from "../prompt-constants.ts";

describe("given the committed model catalog", () => {
  describe("when the default prompt model is read", () => {
    /** @scenario "The default prompt model is a current model the registry still serves" */
    it("is a registry chat model with structured outputs", () => {
      const entry = findModelById(DEFAULT_MODEL)[0];
      expect(entry, `${DEFAULT_MODEL} is not in the model registry`).toBeTruthy();
      expect(entry!.supportedParameters).toEqual(expect.arrayContaining(["response_format"]));
      expect(DEFAULT_MODEL).not.toMatch(/^openai\/gpt-[0-4]([.-]|$)/);
    });
  });
});
