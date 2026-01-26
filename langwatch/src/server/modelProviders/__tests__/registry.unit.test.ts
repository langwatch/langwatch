/**
 * Unit tests for model registry functions
 */

import { describe, expect, it } from "vitest";
import {
  allLitellmModels,
  getAllModels,
  getAllProviders,
  getModelById,
  getModelMetadata,
  getModelsForProvider,
  getParameterConstraints,
  getProviderModelOptions,
  getRegistryMetadata,
  hasVariantSuffix,
  KNOWN_VARIANT_SUFFIXES,
  modelProviders,
} from "../registry";

describe("Registry Model Access", () => {
  describe("getAllModels", () => {
    it("returns all models as a record", () => {
      const models = getAllModels();
      expect(typeof models).toBe("object");
      expect(Object.keys(models).length).toBeGreaterThan(0);
    });

    it("models have required fields", () => {
      const models = getAllModels();
      const firstModel = Object.values(models)[0];

      expect(firstModel).toHaveProperty("id");
      expect(firstModel).toHaveProperty("name");
      expect(firstModel).toHaveProperty("provider");
      expect(firstModel).toHaveProperty("pricing");
      expect(firstModel).toHaveProperty("contextLength");
      expect(firstModel).toHaveProperty("supportedParameters");
      expect(firstModel).toHaveProperty("mode");
    });
  });

  describe("getModelById", () => {
    it("returns a model when it exists", () => {
      const allModels = getAllModels();
      const modelId = Object.keys(allModels)[0]!;
      const model = getModelById(modelId);
      expect(model).toBeDefined();
      expect(model?.name).toBeDefined();
    });

    it("returns undefined for non-existent model", () => {
      const model = getModelById("nonexistent/model");
      expect(model).toBeUndefined();
    });
  });

  describe("getModelMetadata", () => {
    it("returns metadata for existing model", () => {
      const allModels = getAllModels();
      const modelId = Object.keys(allModels)[0]!;
      const metadata = getModelMetadata(modelId);

      expect(metadata).not.toBeNull();
      expect(metadata?.supportedParameters).toBeInstanceOf(Array);
      expect(typeof metadata?.contextLength).toBe("number");
      expect(metadata?.pricing).toHaveProperty("inputCostPerToken");
      expect(metadata?.pricing).toHaveProperty("outputCostPerToken");
    });

    it("returns null for non-existent model", () => {
      const metadata = getModelMetadata("nonexistent/model");
      expect(metadata).toBeNull();
    });

    it("includes multimodal flags", () => {
      const allModels = getAllModels();
      const modelId = Object.keys(allModels)[0]!;
      const metadata = getModelMetadata(modelId);
      expect(metadata).toHaveProperty("supportsImageInput");
      expect(metadata).toHaveProperty("supportsAudioInput");
    });
  });

  describe("getProviderModelOptions", () => {
    it("returns models for a valid provider", () => {
      const options = getProviderModelOptions("openai", "chat");
      expect(options.length).toBeGreaterThan(0);
      expect(options[0]).toHaveProperty("value");
      expect(options[0]).toHaveProperty("label");
    });

    it("returns empty array for provider with no models of that mode", () => {
      // Most providers don't have embedding models
      const options = getProviderModelOptions("xai", "embedding");
      expect(options).toBeInstanceOf(Array);
    });

    it("filters by mode correctly", () => {
      const chatModels = getProviderModelOptions("openai", "chat");
      const embeddingModels = getProviderModelOptions("openai", "embedding");

      // Should have some chat models
      expect(chatModels.length).toBeGreaterThan(0);

      // Chat and embedding should be different sets
      const chatValues = chatModels.map((m) => m.value);
      const embeddingValues = embeddingModels.map((m) => m.value);

      // No overlap (embedding model shouldn't appear in chat)
      const overlap = chatValues.filter((v) => embeddingValues.includes(v));
      expect(overlap.length).toBe(0);
    });
  });

  describe("getModelsForProvider", () => {
    it("returns all models for a provider", () => {
      const models = getModelsForProvider("openai");
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === "openai")).toBe(true);
    });

    it("returns empty array for unknown provider", () => {
      const models = getModelsForProvider("nonexistent-provider");
      expect(models).toEqual([]);
    });
  });

  describe("getAllProviders", () => {
    it("returns sorted list of providers", () => {
      const providers = getAllProviders();
      expect(providers.length).toBeGreaterThan(0);

      // Should be sorted
      const sorted = [...providers].sort();
      expect(providers).toEqual(sorted);
    });

    it("includes major providers", () => {
      const providers = getAllProviders();
      expect(providers).toContain("openai");
      expect(providers).toContain("anthropic");
      expect(providers).toContain("gemini");
    });
  });

  describe("getRegistryMetadata", () => {
    it("returns registry metadata", () => {
      const metadata = getRegistryMetadata();
      expect(metadata).toHaveProperty("updatedAt");
      expect(metadata).toHaveProperty("modelCount");
      expect(typeof metadata.modelCount).toBe("number");
      expect(metadata.modelCount).toBeGreaterThan(0);
    });
  });
});

