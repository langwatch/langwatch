import { describe, expect, it } from "vitest";
import { KEY_CHECK, MASKED_KEY_PLACEHOLDER } from "../../../../utils/constants";
import { getModelMetadataForFrontend, type ModelMetadataForFrontend } from "../modelProviders";

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
      k.startsWith("openai/")
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
      (m) => m.supportsImageInput
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
