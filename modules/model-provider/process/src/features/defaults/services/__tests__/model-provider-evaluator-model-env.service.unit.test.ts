import {
  modelProviderExecutionSchema,
  type ModelProviderApi,
  type ModelProviderExecution,
} from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
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

  describe("given an evaluator whose settings carry temperature 1, top_p 1 and max_tokens 64000", () => {
    /** @scenario Configured generation parameters reach the evaluator engine */
    it("carries the whitelisted parameters as configured and drops a key outside the whitelist", async () => {
      const env = await service({ openai: provider({}) }).prepare({
        ...base,
        model: "openai/gpt-5-mini",
        settings: { temperature: 1, top_p: 1, max_tokens: 64000, unlisted_param: "leak" },
      });

      expect(env).toMatchObject({
        X_LITELLM_temperature: "1",
        X_LITELLM_top_p: "1",
        X_LITELLM_max_tokens: "64000",
      });
      expect(Object.keys(env)).not.toContain("X_LITELLM_unlisted_param");
      expect(Object.values(env)).not.toContain("leak");
    });
  });

  describe("given a Vertex AI row serving a catalogued Gemini model and a tuned endpoint", () => {
    const vertex = provider({
      id: "mp_vertex",
      provider: "vertex_ai",
      name: "Vertex AI",
      models: ["gemini-2.5-pro", "my-tuned-endpoint"],
    });
    const prepare = (model: string, maxTokens?: number) =>
      service({ vertex_ai: vertex }).prepare({
        ...base,
        model,
        settings: maxTokens === undefined ? {} : { max_tokens: maxTokens },
      });

    /** @scenario "An evaluator's max tokens fits the model it runs on, Vertex AI included" */
    it("sends nothing when max tokens is not set, and a set value held to the model's limit", async () => {
      expect(await prepare("vertex_ai/my-tuned-endpoint")).not.toHaveProperty(
        "X_LITELLM_max_tokens",
      );
      expect(await prepare("vertex_ai/gemini-2.5-pro")).not.toHaveProperty("X_LITELLM_max_tokens");
      expect(await prepare("vertex_ai/gemini-2.5-pro", 128000)).toMatchObject({
        X_LITELLM_max_tokens: "65536",
      });
      expect(await prepare("vertex_ai/my-tuned-endpoint", 4000)).toMatchObject({
        X_LITELLM_max_tokens: "4000",
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

  describe("given Azure deployment mappings", () => {
    // A service whose provider row and prepared execution params are supplied
    // per-test, so an Azure `deployment` param can be exercised. The deployment
    // is a routing fact, not a litellm call param: it must leave the X_LITELLM
    // block and land on the env name Langevals reads (#7766).
    function azureService(
      azureProvider: ModelProviderExecution,
      params: Record<string, string>,
    ) {
      return ModelProviderEvaluatorModelEnvService.create({
        modelProviders: createApiFixture<ModelProviderApi>({
          getExecutionProviders: async () => ({ azure: azureProvider }),
          findRowServingModel: async () => null,
          prepareExecution: async () => params,
        }),
        environment: {},
      });
    }

    describe("when a completion model resolves a deployment", () => {
      it("maps it to the env name Langevals consumes", async () => {
        const env = await azureService(
          provider({ provider: "azure", name: "Azure", models: ["gpt-5-mini"] }),
          { model: "azure/gpt-5-mini", api_key: "az-key", deployment: "prod-judge" },
        ).prepare({ ...base, model: "azure/gpt-5-mini" });

        expect(env).toMatchObject({ AZURE_DEPLOYMENT_NAME: "prod-judge" });
        expect(env).not.toHaveProperty("X_LITELLM_deployment");
      });
    });

    describe("when an embeddings model resolves a deployment", () => {
      it("maps it and preserves Azure credentials", async () => {
        const env = await azureService(
          provider({
            provider: "azure",
            name: "Azure",
            embeddingsModels: ["text-embedding-3-small"],
          }),
          {
            model: "azure/text-embedding-3-small",
            api_key: "az-key",
            deployment: "prod-embeddings",
          },
        ).prepare({ ...base, embeddings: true, model: "azure/text-embedding-3-small" });

        expect(env).toMatchObject({
          AZURE_EMBEDDINGS_DEPLOYMENT_NAME: "prod-embeddings",
          X_LITELLM_EMBEDDINGS_api_key: "az-key",
        });
        expect(env).not.toHaveProperty("X_LITELLM_EMBEDDINGS_deployment");
      });
    });

    describe("when the provider is not Azure", () => {
      it("does not turn deployment metadata into Azure routing", async () => {
        const env = await azureService(provider({ models: ["gpt-5-mini"] }), {
          model: "openai/gpt-5-mini",
          api_key: "sk-test",
          deployment: "whatever",
        }).prepare({ ...base, model: "openai/gpt-5-mini" });

        expect(env).not.toHaveProperty("AZURE_DEPLOYMENT_NAME");
        expect(env).not.toHaveProperty("AZURE_EMBEDDINGS_DEPLOYMENT_NAME");
      });
    });

    describe("when no mapping exists", () => {
      it("does not synthesize a deployment variable", async () => {
        const env = await azureService(
          provider({ provider: "azure", name: "Azure", models: ["gpt-5-mini"] }),
          { model: "azure/gpt-5-mini", api_key: "az-key" },
        ).prepare({ ...base, model: "azure/gpt-5-mini" });

        expect(env).not.toHaveProperty("AZURE_DEPLOYMENT_NAME");
      });
    });
  });
});
