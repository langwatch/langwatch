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
  prepareLitellmParams: vi
    .fn()
    .mockResolvedValue({ model: "gemini/gemini-1.5-pro", api_key: "test-key" }),
  prepareEnvKeys: vi.fn().mockReturnValue({}),
}));

vi.mock("~/server/modelProviders/resolveMaxTokensCeiling", () => ({
  resolveMaxTokensCeiling: vi.fn().mockReturnValue(null),
}));

vi.mock("~/server/modelProviders/modelDefaults.read", () => ({
  getResolvedDefaultForFeature: vi.fn().mockResolvedValue(null),
}));

import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "~/server/api/routers/modelProviders.utils";
import { getResolvedDefaultForFeature } from "~/server/modelProviders/modelDefaults.read";
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

describe("setupModelEnv", () => {
  // A queued one-shot the test under it never consumes would otherwise be
  // waiting for the next test that does.
  beforeEach(() => {
    vi.mocked(getResolvedDefaultForFeature).mockReset();
    vi.mocked(getResolvedDefaultForFeature).mockResolvedValue(null);
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
    it("throws EvaluatorConfigError", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({});

      await expect(
        setupModelEnv("gemini/gemini-2.5-pro", false, "proj-1"),
      ).rejects.toThrow("Provider gemini is not configured");
    });
  });

  describe("when provider is disabled", () => {
    it("throws EvaluatorConfigError", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider({ enabled: false }),
      });

      await expect(
        setupModelEnv("gemini/gemini-2.5-pro", false, "proj-1"),
      ).rejects.toThrow("Provider gemini is not enabled");
    });
  });

  describe("when the provider maps the model to an Azure deployment", () => {
    function azureProject() {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        azure: buildProvider({
          provider: "azure",
          models: ["gpt-4o"],
          embeddingsModels: ["text-embedding-ada-002"],
          deploymentMapping: { "gpt-4o": "prod-judge" },
        }),
      });
    }

    /** @scenario "A judge on an Azure deployment named something other than the model reaches that deployment" */
    it("sends the deployment under the name langevals reads", async () => {
      azureProject();
      vi.mocked(prepareLitellmParams).mockResolvedValueOnce({
        model: "azure/gpt-4o",
        api_key: "test-key",
        deployment: "prod-judge",
      });

      const env = await setupModelEnv("azure/gpt-4o", false, "proj-1");

      expect(env.AZURE_DEPLOYMENT_NAME).toBe("prod-judge");
    });

    /** @scenario "The deployment name is never sent as a call argument" */
    it("does not send the deployment as a call argument", async () => {
      azureProject();
      vi.mocked(prepareLitellmParams).mockResolvedValueOnce({
        model: "azure/gpt-4o",
        api_key: "test-key",
        deployment: "prod-judge",
      });

      const env = await setupModelEnv("azure/gpt-4o", false, "proj-1");

      expect(env).not.toHaveProperty("X_LITELLM_deployment");
    });

    it("names the embeddings deployment separately from the judge one", async () => {
      azureProject();
      vi.mocked(prepareLitellmParams).mockResolvedValueOnce({
        model: "azure/text-embedding-ada-002",
        api_key: "test-key",
        deployment: "prod-embeddings",
      });

      const env = await setupModelEnv(
        "azure/text-embedding-ada-002",
        true,
        "proj-1",
      );

      expect(env.AZURE_EMBEDDINGS_DEPLOYMENT_NAME).toBe("prod-embeddings");
      expect(env).not.toHaveProperty("X_LITELLM_EMBEDDINGS_deployment");
    });

    it("leaves a provider with no deployment mapping untouched", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider(),
      });

      const env = await setupModelEnv("gemini/gemini-2.5-pro", false, "proj-1");

      expect(env).not.toHaveProperty("AZURE_DEPLOYMENT_NAME");
    });
  });

  describe("when the evaluator's embeddings model names a provider the project does not have", () => {
    function azureOnlyProject() {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        azure: buildProvider({
          provider: "azure",
          models: ["gpt-4o"],
          embeddingsModels: ["text-embedding-ada-002"],
        }),
      });
    }

    /** @scenario "An evaluator embeds with the provider the project actually configured" */
    it("embeds with the model the project resolves to", async () => {
      azureOnlyProject();
      vi.mocked(getResolvedDefaultForFeature).mockResolvedValueOnce({
        model: "azure/text-embedding-ada-002",
        source: "project" as never,
        scope: "project" as never,
      });

      const env = await setupModelEnv(
        "openai/text-embedding-ada-002",
        true,
        "proj-1",
      );

      expect(env.X_LITELLM_EMBEDDINGS_model).toBeDefined();
    });

    /** @scenario "A judge model is never swapped for the project's default" */
    it("refuses a judge model rather than swapping it", async () => {
      azureOnlyProject();

      await expect(
        setupModelEnv("openai/gpt-4o", false, "proj-1"),
      ).rejects.toThrow("Provider openai is not configured");
      expect(getResolvedDefaultForFeature).not.toHaveBeenCalled();
    });

    /** @scenario "With nothing to fall back to, the refusal names the embeddings setting" */
    it("names the embeddings model when there is nothing to fall back to", async () => {
      azureOnlyProject();
      vi.mocked(getResolvedDefaultForFeature).mockResolvedValueOnce(null);

      await expect(
        setupModelEnv("openai/text-embedding-ada-002", true, "proj-1"),
      ).rejects.toThrow(/embeddings model .* "openai\/text-embedding-ada-002"/);
    });

    it("does not fall back to a default whose own provider is missing", async () => {
      azureOnlyProject();
      vi.mocked(getResolvedDefaultForFeature).mockResolvedValueOnce({
        model: "cohere/embed-v4",
        source: "project" as never,
        scope: "project" as never,
      });

      await expect(
        setupModelEnv("openai/text-embedding-ada-002", true, "proj-1"),
      ).rejects.toThrow(/"openai\/text-embedding-ada-002"/);
    });
  });
});
