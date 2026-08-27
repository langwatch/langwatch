import { describe, expect, it } from "vitest";
import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import { isSecretCredentialField } from "../../../utils/modelProviderHelpers";
import { ModelProviderKeysService } from "@langwatch/model-provider-server";

const mergeStoredCustomKeys = (input: {
  incoming: Record<string, unknown> | null;
  stored: Record<string, unknown> | null;
}): Record<string, unknown> => ModelProviderKeysService.create().merge(input);

/**
 * Unit tests for ModelProviderService business logic.
 * These test the pure transformation functions and business rules.
 */

// Mirrors ModelProviderService.maskRowCustomKeys. It calls the real
// classifier rather than restating the rule, so a change to what counts as a
// secret reaches these expectations instead of passing against a stale copy.
function maskApiKeys(customKeys: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(customKeys).map(([key, value]) => [
      key,
      isSecretCredentialField(key) ? MASKED_KEY_PLACEHOLDER : value,
    ]),
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
  defaultProviders: Record<string, { enabled: boolean }>,
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
  describe("mergeStoredCustomKeys", () => {
    describe("given a row with nothing worth keeping", () => {
      it("drops visible configuration when the write carries no credentials", () => {
        // A base URL is shown back, so a write that omits it is stating the
        // configuration in full and the stored value goes.
        const result = mergeStoredCustomKeys({
          incoming: null,
          stored: { OPENAI_BASE_URL: "https://old-url.com" },
        });
        expect(result).toEqual({});
      });

      it("keeps a stored secret the write never names", () => {
        // The other half of the same rule. A secret is masked on read, so no
        // caller can resend one it did not type, and omitting it cannot mean
        // "delete it".
        const result = mergeStoredCustomKeys({
          incoming: null,
          stored: { CODEX_ACCESS_TOKEN: "stored-token" },
        });
        expect(result).toEqual({ CODEX_ACCESS_TOKEN: "stored-token" });
      });

      it("returns the write untouched when the row is empty", () => {
        const result = mergeStoredCustomKeys({
          incoming: { OPENAI_API_KEY: "new-key" },
          stored: null,
        });
        expect(result).toEqual({ OPENAI_API_KEY: "new-key" });
      });

      it("drops a masked field with nothing behind it", () => {
        // The drawer shows the placeholder for the secret fields of an enabled
        // row it found no credentials on, so this payload is the ordinary save
        // from such a row. Storing the placeholder would give the provider a
        // credential that was never real.
        const result = mergeStoredCustomKeys({
          incoming: {
            OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
            OPENAI_BASE_URL: "https://new-url.com",
          },
          stored: null,
        });
        expect(result).toEqual({ OPENAI_BASE_URL: "https://new-url.com" });
      });

      it("drops a masked field the stored row does not have", () => {
        const result = mergeStoredCustomKeys({
          incoming: { OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER },
          stored: { OPENAI_BASE_URL: "https://old-url.com" },
        });
        expect(result).toEqual({});
      });
    });

    describe("when a field comes back masked", () => {
      it("restores the stored value and takes the edited one", () => {
        const result = mergeStoredCustomKeys({
          incoming: {
            OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
            OPENAI_BASE_URL: "https://new-url.com",
          },
          stored: {
            OPENAI_API_KEY: "sk-actual-secret",
            OPENAI_BASE_URL: "https://old-url.com",
          },
        });

        expect(result.OPENAI_API_KEY).toBe("sk-actual-secret");
        expect(result.OPENAI_BASE_URL).toBe("https://new-url.com");
      });

      /** @scenario Preserve original subscription key when saving with masked placeholder */
      it("restores every masked field at once", () => {
        const result = mergeStoredCustomKeys({
          incoming: {
            AWS_ACCESS_KEY_ID: MASKED_KEY_PLACEHOLDER,
            AWS_SECRET_ACCESS_KEY: MASKED_KEY_PLACEHOLDER,
            AWS_REGION_NAME: "eu-west-1",
          },
          stored: {
            AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
            AWS_SECRET_ACCESS_KEY: "secretkey123",
            AWS_REGION_NAME: "us-east-1",
          },
        });

        expect(result.AWS_ACCESS_KEY_ID).toBe("AKIAEXAMPLE");
        expect(result.AWS_SECRET_ACCESS_KEY).toBe("secretkey123");
        expect(result.AWS_REGION_NAME).toBe("eu-west-1");
      });

      it("carries along a field the row never held", () => {
        const result = mergeStoredCustomKeys({
          incoming: {
            OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
            NEW_KEY: "new-value",
          },
          stored: { OPENAI_API_KEY: "sk-stored" },
        });

        expect(result.OPENAI_API_KEY).toBe("sk-stored");
        expect(result.NEW_KEY).toBe("new-value");
      });
    });

    describe("when a field is named with a value", () => {
      it("takes the new value over the stored one", () => {
        const result = mergeStoredCustomKeys({
          incoming: { OPENAI_API_KEY: "sk-new-key" },
          stored: { OPENAI_API_KEY: "sk-old-key" },
        });

        expect(result.OPENAI_API_KEY).toBe("sk-new-key");
      });

      it("clears the stored secret when the value is empty", () => {
        const result = mergeStoredCustomKeys({
          incoming: { OPENAI_API_KEY: "" },
          stored: { OPENAI_API_KEY: "sk-old-key" },
        });

        expect(result.OPENAI_API_KEY).toBe("");
      });
    });

    // Secrets are masked on read, so no caller can resend one it did not type,
    // and leaving one out cannot mean "delete it". Everything else is visible,
    // so a write states it in full.
    describe("when a field is left out of the write", () => {
      /** @scenario A save that names one credential keeps the ones it leaves out */
      it("keeps a stored secret", () => {
        const result = mergeStoredCustomKeys({
          incoming: { AZURE_OPENAI_ENDPOINT: "https://acme2.openai.azure.com" },
          stored: {
            AZURE_OPENAI_API_KEY: "sk-stored",
            AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
          },
        });

        expect(result).toEqual({
          AZURE_OPENAI_API_KEY: "sk-stored",
          AZURE_OPENAI_ENDPOINT: "https://acme2.openai.azure.com",
        });
      });

      it("does not resurrect a secret the customer had already cleared", () => {
        const result = mergeStoredCustomKeys({
          incoming: { AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com" },
          stored: { AZURE_OPENAI_API_KEY: "" },
        });

        expect(result).toEqual({
          AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
        });
      });

      /** @scenario Switching Azure to its API gateway keeps the key and drops the direct endpoint */
      it("drops a stored field that is not a secret", () => {
        const result = mergeStoredCustomKeys({
          incoming: {
            AZURE_API_GATEWAY_BASE_URL: "https://apim.acme.com",
            AZURE_API_GATEWAY_VERSION: "2024-05-01-preview",
          },
          stored: {
            AZURE_OPENAI_API_KEY: "sk-stored",
            AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
          },
        });

        expect(result).toEqual({
          AZURE_API_GATEWAY_BASE_URL: "https://apim.acme.com",
          AZURE_API_GATEWAY_VERSION: "2024-05-01-preview",
          AZURE_OPENAI_API_KEY: "sk-stored",
        });
      });
    });
  });

  describe("maskApiKeys", () => {
    /** @scenario API key masking when editing existing provider */
    it("masks the API key and leaves the base URL visible", () => {
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

    it("masks the Vertex AI service account document", () => {
      const customKeys = {
        GOOGLE_APPLICATION_CREDENTIALS: "/path/to/credentials.json",
      };

      const result = maskApiKeys(customKeys);

      expect(result.GOOGLE_APPLICATION_CREDENTIALS).toBe(MASKED_KEY_PLACEHOLDER);
    });

    it("masks an OAuth token set whose fields are not named as keys", () => {
      const customKeys = {
        CODEX_ACCESS_TOKEN: "token-value",
        CODEX_REFRESH_TOKEN: "refresh-value",
        CODEX_ID_TOKEN: "id-value",
        CODEX_EMAIL: "person@example.com",
        CODEX_PLAN: "pro",
      };

      const result = maskApiKeys(customKeys);

      for (const field of Object.keys(customKeys)) {
        expect(result[field]).toBe(MASKED_KEY_PLACEHOLDER);
      }
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
