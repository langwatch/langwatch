import { describe, expect, it, vi } from "vitest";
import { MASKED_KEY_PLACEHOLDER } from "../constants";

// Mock the registry module so we can control getProviderModelOptions
vi.mock("../../server/modelProviders/registry", () => ({
  getProviderModelOptions: vi.fn().mockReturnValue([]),
}));

import { getProviderModelOptions } from "../../server/modelProviders/registry";
import {
  buildCustomKeyState,
  getDisplayKeysForProvider,
  getProviderFromModel,
  getSchemaShape,
  hasUserEnteredNewApiKey,
  resolveModelForProvider,
  shouldAutoEnableAsDefault,
} from "../modelProviderHelpers";

const mockGetProviderModelOptions = vi.mocked(getProviderModelOptions);

describe("modelProviderHelpers", () => {
  describe("getProviderFromModel()", () => {
    it("extracts provider key from model string", () => {
      expect(getProviderFromModel("openai/gpt-4")).toBe("openai");
      expect(getProviderFromModel("anthropic/claude-sonnet-4")).toBe(
        "anthropic",
      );
      expect(getProviderFromModel("azure/gpt-4-turbo")).toBe("azure");
    });

    it("returns input unchanged when model has no slash", () => {
      expect(getProviderFromModel("gpt-4")).toBe("gpt-4");
    });

    it("handles empty string", () => {
      expect(getProviderFromModel("")).toBe("");
    });

    it("handles model with multiple slashes", () => {
      expect(getProviderFromModel("custom/namespace/model")).toBe("custom");
    });
  });



  describe("getSchemaShape()", () => {
    it("returns shape from schema with shape property", () => {
      const schema = {
        shape: { OPENAI_API_KEY: {}, OPENAI_BASE_URL: {} },
      };
      expect(getSchemaShape(schema)).toEqual({
        OPENAI_API_KEY: {},
        OPENAI_BASE_URL: {},
      });
    });

    it("returns shape from nested _def.schema.shape", () => {
      const schema = {
        _def: {
          schema: {
            shape: { ANTHROPIC_API_KEY: {} },
          },
        },
      };
      expect(getSchemaShape(schema)).toEqual({ ANTHROPIC_API_KEY: {} });
    });

    it("returns empty object for schema without shape", () => {
      const schema = {};
      expect(getSchemaShape(schema)).toEqual({});
    });

    it("returns empty object for null/undefined", () => {
      expect(getSchemaShape(null)).toEqual({});
      expect(getSchemaShape(undefined)).toEqual({});
    });
  });

  describe("getDisplayKeysForProvider()", () => {
    const schemaShape = {
      AZURE_OPENAI_API_KEY: {},
      AZURE_OPENAI_ENDPOINT: {},
      AZURE_OPENAI_API_VERSION: {},
      AZURE_API_GATEWAY_BASE_URL: {},
      AZURE_API_GATEWAY_VERSION: {},
      OPENAI_API_KEY: {},
      OPENAI_BASE_URL: {},
    };

    it("returns gateway keys for Azure with API Gateway enabled", () => {
      const result = getDisplayKeysForProvider("azure", true, schemaShape);
      expect(result).toEqual({
        AZURE_API_GATEWAY_BASE_URL: {},
        AZURE_API_GATEWAY_VERSION: {},
      });
    });

    it("returns standard keys (incl. api-version override) for Azure with API Gateway disabled", () => {
      const result = getDisplayKeysForProvider("azure", false, schemaShape);
      expect(result).toEqual({
        AZURE_OPENAI_API_KEY: {},
        AZURE_OPENAI_ENDPOINT: {},
        AZURE_OPENAI_API_VERSION: {},
      });
    });

    it("returns full schema shape for non-Azure providers", () => {
      const openaiSchema = { OPENAI_API_KEY: {}, OPENAI_BASE_URL: {} };
      const result = getDisplayKeysForProvider("openai", false, openaiSchema);
      expect(result).toEqual(openaiSchema);
    });

    it("ignores useApiGateway for non-Azure providers", () => {
      const openaiSchema = { OPENAI_API_KEY: {}, OPENAI_BASE_URL: {} };
      const result = getDisplayKeysForProvider("openai", true, openaiSchema);
      expect(result).toEqual(openaiSchema);
    });
  });

  describe("buildCustomKeyState()", () => {
    it("returns stored keys when available", () => {
      const displayKeyMap = { OPENAI_API_KEY: {}, OPENAI_BASE_URL: {} };
      const storedKeys = {
        OPENAI_API_KEY: "sk-stored123",
        OPENAI_BASE_URL: "https://api.openai.com/v1",
      };

      const result = buildCustomKeyState(displayKeyMap, storedKeys);

      expect(result).toEqual({
        OPENAI_API_KEY: "sk-stored123",
        OPENAI_BASE_URL: "https://api.openai.com/v1",
      });
    });

    it("preserves previous keys when provided", () => {
      const displayKeyMap = { OPENAI_API_KEY: {}, OPENAI_BASE_URL: {} };
      const storedKeys = { OPENAI_API_KEY: "sk-old" };
      const previousKeys = { OPENAI_API_KEY: "sk-user-typing" };

      const result = buildCustomKeyState(
        displayKeyMap,
        storedKeys,
        previousKeys,
      );

      expect(result.OPENAI_API_KEY).toBe("sk-user-typing");
    });

    it("returns MANAGED keys unchanged", () => {
      const displayKeyMap = { MANAGED: {} };
      const storedKeys = {};
      const previousKeys = { MANAGED: "true" };

      const result = buildCustomKeyState(
        displayKeyMap,
        storedKeys,
        previousKeys,
      );

      expect(result).toEqual({ MANAGED: "true" });
    });

    it("shows MASKED_KEY_PLACEHOLDER for env var providers", () => {
      const displayKeyMap = { OPENAI_API_KEY: {}, OPENAI_BASE_URL: {} };
      const storedKeys = {};
      const options = { providerEnabledWithEnvVars: true };

      const result = buildCustomKeyState(
        displayKeyMap,
        storedKeys,
        undefined,
        options,
      );

      expect(result.OPENAI_API_KEY).toBe(MASKED_KEY_PLACEHOLDER);
      expect(result.OPENAI_BASE_URL).toBe(""); // URL fields are not masked
    });

    it("returns empty strings for new provider", () => {
      const displayKeyMap = { OPENAI_API_KEY: {}, OPENAI_BASE_URL: {} };
      const storedKeys = {};

      const result = buildCustomKeyState(displayKeyMap, storedKeys);

      expect(result).toEqual({ OPENAI_API_KEY: "", OPENAI_BASE_URL: "" });
    });

    it("does not show masked placeholder when stored keys exist", () => {
      const displayKeyMap = { OPENAI_API_KEY: {} };
      const storedKeys = { OPENAI_API_KEY: "sk-actual-key" };
      const options = { providerEnabledWithEnvVars: true };

      const result = buildCustomKeyState(
        displayKeyMap,
        storedKeys,
        undefined,
        options,
      );

      expect(result.OPENAI_API_KEY).toBe("sk-actual-key");
    });

    it("handles empty display key map", () => {
      const result = buildCustomKeyState({}, {});
      expect(result).toEqual({});
    });
  });

  describe("hasUserEnteredNewApiKey()", () => {
    it("returns true when user entered a new API key", () => {
      expect(
        hasUserEnteredNewApiKey({
          OPENAI_API_KEY: "sk-new-key",
        }),
      ).toBe(true);
    });

    it("returns false when API key is masked placeholder", () => {
      expect(
        hasUserEnteredNewApiKey({
          OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
        }),
      ).toBe(false);
    });

    it("returns false when API key is empty", () => {
      expect(
        hasUserEnteredNewApiKey({
          OPENAI_API_KEY: "",
        }),
      ).toBe(false);
    });

    it("returns false when API key is only whitespace", () => {
      expect(
        hasUserEnteredNewApiKey({
          OPENAI_API_KEY: "   ",
        }),
      ).toBe(false);
    });

    it("returns false when only non-key fields have values", () => {
      expect(
        hasUserEnteredNewApiKey({
          OPENAI_BASE_URL: "https://api.example.com",
        }),
      ).toBe(false);
    });

    it("returns true when any API key field has a new value", () => {
      expect(
        hasUserEnteredNewApiKey({
          OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
          ANTHROPIC_API_KEY: "sk-ant-new-key",
        }),
      ).toBe(true);
    });

    it("returns true for AWS credentials", () => {
      expect(
        hasUserEnteredNewApiKey({
          AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
        }),
      ).toBe(true);
    });

    it("returns false for empty object", () => {
      expect(hasUserEnteredNewApiKey({})).toBe(false);
    });
  });

  describe("resolveModelForProvider()", () => {
    describe("when current model already matches the provider", () => {
      it("returns it unchanged", () => {
        const result = resolveModelForProvider({
          current: "azure/gpt-4o",
          providerKey: "azure",
          storedModels: null,
          mode: "chat",
        });

        expect(result).toBe("azure/gpt-4o");
      });
    });

    describe("when current model does not match provider", () => {
      it("picks from stored models first", () => {
        const result = resolveModelForProvider({
          current: "openai/gpt-5.2",
          providerKey: "azure",
          storedModels: ["gpt-4o", "gpt-4-turbo"],
          mode: "chat",
        });

        expect(result).toBe("azure/gpt-4o");
      });

      it("falls back to registry models when no stored models exist", () => {
        mockGetProviderModelOptions.mockReturnValueOnce([
          { value: "claude-sonnet-4", label: "claude-sonnet-4" },
          { value: "claude-haiku-3.5", label: "claude-haiku-3.5" },
        ]);

        const result = resolveModelForProvider({
          current: "openai/gpt-5.2",
          providerKey: "anthropic",
          storedModels: null,
          mode: "chat",
        });

        expect(result).toBe("anthropic/claude-sonnet-4");
        expect(mockGetProviderModelOptions).toHaveBeenCalledWith(
          "anthropic",
          "chat",
        );
      });

      it("returns current model when no provider models exist anywhere", () => {
        mockGetProviderModelOptions.mockReturnValueOnce([]);

        const result = resolveModelForProvider({
          current: "openai/gpt-5.2",
          providerKey: "custom-provider",
          storedModels: null,
          mode: "chat",
        });

        expect(result).toBe("openai/gpt-5.2");
      });
    });

    describe("when mode is embedding", () => {
      it("resolves embedding models from registry", () => {
        mockGetProviderModelOptions.mockReturnValueOnce([
          {
            value: "text-embedding-3-small",
            label: "text-embedding-3-small",
          },
        ]);

        const result = resolveModelForProvider({
          current: "openai/text-embedding-3-small",
          providerKey: "azure",
          storedModels: null,
          mode: "embedding",
        });

        expect(mockGetProviderModelOptions).toHaveBeenCalledWith(
          "azure",
          "embedding",
        );
        expect(result).toBe("azure/text-embedding-3-small");
      });
    });
  });

  describe("shouldAutoEnableAsDefault()", () => {
    describe("when enabledProvidersCount is 0 or 1", () => {
      it("returns true for the first-provider case (0)", () => {
        expect(
          shouldAutoEnableAsDefault({ enabledProvidersCount: 0 }),
        ).toBe(true);
      });

      it("returns true when there is exactly one provider", () => {
        expect(
          shouldAutoEnableAsDefault({ enabledProvidersCount: 1 }),
        ).toBe(true);
      });
    });

    describe("when enabledProvidersCount is greater than 1", () => {
      it("returns false; the user must opt in explicitly", () => {
        expect(
          shouldAutoEnableAsDefault({ enabledProvidersCount: 2 }),
        ).toBe(false);
      });
    });
  });
});
