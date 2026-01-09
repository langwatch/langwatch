/**
 * Unit tests for model registry functions
 */

import { describe, it, expect } from "vitest";
import {
  getAllModels,
  getModelById,
  getModelMetadata,
  getProviderModelOptions,
  getModelsForProvider,
  getAllProviders,
  getRegistryMetadata,
  allLitellmModels,
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
      const model = getModelById("openai/gpt-5.2");
      expect(model).toBeDefined();
      expect(model?.name).toContain("GPT");
    });

    it("returns undefined for non-existent model", () => {
      const model = getModelById("nonexistent/model");
      expect(model).toBeUndefined();
    });
  });

  describe("getModelMetadata", () => {
    it("returns metadata for existing model", () => {
      const metadata = getModelMetadata("openai/gpt-5.2");

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
      const metadata = getModelMetadata("openai/gpt-5.2");
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
        k.startsWith("openai/")
      );
      expect(openaiModels.length).toBeGreaterThan(0);
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
    for (const [key, provider] of Object.entries(modelProviders)) {
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
      (m) => m.pricing.inputCostPerToken > 0
    );

    expect(modelWithPricing).toBeDefined();
    expect(modelWithPricing?.pricing.inputCostPerToken).toBeGreaterThan(0);
  });

  it("some models have cache pricing", () => {
    const models = getAllModels();
    const modelWithCache = Object.values(models).find(
      (m) => m.pricing.inputCacheReadPerToken !== undefined
    );

    expect(modelWithCache).toBeDefined();
  });
});

describe("Model Parameters", () => {
  it("models have supportedParameters array", () => {
    const models = getAllModels();
    const modelWithParams = Object.values(models).find(
      (m) => m.supportedParameters.length > 0
    );

    expect(modelWithParams).toBeDefined();
    expect(modelWithParams?.supportedParameters).toBeInstanceOf(Array);
  });

  it("some models support reasoning parameter", () => {
    const models = getAllModels();
    const reasoningModel = Object.values(models).find((m) =>
      m.supportedParameters.includes("reasoning")
    );

    expect(reasoningModel).toBeDefined();
  });

  it("traditional models support temperature", () => {
    const models = getAllModels();
    const tempModel = Object.values(models).find((m) =>
      m.supportedParameters.includes("temperature")
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
