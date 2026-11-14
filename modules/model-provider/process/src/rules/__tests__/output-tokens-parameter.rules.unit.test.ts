import { baseModelCatalog, overlayModelCatalog } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { pickOutputTokensParameter } from "../output-tokens-parameter.rules.ts";
import { pickReasoningConfig } from "../reasoning-config.rules.ts";

describe("pickOutputTokensParameter", () => {
  describe("given an OpenAI reasoning model", () => {
    /** @scenario "An OpenAI reasoning model is recorded as taking max_completion_tokens" */
    it.each([
      "openai/o1",
      "openai/o1-mini",
      "openai/o3-mini-high",
      "openai/o4-mini",
      "openai/o4-mini:batch",
      "openai/gpt-5",
      "openai/gpt-5-mini",
      "openai/gpt-5.2-pro",
      "openai/gpt-5.6-sol",
      "openai/gpt-6-astra",
      "openai/gpt-6.1-sol-pro:batch",
      "openai/gpt-12",
    ])("records %s as taking max_completion_tokens", (modelId) => {
      expect(pickOutputTokensParameter(modelId)).toBe("max_completion_tokens");
    });
  });

  describe("given a model that takes max_tokens", () => {
    /** @scenario "A model that takes max_tokens is recorded as the default" */
    it.each([
      "openai/gpt-4.1",
      "openai/gpt-4o-mini",
      "openai/gpt-3.5-turbo",
      "openai/gpt-oss-120b",
      "openai/gpt-6x-preview",
      "anthropic/claude-sonnet-4.5",
      "deepseek/deepseek-r1",
      "x-ai/grok-3-mini",
      "openai_codex/gpt-5.6-terra",
    ])("records nothing for %s", (modelId) => {
      expect(pickOutputTokensParameter(modelId)).toBeUndefined();
    });
  });
});

describe("the committed catalog", () => {
  /** @scenario "The committed catalog agrees with the rule" */
  it("marks exactly the chat models the rule marks", () => {
    const disagreements = Object.values(baseModelCatalog.models)
      .filter((model) => model.mode === "chat")
      .filter((model) => model.outputTokensParameter !== pickOutputTokensParameter(model.id))
      .map((model) => model.id);

    expect(disagreements).toEqual([]);
  });

  it("marks the overlay's chat models the rule marks", () => {
    const disagreements = Object.values(overlayModelCatalog.models)
      .filter((model) => model.mode === "chat")
      .filter((model) => model.outputTokensParameter !== pickOutputTokensParameter(model.id))
      .map((model) => model.id);

    expect(disagreements).toEqual([]);
  });
});

describe("pickReasoningConfig", () => {
  describe("given an o4 model", () => {
    /** @scenario "o4 models carry the o-series reasoning settings" */
    it.each(["openai/o4-mini", "openai/o4-mini-high"])("offers low to high for %s", (modelId) => {
      const config = pickReasoningConfig(modelId);

      expect(config?.allowedValues).toEqual(["low", "medium", "high"]);
      expect(config?.defaultValue).toBe("medium");
      expect(config?.canDisable).toBe(false);
    });
  });
});
