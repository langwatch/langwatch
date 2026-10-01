import { createApiFixture } from "@langwatch/api-fixture";
import { AVAILABLE_EVALUATORS, type EvaluatorDefinition } from "@langwatch/evaluator-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { EvaluatorModelEnvService } from "../evaluator-model-env.service.ts";

function definitionOf(evaluatorType: string): EvaluatorDefinition {
  const definition = AVAILABLE_EVALUATORS[evaluatorType];
  if (!definition) throw new Error(`no evaluator ${evaluatorType}`);
  return definition;
}

type PrepareInput = Parameters<ModelProviderApi["prepareEvaluatorModelEnv"]>[0];

function service(options: { calls?: PrepareInput[]; azure?: Record<string, string> } = {}) {
  return EvaluatorModelEnvService.create({
    modelProviders: createApiFixture<ModelProviderApi>({
      prepareEvaluatorModelEnv: async (input) => {
        options.calls?.push(input);
        return {
          [input.embeddings ? "X_LITELLM_EMBEDDINGS_model" : "X_LITELLM_model"]: input.model,
        };
      },
    }),
    azureSafety: {
      resolveForTenant: async () =>
        options.azure
          ? { kind: "configured", credentials: options.azure }
          : { kind: "unconfigured" },
    },
    environment: { read: () => ({ OPENAI_API_KEY: "sk-install" }) },
  });
}

describe("EvaluatorModelEnvService", () => {
  describe("given a judge evaluator with a model and an embeddings model", () => {
    it("layers both model blocks over the evaluator's own variables", async () => {
      const calls: PrepareInput[] = [];
      const env = await service({ calls }).resolveForEvaluator({
        evaluatorType: "ragas/faithfulness",
        evaluator: definitionOf("ragas/faithfulness"),
        projectId: "project-1",
        settings: { model: "openai/gpt-5-mini", embeddings_model: "openai/text-embedding-3-small" },
      });

      expect(env).toMatchObject({
        X_LITELLM_model: "openai/gpt-5-mini",
        X_LITELLM_EMBEDDINGS_model: "openai/text-embedding-3-small",
      });
      expect(calls.map((call) => call.embeddings)).toEqual([false, true]);
    });
  });

  describe("given the moderation evaluator names a model", () => {
    it("does not resolve a model block for it", async () => {
      const calls: PrepareInput[] = [];
      const env = await service({ calls }).resolveForEvaluator({
        evaluatorType: "openai/moderation",
        evaluator: definitionOf("openai/moderation"),
        projectId: "project-1",
        settings: { model: "openai/omni-moderation-latest" },
      });

      expect(calls).toEqual([]);
      expect(env).toEqual({ OPENAI_API_KEY: "sk-install" });
    });
  });

  describe("given an Azure safety evaluator", () => {
    it("reads the tenant's provider credentials, never the install's variables", async () => {
      const azure = { AZURE_CONTENT_SAFETY_ENDPOINT: "https://cs", AZURE_CONTENT_SAFETY_KEY: "k" };

      await expect(
        service({ azure }).resolveForEvaluator({
          evaluatorType: "azure/prompt_injection",
          evaluator: definitionOf("azure/prompt_injection"),
          projectId: "project-1",
        }),
      ).resolves.toEqual(azure);
      await expect(
        service().resolveForEvaluator({
          evaluatorType: "azure/prompt_injection",
          evaluator: definitionOf("azure/prompt_injection"),
          projectId: "project-1",
        }),
      ).resolves.toEqual({});
    });
  });
});
