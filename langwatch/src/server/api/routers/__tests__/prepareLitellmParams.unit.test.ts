import { describe, expect, it, vi, beforeEach } from "vitest";

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
};

describe("prepareLitellmParams", () => {
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
