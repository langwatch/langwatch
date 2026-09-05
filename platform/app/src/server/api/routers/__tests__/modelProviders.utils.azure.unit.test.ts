/**
 * #7892: prepareLitellmParams is the direct/Studio dispatch path, and it
 * still honors AZURE_OPENAI_API_VERSION / AZURE_API_GATEWAY_VERSION (unlike
 * the AI Gateway/bifrost dispatch path, which drops a caller-supplied
 * override — see azure_api_version_dedup_test.go). These pin that the
 * direct-mode value and the API Management gateway-mode default are both
 * unaffected by the #7892 change, since regressing either would make the
 * two dispatch paths agree for the wrong reason.
 *
 * Covers @unit scenarios from specs/ai-gateway/azure-api-version-override.feature.
 *
 * `id` is left unset on every fixture so `prepareLitellmParams` never
 * reaches `resolveServingRow`'s Prisma lookup (it short-circuits on a
 * falsy `modelProvider.id`) — this is a pure-logic unit test, not an
 * integration test against a real database.
 */
import { describe, expect, it } from "vitest";
import type { MaybeStoredModelProvider } from "../../../modelProviders/registry";
import { prepareLitellmParams } from "../modelProviders.utils";

function azureProvider({
  customKeys,
}: {
  customKeys: Record<string, string>;
}): MaybeStoredModelProvider {
  return {
    name: "azure",
    provider: "azure",
    enabled: true,
    customKeys,
    models: null,
    embeddingsModels: null,
    customModels: null,
    customEmbeddingsModels: null,
    disabledByDefault: false,
    deploymentMapping: null,
    extraHeaders: [],
    scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
    scopeType: "PROJECT",
    scopeId: "proj-1",
  } as MaybeStoredModelProvider;
}

describe("Feature: Azure api-version is honored on the direct dispatch path", () => {
  describe("given an Azure provider configured for direct dispatch", () => {
    describe("when litellm dispatch parameters are prepared", () => {
      /** @scenario "Direct-mode Azure dispatch uses the customer's configured api-version" */
      it("uses the customer's configured AZURE_OPENAI_API_VERSION", async () => {
        const modelProvider = azureProvider({
          customKeys: {
            AZURE_OPENAI_API_KEY: "az-key",
            AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
            AZURE_OPENAI_API_VERSION: "2024-10-21",
          },
        });

        const params = await prepareLitellmParams({
          model: "azure/gpt-5",
          modelProvider,
          projectId: "proj-1",
        });

        expect(params.api_version).toBe("2024-10-21");
      });
    });
  });

  describe("given an Azure provider configured for API Management gateway mode with no explicit version", () => {
    describe("when litellm dispatch parameters are prepared", () => {
      /** @scenario "Azure API Management gateway mode defaults its own api-version" */
      it("falls back to the gateway-mode default api-version", async () => {
        const modelProvider = azureProvider({
          customKeys: {
            AZURE_OPENAI_API_KEY: "az-key",
            AZURE_API_GATEWAY_BASE_URL: "https://gateway.example.com",
          },
        });

        const params = await prepareLitellmParams({
          model: "azure/gpt-5",
          modelProvider,
          projectId: "proj-1",
        });

        expect(params.api_version).toBe("2024-05-01-preview");
      });

      /** @scenario "Azure API Management gateway mode defaults its own api-version" */
      it("marks the request as using the Azure gateway", async () => {
        const modelProvider = azureProvider({
          customKeys: {
            AZURE_OPENAI_API_KEY: "az-key",
            AZURE_API_GATEWAY_BASE_URL: "https://gateway.example.com",
          },
        });

        const params = await prepareLitellmParams({
          model: "azure/gpt-5",
          modelProvider,
          projectId: "proj-1",
        });

        expect(params.use_azure_gateway).toBe("true");
      });
    });
  });
});
