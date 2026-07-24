import { beforeEach, describe, expect, it, vi } from "vitest";
import { KEY_CHECK, MASKED_KEY_PLACEHOLDER } from "../../../../utils/constants";
import type { CustomModelEntry } from "../../../modelProviders/customModel.schema";
import { customModelUpdateInputSchema } from "../../../modelProviders/customModel.schema";
import type { MaybeStoredModelProvider } from "../../../modelProviders/registry";
import {
  getModelMetadataForFrontend,
  mergeCustomModelMetadata,
  type ModelMetadataForFrontend,
  prepareLitellmParams,
} from "../modelProviders";

/**
 * Unit tests for modelProviders router helper functions
 */

// Extract the masking logic for testing
function maskKeys(
  customKeys: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(customKeys).map(([key, value]) => [
      key,
      KEY_CHECK.some((k) => key.includes(k)) ? MASKED_KEY_PLACEHOLDER : value,
    ]),
  );
}

// Extract the key merging logic for testing
function mergeKeysWithExisting(
  validatedKeys: Record<string, unknown>,
  existingKeys: Record<string, unknown>,
): Record<string, unknown> {
  return {
    // Start with new keys
    ...validatedKeys,
    // Override with existing values for masked standard keys
    ...Object.fromEntries(
      Object.entries(existingKeys)
        .filter(([key]) => validatedKeys[key] === MASKED_KEY_PLACEHOLDER)
        .map(([key, value]) => [key, value]),
    ),
  };
}

