/**
 * @vitest-environment node
 *
 * Unit tests for setupModelEnv in evaluation-execution.factories.
 *
 * Mocks getProjectModelProviders and prepareLitellmParams so we can
 * test validation logic in isolation without DB or external calls.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MaybeStoredModelProvider } from "~/server/modelProviders/registry";

vi.mock("~/server/api/routers/modelProviders.utils", () => ({
  getProjectModelProviders: vi.fn(),
  prepareLitellmParams: vi.fn(),
  prepareEnvKeys: vi.fn(),
}));

vi.mock("~/server/modelProviders/resolveMaxTokensCeiling", () => ({
  resolveMaxTokensCeiling: vi.fn().mockReturnValue(null),
}));

import {
  getProjectModelProviders,
  prepareEnvKeys,
  prepareLitellmParams,
} from "~/server/api/routers/modelProviders.utils";
import { EvaluatorConfigError } from "../errors";
import { setupModelEnv } from "../evaluation-execution.factories";

function buildProvider(
  overrides: Partial<MaybeStoredModelProvider> = {},
): MaybeStoredModelProvider {
  return {
    provider: "gemini",
    enabled: true,
    customKeys: null,
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    embeddingsModels: ["gemini-embedding-001"],
    customModels: null,
    customEmbeddingsModels: null,
    deploymentMapping: null,
    extraHeaders: null,
    ...overrides,
  };
}

function buildAzureProvider(
  overrides: Partial<MaybeStoredModelProvider> = {},
): MaybeStoredModelProvider {
  return buildProvider({
    provider: "azure",
    models: ["gpt-4o"],
    embeddingsModels: ["text-embedding-3-small"],
    ...overrides,
  });
}

describe("setupModelEnv", () => {
  beforeEach(() => {
    vi.mocked(prepareLitellmParams).mockResolvedValue({
      model: "gemini/gemini-1.5-pro",
      api_key: "test-key",
    });
    vi.mocked(prepareEnvKeys).mockReturnValue({});
  });

  describe("when model is in the registry list", () => {
    it("resolves without error", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider(),
      });

      await expect(
        setupModelEnv("gemini/gemini-2.5-pro", false, "proj-1"),
      ).resolves.toBeDefined();
    });
  });

  describe("when model is NOT in registry but IS a custom model", () => {
    it("resolves without error for chat custom models", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider({
          customModels: [
            {
              modelId: "gemini-1.5-pro",
              displayName: "gemini-1.5-pro",
              mode: "chat",
            },
          ],
        }),
      });

      await expect(
        setupModelEnv("gemini/gemini-1.5-pro", false, "proj-1"),
      ).resolves.toBeDefined();
    });

    it("resolves without error for embedding custom models", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider({
          customEmbeddingsModels: [
            {
              modelId: "custom-embed",
              displayName: "custom-embed",
              mode: "embedding",
            },
          ],
        }),
      });

      await expect(
        setupModelEnv("gemini/custom-embed", true, "proj-1"),
      ).resolves.toBeDefined();
    });
  });

  describe("when model is NOT in registry AND NOT a custom model", () => {
    it("throws EvaluatorConfigError", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider(),
      });

      await expect(
        setupModelEnv("gemini/nonexistent-model", false, "proj-1"),
      ).rejects.toThrow(EvaluatorConfigError);
    });
  });

  describe("when provider has no registry models", () => {
    it("allows any model (no whitelist to check against)", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider({ models: null }),
      });

      await expect(
        setupModelEnv("gemini/any-model", false, "proj-1"),
      ).resolves.toBeDefined();
    });
  });

  describe("when provider is not configured", () => {
    it("keeps the existing chat-model error", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({});

      await expect(
        setupModelEnv("gemini/gemini-2.5-pro", false, "proj-1"),
      ).rejects.toThrow("Provider gemini is not configured");
    });

    it("names the embeddings setting and available provider", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        azure: buildAzureProvider(),
      });

      await expect(
        setupModelEnv("openai/text-embedding-ada-002", true, "proj-1"),
      ).rejects.toThrow(
        'settings.embeddings_model is "openai/text-embedding-ada-002", but provider "openai" is not configured. Set the project\'s EMBEDDINGS default or select an enabled embeddings model. Available embeddings providers: azure.',
      );
    });
  });

  describe("when provider is disabled", () => {
    it("keeps the existing chat-model error", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider({ enabled: false }),
      });

      await expect(
        setupModelEnv("gemini/gemini-2.5-pro", false, "proj-1"),
      ).rejects.toThrow("Provider gemini is not enabled");
    });

    it("explains when no embeddings provider is available", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        openai: buildProvider({ provider: "openai", enabled: false }),
      });

      await expect(
        setupModelEnv("openai/text-embedding-ada-002", true, "proj-1"),
      ).rejects.toThrow(
        'settings.embeddings_model is "openai/text-embedding-ada-002", but provider "openai" is not enabled. Set the project\'s EMBEDDINGS default or select an enabled embeddings model. No enabled embeddings providers are available.',
      );
    });
  });

  describe("when Azure defines deployment mappings", () => {
    it("maps a completion deployment to the env name Langevals consumes", async () => {
      const provider = buildAzureProvider();
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        azure: provider,
      });
      vi.mocked(prepareLitellmParams).mockResolvedValue({
        model: "azure/gpt-4o",
        api_key: "azure-key",
        deployment: "prod-judge",
      });

      const result = await setupModelEnv("azure/gpt-4o", false, "proj-1");

      expect(result).toMatchObject({
        X_LITELLM_model: "azure/gpt-4o",
        X_LITELLM_api_key: "azure-key",
        AZURE_DEPLOYMENT_NAME: "prod-judge",
      });
      expect(result).not.toHaveProperty("X_LITELLM_deployment");
    });

    it("maps an embeddings deployment and preserves Azure credentials", async () => {
      const provider = buildAzureProvider();
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        azure: provider,
      });
      vi.mocked(prepareLitellmParams).mockResolvedValue({
        model: "azure/text-embedding-3-small",
        deployment: "prod-embeddings",
      });
      vi.mocked(prepareEnvKeys).mockReturnValue({
        AZURE_API_KEY: "azure-key",
        AZURE_API_BASE: "https://azure.example.com",
      });

      const result = await setupModelEnv(
        "azure/text-embedding-3-small",
        true,
        "proj-1",
      );

      expect(result).toMatchObject({
        X_LITELLM_EMBEDDINGS_model: "azure/text-embedding-3-small",
        AZURE_EMBEDDINGS_DEPLOYMENT_NAME: "prod-embeddings",
        AZURE_API_KEY: "azure-key",
        AZURE_API_BASE: "https://azure.example.com",
      });
      expect(result).not.toHaveProperty("X_LITELLM_EMBEDDINGS_deployment");
    });

    it("does not turn non-Azure deployment metadata into Azure routing", async () => {
      const provider = buildProvider();
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: provider,
      });
      vi.mocked(prepareLitellmParams).mockResolvedValue({
        model: "gemini/gemini-embedding-001",
        deployment: "unexpected-deployment",
      });

      const result = await setupModelEnv(
        "gemini/gemini-embedding-001",
        true,
        "proj-1",
      );

      expect(result).toMatchObject({
        X_LITELLM_EMBEDDINGS_model: "gemini/gemini-embedding-001",
      });
      expect(result).not.toHaveProperty("AZURE_EMBEDDINGS_DEPLOYMENT_NAME");
      expect(result).not.toHaveProperty("X_LITELLM_EMBEDDINGS_deployment");
    });

    it("does not synthesize a deployment variable when no mapping exists", async () => {
      const provider = buildAzureProvider();
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        azure: provider,
      });
      vi.mocked(prepareLitellmParams).mockResolvedValue({
        model: "azure/gpt-4o",
        api_key: "azure-key",
      });

      const result = await setupModelEnv("azure/gpt-4o", false, "proj-1");

      expect(result).not.toHaveProperty("AZURE_DEPLOYMENT_NAME");
      expect(result).not.toHaveProperty("X_LITELLM_deployment");
    });
  });
});
