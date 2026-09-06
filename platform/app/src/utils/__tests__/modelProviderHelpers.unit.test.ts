import { describe, expect, it } from "vitest";
import { MASKED_KEY_PLACEHOLDER } from "../constants";

import {
  buildCustomKeyState,
  getDisplayKeysForProvider,
  getProviderFromModel,
  getSchemaShape,
  hasUserEnteredNewApiKey,
  headerSignature,
  shouldAutoEnableAsDefault,
} from "../modelProviderHelpers";

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

    it("returns shape from a wrapped schema via innerType()", () => {
      const schema = {
        innerType: () => ({ shape: { GROQ_API_KEY: {} } }),
      };
      expect(getSchemaShape(schema)).toEqual({ GROQ_API_KEY: {} });
    });

    it("returns empty object for a wrapper whose inner schema has no shape", () => {
      const schema = { innerType: () => ({}) };
      expect(getSchemaShape(schema)).toEqual({});
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

  describe("shouldAutoEnableAsDefault()", () => {
    describe("when enabledProvidersCount is 0 or 1", () => {
      it("returns true for the first-provider case (0)", () => {
        expect(shouldAutoEnableAsDefault({ enabledProvidersCount: 0 })).toBe(
          true,
        );
      });

      it("returns true when there is exactly one provider", () => {
        expect(shouldAutoEnableAsDefault({ enabledProvidersCount: 1 })).toBe(
          true,
        );
      });
    });

    describe("when enabledProvidersCount is greater than 1", () => {
      it("returns false; the user must opt in explicitly", () => {
        expect(shouldAutoEnableAsDefault({ enabledProvidersCount: 2 })).toBe(
          false,
        );
      });
    });
  });

  describe("given headerSignature() compares a form header list with the stored one", () => {
    describe("when only the form list carries the display-only concealed flag", () => {
      it("reads the two lists as equal", () => {
        const stored = [{ key: "api-key", value: MASKED_KEY_PLACEHOLDER }];
        const asShownInTheForm = [
          { key: "api-key", value: MASKED_KEY_PLACEHOLDER, concealed: true },
        ];

        expect(headerSignature(asShownInTheForm)).toBe(headerSignature(stored));
      });
    });

    describe("when a header key was renamed", () => {
      it("reads the lists as different", () => {
        expect(headerSignature([{ key: "api-key", value: "v" }])).not.toBe(
          headerSignature([{ key: "x-api-key", value: "v" }]),
        );
      });
    });

    describe("when a header value was edited", () => {
      it("reads the lists as different", () => {
        expect(headerSignature([{ key: "api-key", value: "v" }])).not.toBe(
          headerSignature([{ key: "api-key", value: "w" }]),
        );
      });
    });

    describe("when the headers were dragged into a new order", () => {
      it("reads the lists as different, because reordering is a real edit", () => {
        const a = [
          { key: "one", value: "1" },
          { key: "two", value: "2" },
        ];
        const b = [
          { key: "two", value: "2" },
          { key: "one", value: "1" },
        ];

        expect(headerSignature(a)).not.toBe(headerSignature(b));
      });
    });

    describe("when there are no headers at all", () => {
      it("treats null, undefined and the empty list the same", () => {
        expect(headerSignature(null)).toBe(headerSignature([]));
        expect(headerSignature(undefined)).toBe(headerSignature([]));
      });
    });
  });
});
