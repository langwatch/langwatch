import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({
  prisma: {},
}));

vi.mock("~/injection/dependencies.server", () => ({
  dependencies: {},
}));

vi.mock("~/server/modelProviders/modelProvider.service", () => ({
  ModelProviderService: {
    create: vi.fn(() => ({
      getProjectModelProviders: vi.fn().mockResolvedValue({}),
      getProjectModelProvidersForFrontend: vi.fn().mockResolvedValue({}),
    })),
  },
}));

import { prepareLitellmParams } from "../modelProviders.utils";

const baseAzureProvider = {
  provider: "azure" as const,
  enabled: true,
  customKeys: {
    AZURE_API_KEY: "sk-azure-test",
    AZURE_API_BASE: "https://my-resource.openai.azure.com",
  },
  extraHeaders: null,
  deploymentMapping: null,
};

describe("prepareLitellmParams", () => {
  describe("when the caller passes the new canonical mp-id wire format", () => {
    it("normalises params.model to provider-prefixed form using the resolved MP", async () => {
      // iter 109 wire format: callers can ship `{mpId}/{model}`, which
      // LiteLLM doesn't understand. prepareLitellmParams must translate
      // using modelProvider.provider so LiteLLM still routes correctly.
      const params = await prepareLitellmParams({
        model: "mp_abc_123/my-gpt4-deployment",
        modelProvider: baseAzureProvider,
        projectId: "project-123",
      });

      expect(params.model).toBe("azure/my-gpt4-deployment");
    });
  });

  describe("when the caller passes the legacy provider-prefixed format", () => {
    it("keeps params.model as provider/model", async () => {
      const params = await prepareLitellmParams({
        model: "azure/my-gpt4-deployment",
        modelProvider: baseAzureProvider,
        projectId: "project-123",
      });

      expect(params.model).toBe("azure/my-gpt4-deployment");
    });
  });

  describe("when provider is azure", () => {
    it("preserves azure deployment model ID in params.model", async () => {
      const params = await prepareLitellmParams({
        model: "azure/my-gpt4-deployment",
        modelProvider: baseAzureProvider,
        projectId: "project-123",
      });

      expect(params.model).toBe("azure/my-gpt4-deployment");
    });

    it("sets Azure gateway params when AZURE_API_GATEWAY_BASE_URL is configured", async () => {
      const providerWithGateway = {
        ...baseAzureProvider,
        customKeys: {
          ...baseAzureProvider.customKeys,
          AZURE_API_GATEWAY_BASE_URL: "https://gateway.example.com/azure",
          AZURE_API_GATEWAY_VERSION: "2024-09-01",
        },
      };

      const params = await prepareLitellmParams({
        model: "azure/my-gpt4-deployment",
        modelProvider: providerWithGateway,
        projectId: "project-123",
      });

      expect(params.api_base).toBe("https://gateway.example.com/azure");
      expect(params.use_azure_gateway).toBe("true");
      expect(params.api_version).toBe("2024-09-01");
    });
  });
});
