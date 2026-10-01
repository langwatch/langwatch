import { createApiFixture } from "@langwatch/api-fixture";
import {
  modelProviderExecutionSchema,
  type ModelProviderApi,
  type ModelProviderExecution,
} from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { ModelProviderEvaluatorModelEnvService } from "../model-provider-evaluator-model-env.service.ts";

function provider(overrides: Partial<ModelProviderExecution>): ModelProviderExecution {
  return modelProviderExecutionSchema.parse({
    id: "mp_openai",
    organizationId: "org-1",
    provider: "openai",
    name: "OpenAI",
    enabled: true,
    routingHandle: null,
    scopes: [],
    customKeys: null,
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    models: ["gpt-5-mini"],
    embeddingsModels: ["text-embedding-3-small"],
    isSystem: false,
    embeddingsUnsupported: false,
    ...overrides,
  });
}

function service(
  providers: Record<string, ModelProviderExecution>,
  findRowServingModel: ModelProviderApi["findRowServingModel"] = async () => null,
) {
  return ModelProviderEvaluatorModelEnvService.create({
    modelProviders: createApiFixture<ModelProviderApi>({
      getExecutionProviders: async () => providers,
      findRowServingModel,
      prepareExecution: async () => ({ model: "openai/gpt-5-mini", api_key: "sk-test" }),
    }),
    environment: {},
  });
}

const base = { projectId: "project-1", embeddings: false } as const;

describe("ModelProviderEvaluatorModelEnvService", () => {
  describe("given the project has no row for the provider", () => {
    it("refuses with the evaluator config code", async () => {
      await expect(
        service({}).prepare({ ...base, model: "openai/gpt-5-mini" }),
      ).rejects.toMatchObject({
        code: "evaluator_config_error",
        message: "Provider openai is not configured",
      });
    });
  });

  describe("given the provider is disabled", () => {
    it("refuses with the evaluator config code", async () => {
      await expect(
        service({ openai: provider({ enabled: false }) }).prepare({
          ...base,
          model: "openai/gpt-5-mini",
        }),
      ).rejects.toMatchObject({ code: "evaluator_config_error" });
    });
  });

  describe("given the model is outside the list and no row serves it", () => {
    it("refuses with the evaluator config code", async () => {
      await expect(
        service({ openai: provider({}) }).prepare({ ...base, model: "openai/gpt-4o" }),
      ).rejects.toMatchObject({ code: "evaluator_config_error" });
    });
  });

  describe("given the serving-row lookup fails", () => {
    it("refuses with the config error, not the lookup failure", async () => {
      await expect(
        service({ openai: provider({}) }, async () => {
          throw new Error("database down");
        }).prepare({ ...base, model: "openai/gpt-4o" }),
      ).rejects.toMatchObject({ code: "evaluator_config_error" });
    });
  });

  describe("given a listed chat model with generation settings", () => {
    it("prefixes the parameters and clamps max_tokens to the custom ceiling", async () => {
      const env = await service({
        openai: provider({
          customModels: [{ id: "gpt-5-mini", label: "mini", type: "chat", maxTokens: 100 }],
        }),
      }).prepare({
        ...base,
        model: "openai/gpt-5-mini",
        settings: { temperature: 0.2, max_tokens: 5000, seed: null },
      });

      expect(env).toEqual({
        X_LITELLM_model: "openai/gpt-5-mini",
        X_LITELLM_api_key: "sk-test",
        X_LITELLM_temperature: "0.2",
        X_LITELLM_max_tokens: "100",
      });
    });
  });

  describe("given an embeddings model", () => {
    it("prefixes with the embeddings namespace", async () => {
      const env = await service({ openai: provider({}) }).prepare({
        ...base,
        embeddings: true,
        model: "openai/text-embedding-3-small",
      });

      expect(env).toMatchObject({
        X_LITELLM_EMBEDDINGS_model: "openai/gpt-5-mini",
        X_LITELLM_EMBEDDINGS_api_key: "sk-test",
      });
    });
  });
});
