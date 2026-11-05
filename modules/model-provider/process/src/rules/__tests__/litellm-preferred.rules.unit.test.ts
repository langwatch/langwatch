import type { LLMModelEntry, LLMModelPricing } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { applyLitellmPreference, LITELLM_PREFERRED } from "../litellm-preferred.rules.ts";

function model(id: string, pricing: Partial<LLMModelPricing>): LLMModelEntry {
  return {
    id,
    name: id,
    provider: id.split("/")[0]!,
    pricing: { inputCostPerToken: 0, outputCostPerToken: 0, ...pricing },
    contextLength: 0,
    maxCompletionTokens: null,
    supportedParameters: [],
    defaultParameters: null,
    modality: "text->text",
    mode: "chat",
    supportsImageInput: false,
    supportsAudioInput: false,
    supportsImageOutput: false,
    supportsAudioOutput: false,
  };
}

describe("applyLitellmPreference", () => {
  it("takes litellm's rates for a listed model and keeps the rates litellm lacks", () => {
    const models = {
      "deepseek/deepseek-v4-flash": model("deepseek/deepseek-v4-flash", {
        inputCostPerToken: 4.9e-8,
        outputCostPerToken: 9.8e-8,
        inputCacheReadPerToken: 9.8e-9,
        webSearchCostPerQuery: 0.01,
      }),
    };
    const litellm = {
      "deepseek/deepseek-v4-flash": {
        inputCostPerToken: 3e-7,
        outputCostPerToken: 1.2e-6,
        inputCacheReadPerToken: 6e-9,
      },
    } satisfies Record<string, LLMModelPricing>;

    const changed = applyLitellmPreference({
      models,
      litellmById: litellm,
      preferred: {
        "deepseek/deepseek-v4-flash": "vendor page",
      },
    });

    expect(changed).toEqual(["deepseek/deepseek-v4-flash"]);
    expect(models["deepseek/deepseek-v4-flash"]!.pricing).toEqual({
      inputCostPerToken: 3e-7,
      outputCostPerToken: 1.2e-6,
      inputCacheReadPerToken: 6e-9,
      webSearchCostPerQuery: 0.01,
    });
  });

  it("leaves unlisted models and models litellm does not price alone", () => {
    const models = {
      "inception/mercury-2.5": model("inception/mercury-2.5", {
        inputCostPerToken: 4e-8,
      }),
      "deepseek/deepseek-v4-pro": model("deepseek/deepseek-v4-pro", {
        inputCostPerToken: 7.83e-7,
      }),
    };
    const litellm = {
      "inception/mercury-2.5": { inputCostPerToken: 2e-7, outputCostPerToken: 0 },
    } satisfies Record<string, LLMModelPricing>;

    const changed = applyLitellmPreference({
      models,
      litellmById: litellm,
      preferred: {
        "deepseek/deepseek-v4-pro": "vendor page",
      },
    });

    expect(changed).toEqual([]);
    expect(models["inception/mercury-2.5"]!.pricing.inputCostPerToken).toBe(4e-8);
    expect(models["deepseek/deepseek-v4-pro"]!.pricing.inputCostPerToken).toBe(7.83e-7);
  });

  it("takes litellm's cache-write rate, the gap gpt-5.6-sol had", () => {
    // OpenRouter carried the flex tier's $2.50 per million write rate. OpenAI's
    // standard tier charges $5.00, which is what litellm publishes.
    const models = {
      "openai/gpt-5.6-sol": model("openai/gpt-5.6-sol", {
        inputCostPerToken: 4e-6,
        inputCacheWritePerToken: 2.5e-6,
      }),
    };
    const litellm = {
      "openai/gpt-5.6-sol": {
        inputCostPerToken: 4e-6,
        outputCostPerToken: 2e-5,
        inputCacheWritePerToken: 5e-6,
      },
    } satisfies Record<string, LLMModelPricing>;

    applyLitellmPreference({
      models,
      litellmById: litellm,
      preferred: { "openai/gpt-5.6-sol": "vendor page" },
    });

    expect(models["openai/gpt-5.6-sol"]!.pricing.inputCacheWritePerToken).toBe(5e-6);
  });

  it("gives every listed model a reason", () => {
    for (const [id, reason] of Object.entries(LITELLM_PREFERRED)) {
      expect(reason.length, id).toBeGreaterThan(20);
    }
  });
});