describe("Backward Compatibility", () => {
  describe("allLitellmModels", () => {
    it("is a record of models with mode", () => {
      expect(typeof allLitellmModels).toBe("object");
      expect(Object.keys(allLitellmModels).length).toBeGreaterThan(0);
    });

    it("each model has mode property", () => {
      const firstModel = Object.values(allLitellmModels)[0];
      expect(firstModel).toHaveProperty("mode");
      expect(["chat", "embedding"]).toContain(firstModel?.mode);
    });

    it("includes OpenAI models with full ID", () => {
      const openaiModels = Object.keys(allLitellmModels).filter((k) =>
        k.startsWith("openai/"),
      );
      expect(openaiModels.length).toBeGreaterThan(0);
    });

    it("excludes models with known variant suffixes", () => {
      const modelIds = Object.keys(allLitellmModels);
      const variantModels = modelIds.filter((id) => hasVariantSuffix(id));
      expect(variantModels).toHaveLength(0);
    });

    it("includes models with numeric suffixes like Bedrock version numbers", () => {
      // Bedrock models use :0 suffix for versions, not variants
      expect(hasVariantSuffix("bedrock/amazon.nova-pro-v1:0")).toBe(false);
      expect(hasVariantSuffix("bedrock/us.anthropic.claude-opus-4-1-20250805-v1:0")).toBe(false);
    });

    it("includes standard models without suffixes", () => {
      expect(allLitellmModels["anthropic/claude-3.5-sonnet"]).toBeDefined();
      expect(allLitellmModels["openai/gpt-4o"]).toBeDefined();
    });
  });
});

