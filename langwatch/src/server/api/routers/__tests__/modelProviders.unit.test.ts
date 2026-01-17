import { describe, expect, it } from "vitest";
import { KEY_CHECK, MASKED_KEY_PLACEHOLDER } from "../../../../utils/constants";

/**
 * Unit tests for the key masking and merging logic used in modelProviders router.
 * These test the pure transformation functions that handle API key security.
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
    it("preserves existing key when new value is masked placeholder", () => {
      const validatedKeys = {
        OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
        OPENAI_BASE_URL: "https://new-url.com/v1",
      };
      const existingKeys = {
        OPENAI_API_KEY: "sk-actual-stored-key",
        OPENAI_BASE_URL: "https://old-url.com/v1",
      };

      const result = mergeKeysWithExisting(validatedKeys, existingKeys);

      expect(result.OPENAI_API_KEY).toBe("sk-actual-stored-key");
      expect(result.OPENAI_BASE_URL).toBe("https://new-url.com/v1");
    });

    it("replaces all keys when none are masked", () => {
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

    it("preserves multiple masked keys", () => {
      const validatedKeys = {
        AWS_ACCESS_KEY_ID: MASKED_KEY_PLACEHOLDER,
        AWS_SECRET_ACCESS_KEY: MASKED_KEY_PLACEHOLDER,
        AWS_REGION_NAME: "eu-west-1",
      };
      const existingKeys = {
        AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
        AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/EXAMPLE",
        AWS_REGION_NAME: "us-east-1",
      };

      const result = mergeKeysWithExisting(validatedKeys, existingKeys);

      expect(result.AWS_ACCESS_KEY_ID).toBe("AKIAIOSFODNN7EXAMPLE");
      expect(result.AWS_SECRET_ACCESS_KEY).toBe("wJalrXUtnFEMI/EXAMPLE");
      expect(result.AWS_REGION_NAME).toBe("eu-west-1");
    });

    it("handles empty existing keys", () => {
      const validatedKeys = {
        OPENAI_API_KEY: "sk-new-key",
      };
      const existingKeys = {};

      const result = mergeKeysWithExisting(validatedKeys, existingKeys);

      expect(result.OPENAI_API_KEY).toBe("sk-new-key");
    });

    it("handles adding new key not in existing", () => {
      const validatedKeys = {
        OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
        OPENAI_BASE_URL: "https://custom.com/v1",
      };
      const existingKeys = {
        OPENAI_API_KEY: "sk-stored-key",
      };

      const result = mergeKeysWithExisting(validatedKeys, existingKeys);

      expect(result.OPENAI_API_KEY).toBe("sk-stored-key");
      expect(result.OPENAI_BASE_URL).toBe("https://custom.com/v1");
    });
  });
});

describe("KEY_CHECK patterns", () => {
  it("includes KEY pattern", () => {
    expect(KEY_CHECK).toContain("KEY");
  });

  it("includes GOOGLE_APPLICATION_CREDENTIALS pattern", () => {
    expect(KEY_CHECK).toContain("GOOGLE_APPLICATION_CREDENTIALS");
  });

  it("matches common API key field names", () => {
    const apiKeyFields = [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GEMINI_API_KEY",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AZURE_OPENAI_API_KEY",
    ];

    apiKeyFields.forEach((field) => {
      const matches = KEY_CHECK.some((k) => field.includes(k));
      expect(matches).toBe(true);
    });
  });

  it("does not match URL fields", () => {
    const urlFields = [
      "OPENAI_BASE_URL",
      "AZURE_OPENAI_ENDPOINT",
      "CUSTOM_BASE_URL",
      "AWS_REGION_NAME",
    ];

    urlFields.forEach((field) => {
      const matches = KEY_CHECK.some((k) => field.includes(k));
      expect(matches).toBe(false);
    });
  });
});