describe("modelProviders key masking logic", () => {
  describe("maskKeys", () => {
    it("masks fields containing _KEY", () => {
      const customKeys = {
        OPENAI_API_KEY: "sk-actual-secret-key",
        OPENAI_BASE_URL: "https://api.openai.com/v1",
      };

      const result = maskKeys(customKeys);

      expect(result.OPENAI_API_KEY).toBe(MASKED_KEY_PLACEHOLDER);
      expect(result.OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
    });

    it("masks fields containing _ACCESS_KEY", () => {
      const customKeys = {
        AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
        AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        AWS_REGION_NAME: "us-east-1",
      };

      const result = maskKeys(customKeys);

      expect(result.AWS_ACCESS_KEY_ID).toBe(MASKED_KEY_PLACEHOLDER);
      expect(result.AWS_SECRET_ACCESS_KEY).toBe(MASKED_KEY_PLACEHOLDER);
      expect(result.AWS_REGION_NAME).toBe("us-east-1");
    });

    it("does not mask URL fields", () => {
      const customKeys = {
        OPENAI_API_KEY: "sk-test",
        OPENAI_BASE_URL: "https://custom.openai.com/v1",
        AZURE_OPENAI_ENDPOINT: "https://myresource.openai.azure.com",
      };

      const result = maskKeys(customKeys);

      expect(result.OPENAI_BASE_URL).toBe("https://custom.openai.com/v1");
      expect(result.AZURE_OPENAI_ENDPOINT).toBe(
        "https://myresource.openai.azure.com",
      );
    });

    it("handles empty customKeys", () => {
      const result = maskKeys({});
      expect(result).toEqual({});
    });

    it("masks Anthropic API key", () => {
      const customKeys = {
        ANTHROPIC_API_KEY: "sk-ant-api03-secret",
      };

      const result = maskKeys(customKeys);

      expect(result.ANTHROPIC_API_KEY).toBe(MASKED_KEY_PLACEHOLDER);
    });
  });

  describe("mergeKeysWithExisting", () => {
    it("preserves existing keys when new value is masked placeholder", () => {
      const validatedKeys = {
        OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
        OPENAI_BASE_URL: "https://new-url.com/v1",
      };
      const existingKeys = {
        OPENAI_API_KEY: "sk-existing-secret-key",
        OPENAI_BASE_URL: "https://old-url.com/v1",
      };

      const result = mergeKeysWithExisting(validatedKeys, existingKeys);

      expect(result.OPENAI_API_KEY).toBe("sk-existing-secret-key");
      expect(result.OPENAI_BASE_URL).toBe("https://new-url.com/v1");
    });

    it("uses new values when they are not masked", () => {
      const validatedKeys = {
        OPENAI_API_KEY: "sk-new-key",
        OPENAI_BASE_URL: "https://new-url.com/v1",
      };
      const existingKeys = {
        OPENAI_API_KEY: "sk-old-key",
        OPENAI_BASE_URL: "https://old-url.com/v1",
      };

      const result = mergeKeysWithExisting(validatedKeys, existingKeys);

      expect(result.OPENAI_API_KEY).toBe("sk-new-key");
      expect(result.OPENAI_BASE_URL).toBe("https://new-url.com/v1");
    });
  });
});

describe("getModelMetadataForFrontend", () => {
  it("returns a record of model metadata", () => {
    const metadata = getModelMetadataForFrontend();

    expect(typeof metadata).toBe("object");
    expect(Object.keys(metadata).length).toBeGreaterThan(0);
  });

  it("each model has required fields", () => {
    const metadata = getModelMetadataForFrontend();
    const firstModel = Object.values(metadata)[0] as ModelMetadataForFrontend;

    expect(firstModel).toHaveProperty("id");
    expect(firstModel).toHaveProperty("name");
    expect(firstModel).toHaveProperty("provider");
    expect(firstModel).toHaveProperty("supportedParameters");
    expect(firstModel).toHaveProperty("contextLength");
    expect(firstModel).toHaveProperty("maxCompletionTokens");
    expect(firstModel).toHaveProperty("defaultParameters");
    expect(firstModel).toHaveProperty("supportsImageInput");
    expect(firstModel).toHaveProperty("supportsAudioInput");
    expect(firstModel).toHaveProperty("pricing");
  });

  it("includes OpenAI models", () => {
    const metadata = getModelMetadataForFrontend();
    const openaiModels = Object.keys(metadata).filter((k) =>
      k.startsWith("openai/"),
    );

    expect(openaiModels.length).toBeGreaterThan(0);
  });

  it("model metadata includes supportedParameters array", () => {
    const metadata = getModelMetadataForFrontend();
    const gpt5 = metadata["openai/gpt-5.2"];

    expect(gpt5).toBeDefined();
    expect(Array.isArray(gpt5?.supportedParameters)).toBe(true);
  });

  it("model metadata includes pricing information", () => {
    const metadata = getModelMetadataForFrontend();
    const gpt5 = metadata["openai/gpt-5.2"];

    expect(gpt5?.pricing).toBeDefined();
    expect(gpt5?.pricing.inputCostPerToken).toBeGreaterThan(0);
    expect(gpt5?.pricing.outputCostPerToken).toBeGreaterThan(0);
  });

  it("identifies multimodal models", () => {
    const metadata = getModelMetadataForFrontend();
    const imageModels = Object.values(metadata).filter(
      (m) => m.supportsImageInput,
    );

    expect(imageModels.length).toBeGreaterThan(0);
  });

  it("model IDs are consistent with keys", () => {
    const metadata = getModelMetadataForFrontend();

    for (const [key, model] of Object.entries(metadata)) {
      expect(model.id).toBe(key);
    }
  });

  it("includes reasoningConfig for reasoning models", () => {
    const metadata = getModelMetadataForFrontend();
    const gpt52 = metadata["openai/gpt-5.2"];

    expect(gpt52?.reasoningConfig).toBeDefined();
    expect(gpt52?.reasoningConfig?.supported).toBe(true);
    expect(gpt52?.reasoningConfig?.allowedValues).toContain("low");
    expect(gpt52?.reasoningConfig?.allowedValues).toContain("high");
  });

  it("reasoningConfig is undefined for non-reasoning models", () => {
    const metadata = getModelMetadataForFrontend();
    const gpt4 = metadata["openai/gpt-4o"];

    // GPT-4o doesn't have reasoning config
    expect(gpt4?.reasoningConfig).toBeUndefined();
  });
});

describe("prepareLitellmParams", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  const createMockProvider = (
    provider: string,
    customKeys: Record<string, string> | null = null,
  ): MaybeStoredModelProvider => ({
    provider,
    enabled: true,
    customKeys,
    models: null,
    embeddingsModels: null,
    deploymentMapping: null,
    extraHeaders: null,
  });

  describe("Anthropic URL normalization", () => {
    it("strips /v1 suffix from Anthropic api_base", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1");

      const modelProvider = createMockProvider("anthropic");
      const result = await prepareLitellmParams({
        model: "anthropic/claude-opus-4.5",
        modelProvider,
        projectId: "test-project",
      });

      expect(result.api_base).toBe("https://api.anthropic.com");
    });

    it("strips /v1/ suffix (with trailing slash) from Anthropic api_base", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1/");

      const modelProvider = createMockProvider("anthropic");
      const result = await prepareLitellmParams({
        model: "anthropic/claude-opus-4.5",
        modelProvider,
        projectId: "test-project",
      });

      expect(result.api_base).toBe("https://api.anthropic.com");
    });

    it("preserves custom Anthropic base URL without /v1", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("ANTHROPIC_BASE_URL", "https://custom-anthropic.example.com");

      const modelProvider = createMockProvider("anthropic");
      const result = await prepareLitellmParams({
        model: "anthropic/claude-opus-4.5",
        modelProvider,
        projectId: "test-project",
      });

      expect(result.api_base).toBe("https://custom-anthropic.example.com");
    });

    it("uses custom keys api_base for Anthropic with /v1 stripped", async () => {
      const modelProvider = createMockProvider("anthropic", {
        ANTHROPIC_API_KEY: "custom-key",
        ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
      });

      const result = await prepareLitellmParams({
        model: "anthropic/claude-opus-4.5",
        modelProvider,
        projectId: "test-project",
      });

      expect(result.api_base).toBe("https://api.anthropic.com");
    });
  });

  describe("non-Anthropic providers", () => {
    it("preserves /v1 suffix for OpenAI", async () => {
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      vi.stubEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");

      const modelProvider = createMockProvider("openai");
      const result = await prepareLitellmParams({
        model: "openai/gpt-4o",
        modelProvider,
        projectId: "test-project",
      });

      expect(result.api_base).toBe("https://api.openai.com/v1");
    });

    it("preserves /v1 suffix for custom provider", async () => {
      vi.stubEnv("CUSTOM_API_KEY", "test-key");
      vi.stubEnv("CUSTOM_BASE_URL", "https://custom-llm.example.com/v1");

      const modelProvider = createMockProvider("custom");
      const result = await prepareLitellmParams({
        model: "custom/my-model",
        modelProvider,
        projectId: "test-project",
      });

      expect(result.api_base).toBe("https://custom-llm.example.com/v1");
    });
  });
});