describe("hasVariantSuffix", () => {
  describe("known variant suffixes", () => {
    it("returns true for :free suffix", () => {
      expect(hasVariantSuffix("openrouter/model:free")).toBe(true);
    });

    it("returns true for :thinking suffix", () => {
      expect(hasVariantSuffix("anthropic/claude-3-opus:thinking")).toBe(true);
    });

    it("returns true for :extended suffix", () => {
      expect(hasVariantSuffix("openrouter/model:extended")).toBe(true);
    });

    it("returns true for :beta suffix", () => {
      expect(hasVariantSuffix("openai/gpt-5:beta")).toBe(true);
    });
  });

  describe("case insensitivity", () => {
    it("returns true for :FREE (uppercase)", () => {
      expect(hasVariantSuffix("openrouter/model:FREE")).toBe(true);
    });

    it("returns true for :Thinking (mixed case)", () => {
      expect(hasVariantSuffix("anthropic/model:Thinking")).toBe(true);
    });

    it("returns true for :EXTENDED (uppercase)", () => {
      expect(hasVariantSuffix("openrouter/model:EXTENDED")).toBe(true);
    });

    it("returns true for :BETA (uppercase)", () => {
      expect(hasVariantSuffix("openai/model:BETA")).toBe(true);
    });
  });

  describe("numeric suffixes (Bedrock version numbers)", () => {
    it("returns false for :0 suffix", () => {
      expect(hasVariantSuffix("bedrock/amazon.nova-pro-v1:0")).toBe(false);
    });

    it("returns false for :1 suffix", () => {
      expect(hasVariantSuffix("bedrock/model:1")).toBe(false);
    });

    it("returns false for multi-digit numeric suffix", () => {
      expect(hasVariantSuffix("bedrock/model:123")).toBe(false);
    });
  });

  describe("models without colons", () => {
    it("returns false for model without any colon", () => {
      expect(hasVariantSuffix("openai/gpt-4o")).toBe(false);
    });

    it("returns false for model with only provider slash", () => {
      expect(hasVariantSuffix("anthropic/claude-3.5-sonnet")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles model with multiple colons correctly", () => {
      // Should check only the last colon
      expect(hasVariantSuffix("some/model:v1:free")).toBe(true);
    });

    it("returns false for empty string", () => {
      expect(hasVariantSuffix("")).toBe(false);
    });

    it("returns false for unknown suffix after colon", () => {
      expect(hasVariantSuffix("model:unknown")).toBe(false);
    });
  });

  describe("real-world model IDs from major providers", () => {
    // AWS Bedrock models (should NOT be filtered - numeric version suffixes)
    describe("AWS Bedrock", () => {
      it("preserves Anthropic Claude models on Bedrock", () => {
        expect(hasVariantSuffix("anthropic.claude-3-haiku-20240307-v1:0")).toBe(
          false,
        );
        expect(
          hasVariantSuffix("anthropic.claude-opus-4-5-20251101-v1:0"),
        ).toBe(false);
        expect(
          hasVariantSuffix("anthropic.claude-sonnet-4-5-20250929-v1:0"),
        ).toBe(false);
      });

      it("preserves Amazon Nova models", () => {
        expect(hasVariantSuffix("amazon.nova-pro-v1:0")).toBe(false);
        expect(hasVariantSuffix("amazon.nova-2-lite-v1:0")).toBe(false);
        expect(hasVariantSuffix("amazon.titan-embed-text-v2:0")).toBe(false);
      });

      it("preserves Meta Llama models on Bedrock", () => {
        expect(hasVariantSuffix("meta.llama3-70b-instruct-v1:0")).toBe(false);
        expect(hasVariantSuffix("meta.llama3-1-405b-instruct-v1:0")).toBe(false);
      });

      it("preserves Mistral models on Bedrock", () => {
        expect(hasVariantSuffix("mistral.mistral-7b-instruct-v0:2")).toBe(false);
        expect(hasVariantSuffix("mistral.mistral-large-2402-v1:0")).toBe(false);
      });

      it("preserves Cohere models on Bedrock", () => {
        expect(hasVariantSuffix("cohere.embed-v4:0")).toBe(false);
        expect(hasVariantSuffix("cohere.rerank-v3-5:0")).toBe(false);
      });

      it("preserves AI21 models on Bedrock", () => {
        expect(hasVariantSuffix("ai21.jamba-1-5-large-v1:0")).toBe(false);
      });

      it("preserves DeepSeek models on Bedrock", () => {
        expect(hasVariantSuffix("deepseek.r1-v1:0")).toBe(false);
      });

      it("preserves Stability AI models on Bedrock", () => {
        expect(hasVariantSuffix("stability.sd3-5-large-v1:0")).toBe(false);
        expect(hasVariantSuffix("stability.stable-image-ultra-v1:1")).toBe(
          false,
        );
      });
    });

    // Anthropic direct API (no colons)
    describe("Anthropic Direct API", () => {
      it("preserves direct Anthropic model IDs", () => {
        expect(hasVariantSuffix("claude-sonnet-4-5-20250929")).toBe(false);
        expect(hasVariantSuffix("claude-opus-4-5-20251101")).toBe(false);
        expect(hasVariantSuffix("claude-haiku-4-5-20251001")).toBe(false);
      });
    });

    // OpenAI (no colons)
    describe("OpenAI", () => {
      it("preserves OpenAI model IDs", () => {
        expect(hasVariantSuffix("gpt-4o")).toBe(false);
        expect(hasVariantSuffix("gpt-4-turbo")).toBe(false);
        expect(hasVariantSuffix("gpt-3.5-turbo")).toBe(false);
      });
    });

    // Google Gemini (no colons)
    describe("Google Gemini", () => {
      it("preserves Gemini model IDs", () => {
        expect(hasVariantSuffix("gemini-2.5-pro")).toBe(false);
        expect(hasVariantSuffix("gemini-2.5-flash")).toBe(false);
        expect(hasVariantSuffix("gemini-1.5-pro")).toBe(false);
      });
    });

    // LiteLLM routing variants (SHOULD be filtered)
    describe("LiteLLM routing variants", () => {
      it("filters :free variants from OpenRouter", () => {
        expect(hasVariantSuffix("allenai/molmo-2-8b:free")).toBe(true);
        expect(hasVariantSuffix("mistralai/devstral-2512:free")).toBe(true);
        expect(hasVariantSuffix("nvidia/nemotron-3-nano-30b-a3b:free")).toBe(
          true,
        );
      });

      it("filters :thinking variants", () => {
        expect(hasVariantSuffix("qwen/qwen-plus-2025-07-28:thinking")).toBe(
          true,
        );
        expect(hasVariantSuffix("anthropic/claude-3.7-sonnet:thinking")).toBe(
          true,
        );
      });

      it("filters :extended variants", () => {
        expect(hasVariantSuffix("openai/gpt-4o:extended")).toBe(true);
      });
    });
  });
});

describe("Model Provider Definitions", () => {
  it("has definitions for major providers", () => {
    expect(modelProviders).toHaveProperty("openai");
    expect(modelProviders).toHaveProperty("anthropic");
    expect(modelProviders).toHaveProperty("gemini");
    expect(modelProviders).toHaveProperty("azure");
    expect(modelProviders).toHaveProperty("bedrock");
  });

  it("each provider has required fields", () => {
    for (const [_key, provider] of Object.entries(modelProviders)) {
      expect(provider).toHaveProperty("name");
      expect(provider).toHaveProperty("apiKey");
      expect(provider).toHaveProperty("keysSchema");
      expect(provider).toHaveProperty("enabledSince");
    }
  });
});

describe("Model Pricing", () => {
  it("models have valid pricing", () => {
    const models = getAllModels();
    const modelWithPricing = Object.values(models).find(
      (m) => m.pricing.inputCostPerToken > 0,
    );

    expect(modelWithPricing).toBeDefined();
    expect(modelWithPricing?.pricing.inputCostPerToken).toBeGreaterThan(0);
  });

  it("some models have cache pricing", () => {
    const models = getAllModels();
    const modelWithCache = Object.values(models).find(
      (m) => m.pricing.inputCacheReadPerToken !== undefined,
    );

    expect(modelWithCache).toBeDefined();
  });
});

describe("Model Parameters", () => {
  it("models have supportedParameters array", () => {
    const models = getAllModels();
    const modelWithParams = Object.values(models).find(
      (m) => m.supportedParameters.length > 0,
    );

    expect(modelWithParams).toBeDefined();
    expect(modelWithParams?.supportedParameters).toBeInstanceOf(Array);
  });

  it("some models support reasoning parameter", () => {
    const models = getAllModels();
    const reasoningModel = Object.values(models).find((m) =>
      m.supportedParameters.includes("reasoning"),
    );

    expect(reasoningModel).toBeDefined();
  });

  it("traditional models support temperature", () => {
    const models = getAllModels();
    const tempModel = Object.values(models).find((m) =>
      m.supportedParameters.includes("temperature"),
    );

    expect(tempModel).toBeDefined();
  });
});

describe("Multimodal Support", () => {
  it("identifies models with image input support", () => {
    const models = getAllModels();
    const imageModel = Object.values(models).find((m) => m.supportsImageInput);

    expect(imageModel).toBeDefined();
    expect(imageModel?.supportsImageInput).toBe(true);
  });

  it("identifies models with audio input support", () => {
    const models = getAllModels();
    const audioModel = Object.values(models).find((m) => m.supportsAudioInput);

    expect(audioModel).toBeDefined();
    expect(audioModel?.supportsAudioInput).toBe(true);
  });
});

describe("Parameter Constraints", () => {
  describe("getParameterConstraints", () => {
    it("returns constraints for Anthropic models", () => {
      const constraints = getParameterConstraints("anthropic/claude-sonnet-4");

      expect(constraints).toBeDefined();
      expect(constraints?.temperature).toEqual({ min: 0, max: 1 });
    });

    it("returns undefined for OpenAI models (no constraints defined)", () => {
      const constraints = getParameterConstraints("openai/gpt-4.1");

      expect(constraints).toBeUndefined();
    });

    it("returns undefined for unknown provider", () => {
      const constraints = getParameterConstraints("unknown-provider/model");

      expect(constraints).toBeUndefined();
    });

    it("returns undefined for model ID without provider prefix", () => {
      const constraints = getParameterConstraints("standalone-model");

      expect(constraints).toBeUndefined();
    });

    it("returns undefined for empty model ID", () => {
      const constraints = getParameterConstraints("");

      expect(constraints).toBeUndefined();
    });

    it("extracts provider correctly from model ID with slashes", () => {
      // Model IDs like "anthropic/claude-3.5-sonnet" should extract "anthropic"
      const constraints = getParameterConstraints(
        "anthropic/claude-3.5-sonnet",
      );

      expect(constraints).toBeDefined();
      expect(constraints?.temperature?.max).toBe(1);
    });
  });

  describe("Anthropic provider constraints", () => {
    it("has temperature constraint defined", () => {
      expect(modelProviders.anthropic.parameterConstraints).toBeDefined();
      expect(
        modelProviders.anthropic.parameterConstraints?.temperature,
      ).toEqual({
        min: 0,
        max: 1,
      });
    });
  });
});
