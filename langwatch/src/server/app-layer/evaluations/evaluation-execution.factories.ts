import {
  getProjectModelProviders,
  prepareEnvKeys,
  prepareLitellmParams,
} from "~/server/api/routers/modelProviders.utils";
import { resolveMaxTokensCeiling } from "~/server/modelProviders/resolveMaxTokensCeiling";
import { clampMaxTokens } from "~/utils/clampMaxTokens";
import { isAzureEvaluatorType } from "./azure-safety-env";
import { getAzureSafetyEnvFromProject } from "./azure-safety-env.server";
import { EvaluatorConfigError } from "./errors";
import type { ModelEnvResolver } from "./evaluation-execution.service";

export function createDefaultModelEnvResolver(): ModelEnvResolver {
  return {
    async resolveForEvaluator({ evaluatorType, evaluator, projectId, settings }) {
      // Hard cutover: Azure Content Safety evaluators never read from process.env.
      // They require a per-project `azure_safety` Model Provider, resolved here.
      // Phase 5 gates runtime execution so unresolved credentials turn into a
      // clear skipped status before reaching this resolver.
      let evaluatorEnv: Record<string, string>;
      if (isAzureEvaluatorType(evaluatorType)) {
        const azureEnv = await getAzureSafetyEnvFromProject(projectId);
        evaluatorEnv = azureEnv ?? {};
      } else {
        evaluatorEnv = Object.fromEntries(
          (evaluator.envVars ?? []).map((envVar) => [envVar, process.env[envVar]!]),
        );
      }

      if (
        settings &&
        "model" in settings &&
        typeof settings.model === "string" &&
        evaluatorType !== "openai/moderation"
      ) {
        const modelEnv = await setupModelEnv(
          settings.model,
          false,
          projectId,
          settings,
        );
        evaluatorEnv = { ...evaluatorEnv, ...modelEnv };
      }

      if (
        settings &&
        "embeddings_model" in settings &&
        typeof settings.embeddings_model === "string"
      ) {
        const embeddingsEnv = await setupModelEnv(
          settings.embeddings_model,
          true,
          projectId,
          settings,
        );
        evaluatorEnv = { ...evaluatorEnv, ...embeddingsEnv };
      }

      return evaluatorEnv;
    },
  };
}

async function setupModelEnv(
  model: string,
  embeddings: boolean,
  projectId: string,
  settings?: Record<string, unknown>,
): Promise<Record<string, string>> {
  const modelProviders = await getProjectModelProviders(projectId);
  const provider = model.split("/")[0]!;
  const modelProvider = modelProviders[provider];

  if (!modelProvider) {
    throw new EvaluatorConfigError(`Provider ${provider} is not configured`);
  }
  if (!modelProvider.enabled) {
    throw new EvaluatorConfigError(`Provider ${provider} is not enabled`);
  }

  const modelName = model.split("/").slice(1).join("/");
  const modelList = embeddings
    ? modelProvider.embeddingsModels
    : modelProvider.models;

  if (modelList && modelList.length > 0 && !modelList.includes(modelName)) {
    throw new EvaluatorConfigError(
      `Model ${modelName} is not in the ${
        embeddings ? "embedding models" : "models"
      } list for ${provider}, please select another model for running this evaluation`,
    );
  }

  const litellmParams = await prepareLitellmParams({
    model,
    modelProvider,
    projectId,
  });

  let envResult = Object.fromEntries(
    Object.entries(litellmParams).map(([key, value]) => [
      embeddings ? `X_LITELLM_EMBEDDINGS_${key}` : `X_LITELLM_${key}`,
      value,
    ]),
  );

  // Generation params (temperature, max_tokens, etc.)
  const generationParams = [
    "temperature",
    "max_tokens",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "seed",
    "reasoning_effort",
  ];
  const maxTokensCeiling = resolveMaxTokensCeiling(model, modelProvider);
  for (const param of generationParams) {
    let value = settings?.[param];
    if (value !== undefined && value !== null) {
      if (param === "max_tokens" && typeof value === "number") {
        value = clampMaxTokens(value, maxTokensCeiling);
      }
      const envKey = embeddings
        ? `X_LITELLM_EMBEDDINGS_${param}`
        : `X_LITELLM_${param}`;
      envResult[envKey] = String(value);
    }
  }

  if (embeddings) {
    envResult = { ...envResult, ...prepareEnvKeys(modelProvider) };
  }

  return envResult;
}
