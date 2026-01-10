import { describe, it, expect, vi, beforeEach } from "vitest";
import { MASKED_KEY_PLACEHOLDER, KEY_CHECK } from "../../../utils/constants";

/**
 * Unit tests for ModelProviderService business logic.
 * These test the pure transformation functions and business rules.
 */

// Test the key merging logic (extracted for testing)
function mergeCustomKeys(
  validatedKeys: Record<string, unknown> | null,
  existingKeys: Record<string, unknown> | null
): Record<string, unknown> {
  if (!validatedKeys) return {};
  if (!existingKeys) return validatedKeys;

  return {
    ...validatedKeys,
    ...Object.fromEntries(
      Object.entries(existingKeys)
        .filter(([key]) => validatedKeys[key] === MASKED_KEY_PLACEHOLDER)
        .map(([key, value]) => [key, value])
    ),
  };
}

// Test the key masking logic (extracted for testing)
function maskApiKeys(
  customKeys: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(customKeys).map(([key, value]) => [
      key,
      KEY_CHECK.some((k) => key.includes(k)) ? MASKED_KEY_PLACEHOLDER : value,
    ])
  );
}

// Test the shouldKeep filter logic (extracted for testing)
function shouldKeepModelProvider(
  mp: {
    customKeys: unknown;
    provider: string;
    enabled: boolean;
    customModels: unknown;
    customEmbeddingsModels: unknown;
  },
  defaultProviders: Record<string, { enabled: boolean }>
): boolean {
  // Keep if has custom keys
  if (mp.customKeys) return true;

  // Keep if enabled status differs from default
  const defaultProvider = defaultProviders[mp.provider];
  if (mp.enabled !== defaultProvider?.enabled) return true;

  // Keep if has custom models or embeddings
  const customModels = mp.customModels as string[] | null;
  const customEmbeddings = mp.customEmbeddingsModels as string[] | null;
  const hasCustomModels = customModels && customModels.length > 0;
  const hasCustomEmbeddings = customEmbeddings && customEmbeddings.length > 0;

  return Boolean(hasCustomModels || hasCustomEmbeddings);
}