describe("customModelUpdateInputSchema", () => {
  describe("when given new CustomModelEntry[] format", () => {
    it("accepts an array of CustomModelEntry objects", () => {
      const input: CustomModelEntry[] = [
        { modelId: "gpt-5-custom", displayName: "GPT-5 Custom", mode: "chat" },
        {
          modelId: "my-embedding",
          displayName: "My Embedding",
          mode: "embedding",
        },
      ];

      const result = customModelUpdateInputSchema.safeParse(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(input);
    });

    it("accepts CustomModelEntry objects with optional fields", () => {
      const input: CustomModelEntry[] = [
        {
          modelId: "gpt-5-custom",
          displayName: "GPT-5 Custom",
          mode: "chat",
          maxTokens: 8192,
          supportedParameters: ["temperature", "top_p"],
          multimodalInputs: ["image", "audio"],
        },
      ];

      const result = customModelUpdateInputSchema.safeParse(input);

      expect(result.success).toBe(true);
    });
  });

  describe("when given legacy string[] format", () => {
    it("accepts an array of strings for backward compatibility", () => {
      const input = ["gpt-5-custom", "my-model"];

      const result = customModelUpdateInputSchema.safeParse(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(input);
    });

    it("accepts an empty array", () => {
      const result = customModelUpdateInputSchema.safeParse([]);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe("when given invalid input", () => {
    it("rejects mixed arrays of strings and objects", () => {
      const input = [
        "some-string",
        { modelId: "x", displayName: "X", mode: "chat" },
      ];

      const result = customModelUpdateInputSchema.safeParse(input);

      expect(result.success).toBe(false);
    });
  });
});

describe("mergeCustomModelMetadata", () => {
  describe("when providers have custom models", () => {
    it("adds custom model entries to metadata record", () => {
      const existingMetadata: Record<string, ModelMetadataForFrontend> = {};
      const providers: Record<string, MaybeStoredModelProvider> = {
        openai: {
          provider: "openai",
          enabled: true,
          customKeys: null,
          models: null,
          embeddingsModels: null,
          deploymentMapping: null,
          extraHeaders: null,
          customModels: [
            {
              modelId: "gpt-5-custom",
              displayName: "GPT-5 Custom",
              mode: "chat",
              maxTokens: 4096,
              supportedParameters: ["temperature", "top_p"],
              multimodalInputs: ["image"],
            },
          ],
          customEmbeddingsModels: [
            {
              modelId: "custom-embed",
              displayName: "Custom Embed",
              mode: "embedding",
            },
          ],
        },
      };

      const result = mergeCustomModelMetadata(existingMetadata, providers);

      expect(result["openai/gpt-5-custom"]).toBeDefined();
      expect(result["openai/gpt-5-custom"]?.name).toBe("GPT-5 Custom");
      expect(result["openai/gpt-5-custom"]?.provider).toBe("openai");
      expect(result["openai/gpt-5-custom"]?.maxCompletionTokens).toBe(4096);
      expect(result["openai/gpt-5-custom"]?.supportedParameters).toEqual([
        "temperature",
        "top_p",
      ]);
      expect(result["openai/gpt-5-custom"]?.supportsImageInput).toBe(true);

      expect(result["openai/custom-embed"]).toBeDefined();
      expect(result["openai/custom-embed"]?.name).toBe("Custom Embed");
    });
  });

  describe("when providers have no custom models", () => {
    it("returns metadata unchanged", () => {
      const existingMetadata: Record<string, ModelMetadataForFrontend> = {
        "openai/gpt-4o": {
          id: "openai/gpt-4o",
          name: "gpt-4o",
          provider: "openai",
          supportedParameters: ["temperature"],
          contextLength: 128000,
          maxCompletionTokens: 4096,
          defaultParameters: null,
          supportsImageInput: true,
          supportsAudioInput: false,
          pricing: {
            inputCostPerToken: 0.001,
            outputCostPerToken: 0.002,
          },
        },
      };
      const providers: Record<string, MaybeStoredModelProvider> = {
        openai: {
          provider: "openai",
          enabled: true,
          customKeys: null,
          models: null,
          embeddingsModels: null,
          deploymentMapping: null,
          extraHeaders: null,
        },
      };

      const result = mergeCustomModelMetadata(existingMetadata, providers);

      expect(result).toEqual(existingMetadata);
    });
  });

  describe("when custom model has no optional fields", () => {
    it("uses sensible defaults for missing metadata", () => {
      const existingMetadata: Record<string, ModelMetadataForFrontend> = {};
      const providers: Record<string, MaybeStoredModelProvider> = {
        openai: {
          provider: "openai",
          enabled: true,
          customKeys: null,
          models: null,
          embeddingsModels: null,
          deploymentMapping: null,
          extraHeaders: null,
          customModels: [
            {
              modelId: "bare-model",
              displayName: "Bare Model",
              mode: "chat",
            },
          ],
        },
      };

      const result = mergeCustomModelMetadata(existingMetadata, providers);

      const model = result["openai/bare-model"];
      expect(model).toBeDefined();
      expect(model?.maxCompletionTokens).toBeNull();
      expect(model?.supportedParameters).toEqual([]);
      expect(model?.supportsImageInput).toBe(false);
      expect(model?.supportsAudioInput).toBe(false);
      expect(model?.contextLength).toBe(0);
    });
  });
});
