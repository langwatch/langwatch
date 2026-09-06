/**
 * @vitest-environment node
 *
 * @see specs/scenarios/simulation-run-model-resolution.feature
 */
import { describe, expect, it } from "vitest";

import { modelOverrideSchema } from "../modelOverrideSchema";

describe("modelOverrideSchema", () => {
  describe("when the value is a provider-prefixed id", () => {
    it.each([
      "openai/gpt-5-mini",
      "openai/latest",
      "anthropic/latest-mini",
      "bedrock/anthropic.claude-sonnet-4-20250514-v1:0",
      "openrouter/meta-llama/llama-3",
    ])("accepts %s", (value) => {
      expect(modelOverrideSchema.safeParse(value).success).toBe(true);
    });
  });

  describe("when the value has no provider prefix", () => {
    /** @scenario "A model override that is not a provider-prefixed id is rejected at save time" */
    it.each([
      "latest",
      "gpt-5-mini",
      "",
      "/gpt-5-mini",
      "openai/",
    ])("rejects %j with a provider/model message", (value) => {
      const result = modelOverrideSchema.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("provider/model");
      }
    });
  });

  describe("when a path segment is empty or blank", () => {
    /** @scenario "A model override that is not a provider-prefixed id is rejected at save time" */
    it.each([
      "openai/ ",
      "openai//gpt-5-mini",
      "openai/gpt-5-mini\n",
      "openai/gpt 5 mini",
      "openrouter/meta-llama/",
    ])("rejects %j with a provider/model message", (value) => {
      const result = modelOverrideSchema.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("provider/model");
      }
    });
  });
});