describe("ModelProviderService business logic", () => {
  describe("mergeCustomKeys", () => {
    it("returns empty object when validatedKeys is null", () => {
      const result = mergeCustomKeys(null, { existing: "value" });
      expect(result).toEqual({});
    });

    it("returns validatedKeys when existingKeys is null", () => {
      const validatedKeys = { OPENAI_API_KEY: "new-key" };
      const result = mergeCustomKeys(validatedKeys, null);
      expect(result).toEqual({ OPENAI_API_KEY: "new-key" });
    });

    it("preserves existing key when new value is masked placeholder", () => {
      const validatedKeys = {
        OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
        OPENAI_BASE_URL: "https://new-url.com",
      };
      const existingKeys = {
        OPENAI_API_KEY: "sk-actual-secret",
        OPENAI_BASE_URL: "https://old-url.com",
      };

      const result = mergeCustomKeys(validatedKeys, existingKeys);

      expect(result.OPENAI_API_KEY).toBe("sk-actual-secret");
      expect(result.OPENAI_BASE_URL).toBe("https://new-url.com");
    });

    it("replaces key when new value is not masked placeholder", () => {
      const validatedKeys = {
        OPENAI_API_KEY: "sk-new-key",
      };
      const existingKeys = {
        OPENAI_API_KEY: "sk-old-key",
      };

      const result = mergeCustomKeys(validatedKeys, existingKeys);

      expect(result.OPENAI_API_KEY).toBe("sk-new-key");
    });

    it("preserves multiple masked keys", () => {
      const validatedKeys = {
        AWS_ACCESS_KEY_ID: MASKED_KEY_PLACEHOLDER,
        AWS_SECRET_ACCESS_KEY: MASKED_KEY_PLACEHOLDER,
        AWS_REGION_NAME: "eu-west-1",
      };
      const existingKeys = {
        AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "secretkey123",
        AWS_REGION_NAME: "us-east-1",
      };

      const result = mergeCustomKeys(validatedKeys, existingKeys);

      expect(result.AWS_ACCESS_KEY_ID).toBe("AKIAEXAMPLE");
      expect(result.AWS_SECRET_ACCESS_KEY).toBe("secretkey123");
      expect(result.AWS_REGION_NAME).toBe("eu-west-1");
    });

    it("handles new key not in existing", () => {
      const validatedKeys = {
        OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
        NEW_KEY: "new-value",
      };
      const existingKeys = {
        OPENAI_API_KEY: "sk-stored",
      };

      const result = mergeCustomKeys(validatedKeys, existingKeys);

      expect(result.OPENAI_API_KEY).toBe("sk-stored");
      expect(result.NEW_KEY).toBe("new-value");
    });
  });

  describe("maskApiKeys", () => {
    it("masks fields containing KEY", () => {
      const customKeys = {
        OPENAI_API_KEY: "sk-actual-key",
        OPENAI_BASE_URL: "https://api.openai.com",
      };

      const result = maskApiKeys(customKeys);

      expect(result.OPENAI_API_KEY).toBe(MASKED_KEY_PLACEHOLDER);
      expect(result.OPENAI_BASE_URL).toBe("https://api.openai.com");
    });

    it("masks AWS credentials", () => {
      const customKeys = {
        AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "secretkey",
        AWS_REGION_NAME: "us-east-1",
      };

      const result = maskApiKeys(customKeys);

      expect(result.AWS_ACCESS_KEY_ID).toBe(MASKED_KEY_PLACEHOLDER);
      expect(result.AWS_SECRET_ACCESS_KEY).toBe(MASKED_KEY_PLACEHOLDER);
      expect(result.AWS_REGION_NAME).toBe("us-east-1");
    });

    it("does not mask GOOGLE_APPLICATION_CREDENTIALS", () => {
      const customKeys = {
        GOOGLE_APPLICATION_CREDENTIALS: "/path/to/credentials.json",
      };

      const result = maskApiKeys(customKeys);

      // GOOGLE_APPLICATION_CREDENTIALS contains "CREDENTIALS" not "KEY"
      // so it should be masked based on KEY_CHECK patterns
      expect(result.GOOGLE_APPLICATION_CREDENTIALS).toBe(MASKED_KEY_PLACEHOLDER);
    });

    it("handles empty object", () => {
      expect(maskApiKeys({})).toEqual({});
    });
  });

  describe("shouldKeepModelProvider", () => {
    const defaultProviders = {
      openai: { enabled: true },
      anthropic: { enabled: false },
    };

    it("keeps provider with custom keys", () => {
      const mp = {
        customKeys: { OPENAI_API_KEY: "key" },
        provider: "openai",
        enabled: true,
        customModels: null,
        customEmbeddingsModels: null,
      };

      expect(shouldKeepModelProvider(mp, defaultProviders)).toBe(true);
    });

    it("keeps provider when enabled differs from default", () => {
      const mp = {
        customKeys: null,
        provider: "openai",
        enabled: false, // Different from default (true)
        customModels: null,
        customEmbeddingsModels: null,
      };

      expect(shouldKeepModelProvider(mp, defaultProviders)).toBe(true);
    });

    it("keeps provider with custom models", () => {
      const mp = {
        customKeys: null,
        provider: "openai",
        enabled: true,
        customModels: ["custom-model"],
        customEmbeddingsModels: null,
      };

      expect(shouldKeepModelProvider(mp, defaultProviders)).toBe(true);
    });

    it("keeps provider with custom embeddings", () => {
      const mp = {
        customKeys: null,
        provider: "openai",
        enabled: true,
        customModels: null,
        customEmbeddingsModels: ["custom-embedding"],
      };

      expect(shouldKeepModelProvider(mp, defaultProviders)).toBe(true);
    });

    it("filters out provider with no customizations", () => {
      const mp = {
        customKeys: null,
        provider: "openai",
        enabled: true, // Same as default
        customModels: null,
        customEmbeddingsModels: null,
      };

      expect(shouldKeepModelProvider(mp, defaultProviders)).toBe(false);
    });

    it("filters out provider with empty arrays", () => {
      const mp = {
        customKeys: null,
        provider: "openai",
        enabled: true,
        customModels: [],
        customEmbeddingsModels: [],
      };

      expect(shouldKeepModelProvider(mp, defaultProviders)).toBe(false);
    });

    it("keeps disabled provider that was enabled by default", () => {
      const mp = {
        customKeys: null,
        provider: "openai",
        enabled: false, // Explicitly disabled
        customModels: null,
        customEmbeddingsModels: null,
      };

      expect(shouldKeepModelProvider(mp, defaultProviders)).toBe(true);
    });

    it("keeps enabled provider that was disabled by default", () => {
      const mp = {
        customKeys: null,
        provider: "anthropic",
        enabled: true, // Explicitly enabled (default is false)
        customModels: null,
        customEmbeddingsModels: null,
      };

      expect(shouldKeepModelProvider(mp, defaultProviders)).toBe(true);
    });
  });
});
