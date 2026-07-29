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

import {
  DEFAULT_AZURE_API_VERSION,
  prepareLitellmParams,
} from "../modelProviders.utils";

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

const baseAnthropicProvider = {
  provider: "anthropic" as const,
  enabled: true,
  customKeys: {
    ANTHROPIC_API_KEY: "sk-ant-test",
  },
  extraHeaders: null,
  deploymentMapping: null,
};

const baseOpenAIProvider = {
  provider: "openai" as const,
  enabled: true,
  customKeys: {
    OPENAI_API_KEY: "sk-openai-test",
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

  describe("when provider is anthropic", () => {
    /** @scenario prepareLitellmParams translates Anthropic model ID */
    it("translates dotted Anthropic model IDs to LiteLLM-compatible dashed form", async () => {
      // llmModels.json uses "anthropic/claude-opus-4.5" (dot notation).
      // LiteLLM expects "anthropic/claude-opus-4-5" (dash notation).
      // prepareLitellmParams must translate at the boundary.
      const params = await prepareLitellmParams({
        model: "anthropic/claude-opus-4.5",
        modelProvider: baseAnthropicProvider,
        projectId: "project-123",
      });

      expect(params.model).toBe("anthropic/claude-opus-4-5");
    });
  });

  describe("when provider is openai", () => {
    /** @scenario prepareLitellmParams preserves OpenAI model ID */
    it("preserves OpenAI model IDs unchanged", async () => {
      // Only Anthropic and custom providers need dot-to-dash translation.
      // OpenAI model IDs already use the format LiteLLM expects.
      const params = await prepareLitellmParams({
        model: "openai/gpt-5-mini",
        modelProvider: baseOpenAIProvider,
        projectId: "project-123",
      });

      expect(params.model).toBe("openai/gpt-5-mini");
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

    it("direct-mode: emits the customer's AZURE_OPENAI_ENDPOINT as api_base (the contract the Go gateway reads — #5760)", async () => {
      // The LangWatch UI stores the Azure resource endpoint under
      // AZURE_OPENAI_ENDPOINT (registry.ts azure `endpointKey`). A correctly-
      // configured direct-mode Azure provider MUST emit that endpoint as
      // `api_base`, which becomes the `x-litellm-api_base` header that the Go
      // /go/proxy credential builder resolves. If it did not, the endpoint
      // would never reach Bifrost and every Azure call would 502 "endpoint not
      // set" even though the customer set the endpoint correctly (#5760).
      //
      // No prior test asserted this direct-mode contract — the shared
      // `baseAzureProvider` fixture uses the stale key names AZURE_API_KEY /
      // AZURE_API_BASE, which `getModelOrDefaultEndpointKey` does NOT read, so
      // it never exercised the endpoint→api_base path. Use the real registry
      // keys here. Paired with the Go end-to-end guard
      // (services/nlpgo/tests/integration/gateway_proxy_azure_e2e_test.go),
      // this pins the full cross-language contract that #5760 hinged on.
      const provider = {
        provider: "azure" as const,
        enabled: true,
        customKeys: {
          AZURE_OPENAI_API_KEY: "sk-azure-real",
          AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
        },
        extraHeaders: null,
        deploymentMapping: null,
      };

      const params = await prepareLitellmParams({
        model: "azure/gpt-5-mini",
        modelProvider: provider,
        projectId: "project-123",
      });

      expect(params.api_base).toBe("https://acme.openai.azure.com");
      expect(params.api_key).toBe("sk-azure-real");
    });

    describe("when no api-version is configured (direct mode)", () => {
      it("pins a modern default so newer deployments don't 404 'Resource not found'", async () => {
        // Regression: without an explicit api-version the downstream gateway
        // (Bifrost) falls back to a stale 2024-10-21 default that 404s
        // gpt-5-class Azure deployments. We must always send a modern version.
        const params = await prepareLitellmParams({
          model: "azure/gpt-5.4",
          modelProvider: baseAzureProvider,
          projectId: "project-123",
        });

        expect(params.api_version).toBe(DEFAULT_AZURE_API_VERSION);
      });
    });

    describe("when AZURE_OPENAI_API_VERSION is configured (direct mode)", () => {
      it("uses the provider override instead of the default", async () => {
        const providerWithVersion = {
          ...baseAzureProvider,
          customKeys: {
            ...baseAzureProvider.customKeys,
            AZURE_OPENAI_API_VERSION: "2025-01-01-preview",
          },
        };

        const params = await prepareLitellmParams({
          model: "azure/gpt-5.4",
          modelProvider: providerWithVersion,
          projectId: "project-123",
        });

        expect(params.api_version).toBe("2025-01-01-preview");
      });
    });

    describe("when the provider defines a deploymentMapping", () => {
      it("maps the model id to its Azure deployment name", async () => {
        // The deployment name need not equal the model id; honour the
        // explicit mapping instead of assuming model id == deployment name.
        const providerWithMapping = {
          ...baseAzureProvider,
          deploymentMapping: { "gpt-5.4": "my-gpt5-deployment" },
        };

        const params = await prepareLitellmParams({
          model: "azure/gpt-5.4",
          modelProvider: providerWithMapping,
          projectId: "project-123",
        });

        expect(params.deployment).toBe("my-gpt5-deployment");
      });

      it("resolves a full-key mapping via the normalized model when given the mp-id wire format", async () => {
        // The incoming model can be the canonical `mp_.../...` wire format;
        // the full-key fallback must use the normalized `azure/...` form, not
        // the raw mp-id, or a "azure/gpt-5.4" mapping would miss.
        const providerWithMapping = {
          ...baseAzureProvider,
          deploymentMapping: { "azure/gpt-5.4": "my-gpt5-deployment" },
        };

        const params = await prepareLitellmParams({
          model: "mp_abc_123/gpt-5.4",
          modelProvider: providerWithMapping,
          projectId: "project-123",
        });

        expect(params.deployment).toBe("my-gpt5-deployment");
      });

      it("leaves deployment unset when the model is not in the mapping", async () => {
        const providerWithMapping = {
          ...baseAzureProvider,
          deploymentMapping: { "gpt-4o": "my-gpt4o-deployment" },
        };

        const params = await prepareLitellmParams({
          model: "azure/gpt-5.4",
          modelProvider: providerWithMapping,
          projectId: "project-123",
        });

        expect(params.deployment).toBeUndefined();
      });
    });
  });
});
