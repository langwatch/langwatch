import { describe, expect, it } from "vitest";
import type { ModelProviderExecution } from "@langwatch/model-provider-contract";
import { toLegacyExecutionProvider } from "../src/adapters/legacy-model-provider.adapter";

describe("toLegacyExecutionProvider", () => {
  it("preserves execution credentials, scope, deployment, and custom-model metadata", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const updatedAt = new Date("2026-01-02T00:00:00.000Z");
    const provider = {
      id: "mp_azure",
      organizationId: "org_1",
      provider: "azure",
      name: "Project Azure",
      enabled: true,
      routingHandle: "eu",
      scopes: [
        { scopeType: "ORGANIZATION", scopeId: "org_1" },
        { scopeType: "PROJECT", scopeId: "project_1" },
      ],
      customKeys: {
        AZURE_API_KEY: "secret-key",
        AZURE_API_BASE: "https://example.openai.azure.com",
      },
      customModels: [
        {
          id: "deployment-gpt",
          label: "Deployment GPT",
          type: "chat",
          maxTokens: 4096,
          supportedParameters: ["temperature", "max_tokens"],
          multimodalInputs: ["image", "audio"],
        },
      ],
      customEmbeddingsModels: [
        {
          id: "deployment-embed",
          label: "Deployment Embed",
          type: "embedding",
          supportedParameters: ["max_tokens"],
        },
      ],
      extraHeaders: [{ key: "x-api-key", value: "header-secret" }],
      rateLimitRpm: 60,
      rateLimitTpm: 120_000,
      rateLimitRpd: 1_000,
      fallbackPriorityGlobal: 3,
      providerConfig: { apiVersion: "2025-04-01-preview" },
      deploymentMapping: { "deployment-gpt": "customer-deployment" },
      createdAt,
      updatedAt,
      models: ["gpt-4.1"],
      embeddingsModels: ["text-embedding-3-large"],
      disabledByDefault: false,
      isSystem: false,
      embeddingsUnsupported: false,
    } satisfies ModelProviderExecution;

    expect(toLegacyExecutionProvider(provider)).toEqual({
      id: "mp_azure",
      organizationId: "org_1",
      provider: "azure",
      name: "Project Azure",
      enabled: true,
      routingHandle: "eu",
      scopes: [
        { scopeType: "ORGANIZATION", scopeId: "org_1" },
        { scopeType: "PROJECT", scopeId: "project_1" },
      ],
      scopeType: "PROJECT",
      scopeId: "project_1",
      customKeys: {
        AZURE_API_KEY: "secret-key",
        AZURE_API_BASE: "https://example.openai.azure.com",
      },
      customModels: [
        {
          modelId: "deployment-gpt",
          displayName: "Deployment GPT",
          mode: "chat",
          maxTokens: 4096,
          supportedParameters: ["temperature", "max_tokens"],
          multimodalInputs: ["image", "audio"],
        },
      ],
      customEmbeddingsModels: [
        {
          modelId: "deployment-embed",
          displayName: "Deployment Embed",
          mode: "embedding",
          supportedParameters: ["max_tokens"],
        },
      ],
      extraHeaders: [{ key: "x-api-key", value: "header-secret" }],
      rateLimitRpm: 60,
      rateLimitTpm: 120_000,
      rateLimitRpd: 1_000,
      fallbackPriorityGlobal: 3,
      providerConfig: { apiVersion: "2025-04-01-preview" },
      deploymentMapping: { "deployment-gpt": "customer-deployment" },
      createdAt,
      updatedAt,
      models: ["gpt-4.1"],
      embeddingsModels: ["text-embedding-3-large"],
      disabledByDefault: false,
      isSystem: false,
      embeddingsUnsupported: false,
    });
  });
});
