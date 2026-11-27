/**
 * @vitest-environment node
 * @see specs/worker/worker-capability-mount.feature
 */
import type { ModelProviderApi, ModelProviderExecution } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { CLUSTERING_ERROR_CODES } from "@langwatch/topic-contract";
import { describe, expect, it } from "vitest";

import { ModelProviderTopicClusteringModelsService } from "../topic-clustering-models.service.ts";

const PROJECT = "project_1";

function execution(overrides: Partial<ModelProviderExecution> = {}): ModelProviderExecution {
  return { provider: "openai", enabled: true, ...overrides } as ModelProviderExecution;
}

function modelsOver({
  embeddings = "openai/text-embedding-3-small",
  providers = { openai: execution() },
}: {
  embeddings?: string;
  providers?: Record<string, ModelProviderExecution>;
} = {}) {
  const asked: { featureKey: string; projectId: string }[] = [];
  const api = createApiFixture<ModelProviderApi>({
    resolveModelForFeature: async ({ featureKey, projectId }) => {
      asked.push({ featureKey, projectId });
      return {
        model: featureKey === "analytics.topic_clustering_llm" ? "openai/gpt-5-mini" : embeddings,
        source: "feature_override",
        scope: "project",
        feature: { key: featureKey, role: "DEFAULT", displayName: featureKey, description: "" },
      };
    },
    getExecutionProviders: async () => providers,
    prepareExecution: async ({ model }) => ({ model }),
  });

  return {
    asked,
    models: ModelProviderTopicClusteringModelsService.create({ modelProviders: api }),
  };
}

describe("topic clustering's models, read through the model provider", () => {
  describe("when a clustering page resolves its clustering, embedding and execution models", () => {
    /** @scenario "Topic clustering resolves its models through the composed gateway" */
    it("asks the gateway for each, under the clustering feature keys", async () => {
      const { asked, models } = modelsOver();

      await expect(models.resolveClusteringModel(PROJECT)).resolves.toMatchObject({
        model: "openai/gpt-5-mini",
      });
      const embeddings = await models.resolveEmbeddingsModel(PROJECT);
      await expect(models.findExecutionProviders(PROJECT)).resolves.toHaveProperty("openai");
      await expect(
        models.prepareLitellmParams({
          model: embeddings.model,
          modelProvider: embeddings.modelProvider,
          projectId: PROJECT,
        }),
      ).resolves.toEqual({ model: "openai/text-embedding-3-small" });

      expect(asked).toEqual([
        { featureKey: "analytics.topic_clustering_llm", projectId: PROJECT },
        { featureKey: "analytics.topic_clustering_embeddings", projectId: PROJECT },
      ]);
    });
  });

  describe("when the embeddings model names a provider that is missing", () => {
    /** @scenario "Topic clustering names the provider it cannot use rather than inventing a model" */
    it("refuses naming the provider", async () => {
      const { models } = modelsOver({ providers: {} });

      const refusal = models.resolveEmbeddingsModel(PROJECT);

      await expect(refusal).rejects.toMatchObject({
        code: CLUSTERING_ERROR_CODES.MODEL_NOT_CONFIGURED,
      });
    });
  });

  describe("when the embeddings model names a disabled provider", () => {
    /** @scenario "A disabled embeddings provider skips the run like a disabled clustering provider" */
    it("returns the provider so the run can see it is disabled", async () => {
      const { models } = modelsOver({ providers: { openai: execution({ enabled: false }) } });

      await expect(models.resolveEmbeddingsModel(PROJECT)).resolves.toMatchObject({
        model: "openai/text-embedding-3-small",
        modelProvider: { enabled: false },
      });
    });
  });
});
