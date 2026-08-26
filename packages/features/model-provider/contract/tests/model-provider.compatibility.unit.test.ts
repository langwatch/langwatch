import { describe, expect, it } from "vitest";
import {
  legacyModelProviderListResponseSchema,
  legacyModelProviderMapResponseSchema,
  toLegacyModelProvider,
  toLegacyModelProviderListResponse,
  toLegacyModelProviderMapResponse,
  type ModelProviderSummary,
} from "../src";

const createdAt = new Date("2026-01-02T03:04:05.000Z");
const updatedAt = new Date("2026-02-03T04:05:06.000Z");

const provider: ModelProviderSummary = {
  id: "provider_1",
  organizationId: "organization_1",
  provider: "openai",
  name: "OpenAI Europe",
  enabled: true,
  defaultModel: "gpt-5",
  routingHandle: "eu",
  scopes: [
    { scopeType: "ORGANIZATION", scopeId: "organization_1" },
    { scopeType: "PROJECT", scopeId: "project_1" },
  ],
  customKeys: { OPENAI_API_KEY: "********" },
  customModels: [
    {
      id: "custom-chat",
      label: "Custom Chat",
      type: "chat",
      maxTokens: 16_384,
      supportedParameters: ["temperature"],
      multimodalInputs: ["image"],
    },
  ],
  customEmbeddingsModels: [
    {
      id: "custom-embedding",
      label: "Custom Embedding",
      type: "embedding",
    },
  ],
  extraHeaders: [{ key: "x-region", value: "eu" }],
  rateLimitRpm: 10,
  rateLimitTpm: 20,
  rateLimitRpd: 30,
  fallbackPriorityGlobal: 4,
  rotationPolicy: "MANUAL",
  providerConfig: { region: "eu-west-1" },
  deploymentMapping: { "gpt-5": "deployment-1" },
  healthStatus: "DEGRADED",
  circuitOpenedAt: createdAt,
  lastHealthCheckAt: updatedAt,
  disabledAt: null,
  createdAt,
  updatedAt,
  models: ["gpt-5"],
  embeddingsModels: ["text-embedding-3-large"],
  disabledByDefault: false,
  isSystem: false,
  embeddingsUnsupported: false,
};

describe("Model Provider compatibility", () => {
  it("retains every canonical provider field in the legacy transport value", () => {
    const legacy = toLegacyModelProvider(provider);

    expect(legacy).toEqual({
      id: "provider_1",
      organizationId: "organization_1",
      provider: "openai",
      name: "OpenAI Europe",
      enabled: true,
      defaultModel: "gpt-5",
      routingHandle: "eu",
      scopes: provider.scopes,
      scopeType: "PROJECT",
      scopeId: "project_1",
      customKeys: { OPENAI_API_KEY: "********" },
      customModels: [
        {
          modelId: "custom-chat",
          displayName: "Custom Chat",
          mode: "chat",
          maxTokens: 16_384,
          supportedParameters: ["temperature"],
          multimodalInputs: ["image"],
        },
      ],
      customEmbeddingsModels: [
        {
          modelId: "custom-embedding",
          displayName: "Custom Embedding",
          mode: "embedding",
        },
      ],
      extraHeaders: [{ key: "x-region", value: "eu" }],
      rateLimitRpm: 10,
      rateLimitTpm: 20,
      rateLimitRpd: 30,
      fallbackPriorityGlobal: 4,
      rotationPolicy: "MANUAL",
      providerConfig: { region: "eu-west-1" },
      deploymentMapping: { "gpt-5": "deployment-1" },
      healthStatus: "DEGRADED",
      circuitOpenedAt: createdAt,
      lastHealthCheckAt: updatedAt,
      disabledAt: null,
      models: ["gpt-5"],
      embeddingsModels: ["text-embedding-3-large"],
      disabledByDefault: false,
      isSystem: false,
      embeddingsUnsupported: false,
      createdAt,
      updatedAt,
    });
  });

  it("validates both existing response container shapes", () => {
    const legacy = toLegacyModelProvider(provider);
    const modelMetadata = {};

    expect(
      legacyModelProviderMapResponseSchema.parse({
        providers: { openai: legacy },
        modelMetadata,
      }),
    ).toEqual({ providers: { openai: legacy }, modelMetadata });
    expect(
      legacyModelProviderListResponseSchema.parse({
        providers: [legacy],
        modelMetadata,
      }),
    ).toEqual({ providers: [legacy], modelMetadata });
  });

  it("builds both existing response containers inside the feature", () => {
    const mapResponse = toLegacyModelProviderMapResponse({ openai: provider });
    const listResponse = toLegacyModelProviderListResponse([provider]);

    expect(mapResponse.providers.openai?.name).toBe("OpenAI Europe");
    expect(listResponse.providers[0]?.routingHandle).toBe("eu");
    expect(mapResponse.modelMetadata["openai/gpt-5"]).toBeDefined();
    expect(listResponse.modelMetadata["openai/gpt-5"]).toBeDefined();
  });
});
