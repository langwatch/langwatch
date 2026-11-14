/**
 * #9440: a provider whose base URL points at an endpoint of the operator's own (an Azure OpenAI
 * resource under "OpenAI") serves only the models that row names, so the pickers must not offer
 * the registry catalogue for it.
 * Spec: specs/model-providers/custom-endpoint-model-picker.feature
 */
import { describe, expect, it } from "vitest";

import type { CustomModelEntry } from "../custom-model.ts";
import type { ModelProviderEditorValue } from "../model-provider-registry.ts";
import { modelSelectionFrom, providersWithoutRegistryModels } from "../model-selection.ts";

const AZURE_V1_URL = "https://acme.openai.azure.com/openai/v1";

const chatModel = (modelId: string): CustomModelEntry => ({
  modelId,
  displayName: modelId,
  mode: "chat",
});
const embeddingModel = (modelId: string): CustomModelEntry => ({
  modelId,
  displayName: modelId,
  mode: "embedding",
});

/** An OpenAI row; `baseUrl` is the unmasked public credential the browser receives. */
const openAiRow = (
  overrides: Partial<ModelProviderEditorValue> & { baseUrl?: string } = {},
): ModelProviderEditorValue => {
  const { baseUrl, ...rest } = overrides;
  return {
    provider: "openai",
    enabled: true,
    scopeType: "PROJECT",
    customKeys: {
      OPENAI_API_KEY: "HAS_KEY••••",
      ...(baseUrl === undefined ? {} : { OPENAI_BASE_URL: baseUrl }),
    },
    customModels: [chatModel("gpt-4.1"), chatModel("gpt-5-mini")],
    ...rest,
  };
};

const hidden = (
  rows: Parameters<typeof providersWithoutRegistryModels>[0],
  mode: "chat" | "embedding" = "chat",
) => providersWithoutRegistryModels(rows, mode).has("openai");

describe("providersWithoutRegistryModels, for a base-URL override", () => {
  describe("given an OpenAI row with a base URL and models of its own", () => {
    /** @scenario "An OpenAI endpoint of the operator's own is offered only the models they named" */
    it("hides the registry models", () => {
      expect(hidden([openAiRow({ baseUrl: AZURE_V1_URL })])).toBe(true);
    });
  });

  describe("given an OpenAI row with no base URL", () => {
    /** @scenario "An OpenAI row without a base URL keeps the registry models" */
    it("keeps the registry models", () => {
      expect(hidden([openAiRow()])).toBe(false);
    });

    it("treats a blank base URL as none", () => {
      expect(hidden([openAiRow({ baseUrl: "   " })])).toBe(false);
      expect(hidden([openAiRow({ customKeys: { OPENAI_BASE_URL: null } })])).toBe(false);
    });
  });

  describe("given a base URL but no models of its own", () => {
    /** @scenario "A base URL with no models named keeps the registry models" */
    it("keeps the registry models, as nothing says which of them the endpoint serves", () => {
      expect(hidden([openAiRow({ baseUrl: AZURE_V1_URL, customModels: [] })])).toBe(false);
      expect(hidden([openAiRow({ baseUrl: AZURE_V1_URL, customModels: null })])).toBe(false);
    });
  });

  describe("given a provider whose endpoint is its whole identity", () => {
    it("does not treat Azure's resource endpoint as an override", () => {
      const azure: ModelProviderEditorValue = {
        provider: "azure",
        enabled: true,
        scopeType: "PROJECT",
        customKeys: { AZURE_OPENAI_ENDPOINT: AZURE_V1_URL },
        customModels: [chatModel("gpt-4.1")],
      };
      expect(providersWithoutRegistryModels([azure], "chat").has("azure")).toBe(false);
    });
  });

  describe("given Anthropic with a base URL and models of its own", () => {
    it("applies the same rule, read from the registry's endpoint key", () => {
      const anthropic: ModelProviderEditorValue = {
        provider: "anthropic",
        enabled: true,
        scopeType: "PROJECT",
        customKeys: { ANTHROPIC_BASE_URL: "https://proxy.example.com" },
        customModels: [chatModel("claude-sonnet-4")],
      };
      expect(providersWithoutRegistryModels([anthropic], "chat").has("anthropic")).toBe(true);
    });
  });

  describe("given an override row beside a plain row at another scope", () => {
    /** @scenario "The row that runs decides, not the union of rows" */
    it("hides them when the narrower override row is the one that runs", () => {
      expect(
        hidden([
          openAiRow({ baseUrl: AZURE_V1_URL, scopeType: "PROJECT" }),
          openAiRow({ scopeType: "ORGANIZATION" }),
        ]),
      ).toBe(true);
    });

    it("keeps them when the narrower plain row is the one that runs", () => {
      expect(
        hidden([
          openAiRow({ scopeType: "PROJECT" }),
          openAiRow({ baseUrl: AZURE_V1_URL, scopeType: "ORGANIZATION" }),
        ]),
      ).toBe(false);
    });
  });

  describe("given a disabled override row", () => {
    it("does not count", () => {
      expect(hidden([openAiRow({ baseUrl: AZURE_V1_URL, enabled: false })])).toBe(false);
    });
  });

  describe("when the picker is in embedding mode", () => {
    /** @scenario "Embedding models follow the same rule with the embedding models the row names" */
    it("hides the registry embedding models only when the row names embedding models", () => {
      const named = openAiRow({
        baseUrl: AZURE_V1_URL,
        customEmbeddingsModels: [embeddingModel("text-embedding-3-small")],
      });
      expect(hidden([named], "embedding")).toBe(true);
      expect(hidden([openAiRow({ baseUrl: AZURE_V1_URL })], "embedding")).toBe(false);
    });
  });
});

describe("modelSelectionFrom, for the report in #9440", () => {
  const registry = ["openai/gpt-4.1", "openai/gpt-5-mini", "openai/gpt-6-luna", "openai/o3"];
  const select = (providers: ModelProviderEditorValue[]) =>
    modelSelectionFrom({ providers, options: registry, mode: "chat", featureKey: undefined })
      .selectOptions.map((option) => option.value)
      .toSorted();

  describe("given an OpenAI provider on an Azure URL that lists gpt-4.1 and gpt-5-mini", () => {
    /** @scenario "An OpenAI endpoint of the operator's own is offered only the models they named" */
    it("offers those two and not gpt-6-luna, which the endpoint has no deployment for", () => {
      expect(select([openAiRow({ baseUrl: AZURE_V1_URL })])).toEqual([
        "openai/gpt-4.1",
        "openai/gpt-5-mini",
      ]);
    });
  });

  describe("given the same provider without the base URL", () => {
    it("still offers the whole registry list", () => {
      expect(select([openAiRow()])).toEqual([
        "openai/gpt-4.1",
        "openai/gpt-5-mini",
        "openai/gpt-6-luna",
        "openai/o3",
      ]);
    });
  });

  describe("given another provider beside the Azure-backed OpenAI one", () => {
    /** @scenario "Other providers keep their registry models" */
    it("leaves the other provider's registry models alone", () => {
      const anthropic: ModelProviderEditorValue = {
        provider: "anthropic",
        enabled: true,
        scopeType: "PROJECT",
        customKeys: { ANTHROPIC_API_KEY: "HAS_KEY••••" },
      };
      const options = modelSelectionFrom({
        providers: [openAiRow({ baseUrl: AZURE_V1_URL }), anthropic],
        options: [...registry, "anthropic/claude-sonnet-4"],
        mode: "chat",
        featureKey: undefined,
      }).selectOptions.map((option) => option.value);

      expect(options).toContain("anthropic/claude-sonnet-4");
      expect(options).not.toContain("openai/gpt-6-luna");
    });
  });
});
