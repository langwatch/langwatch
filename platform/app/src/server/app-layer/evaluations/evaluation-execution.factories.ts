import {
  getProjectModelProviders,
  prepareEnvKeys,
  prepareLitellmParams,
} from "~/server/api/routers/modelProviders.utils";
import { prisma } from "~/server/db";
import { getResolvedDefaultForFeature } from "~/server/modelProviders/modelDefaults.read";
import { ModelProviderService } from "~/server/modelProviders/modelProvider.service";
import { resolveMaxTokensCeiling } from "~/server/modelProviders/resolveMaxTokensCeiling";
import { clampMaxTokens } from "~/utils/clampMaxTokens";
import { isAzureEvaluatorType } from "./azure-safety-env";
import { getAzureSafetyEnvFromProject } from "./azure-safety-env.server";
import { EvaluatorConfigError } from "./errors";
import type { ModelEnvResolver } from "./evaluation-execution.service";

export function createDefaultModelEnvResolver(): ModelEnvResolver {
  return {
    async resolveForEvaluator({
      evaluatorType,
      evaluator,
      projectId,
      settings,
    }) {
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
          (evaluator.envVars ?? []).map((envVar) => [
            envVar,
            process.env[envVar]!,
          ]),
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

/**
 * The feature key whose cascade answer says what a project embeds with. Shared
 * with the evaluator create path, so an evaluator created today and one
 * created before the cascade existed resolve to the same model.
 */
const EMBEDDINGS_FEATURE_KEY = "analytics.topic_clustering_embeddings";

/**
 * The embeddings model an evaluation should actually use on this project.
 *
 * Returns the requested model whenever its provider is configured and enabled.
 * Otherwise falls back to the project's cascade-resolved embeddings default,
 * and only when that default is itself usable. Nothing here reaches for a
 * hardcoded provider: when the cascade has nothing to say the requested model
 * comes back unchanged, so the caller reports the real gap rather than a
 * fabricated one.
 */
async function resolveEmbeddingsModel({
  requested,
  projectId,
  modelProviders,
}: {
  requested: string;
  projectId: string;
  modelProviders: Awaited<ReturnType<typeof getProjectModelProviders>>;
}): Promise<string> {
  const isUsable = (model: string): boolean =>
    modelProviders[model.split("/")[0]!]?.enabled === true;

  if (isUsable(requested)) return requested;

  const resolved = await getResolvedDefaultForFeature(
    { prisma, session: null },
    { projectId, featureKey: EMBEDDINGS_FEATURE_KEY },
  );

  return resolved?.model && isUsable(resolved.model)
    ? resolved.model
    : requested;
}

/**
 * Builds the X_LITELLM_* env block for an evaluator that needs to call a
 * specific model. Validates the provider is configured + enabled, projects
 * litellm params, and overlays whitelisted generation params (temperature,
 * max_tokens, etc.) from the evaluator settings.
 *
 * Throws `EvaluatorConfigError` for misconfigured providers — callers who
 * need a per-worker error class should catch and rewrap.
 */
export async function setupModelEnv(
  requestedModel: string,
  embeddings: boolean,
  projectId: string,
  settings?: Record<string, unknown>,
): Promise<Record<string, string>> {
  const modelProviders = await getProjectModelProviders(projectId);

  // The embeddings model is rarely a deliberate choice: an evaluator that
  // carries one gets it from a literal baked into the evaluator definition
  // (`openai/text-embedding-ada-002`), so a project that never configured
  // OpenAI failed here on a provider it does not use and never picked. Ask
  // the cascade what this project actually embeds with before refusing. The
  // judge `model` is chosen per evaluator and is left exactly as configured.
  const model = embeddings
    ? await resolveEmbeddingsModel({
        requested: requestedModel,
        projectId,
        modelProviders,
      })
    : requestedModel;

  const provider = model.split("/")[0]!;
  const modelProvider = modelProviders[provider];

  if (!modelProvider) {
    throw new EvaluatorConfigError(
      embeddings
        ? `The embeddings model for this evaluation is "${model}", and ${provider} is not configured for this project. Point the evaluator's embeddings model at a configured provider, or configure ${provider}.`
        : `Provider ${provider} is not configured`,
    );
  }
  if (!modelProvider.enabled) {
    throw new EvaluatorConfigError(
      embeddings
        ? `The embeddings model for this evaluation is "${model}", and ${provider} is not enabled for this project. Point the evaluator's embeddings model at an enabled provider, or enable ${provider}.`
        : `Provider ${provider} is not enabled`,
    );
  }

  const modelName = model.split("/").slice(1).join("/");
  const modelList = embeddings
    ? modelProvider.embeddingsModels
    : modelProvider.models;

  const customModelList = embeddings
    ? modelProvider.customEmbeddingsModels
    : modelProvider.customModels;
  const isCustomModel = customModelList?.some((m) => m.modelId === modelName);

  if (
    modelList &&
    modelList.length > 0 &&
    !modelList.includes(modelName) &&
    !isCustomModel
  ) {
    // The collapse winner for the provider key is not necessarily the row
    // that serves this model: with multi-instance providers the model may
    // come from a wider-scope row's custom catalog, and
    // prepareLitellmParams below swaps to that row. Only reject when no
    // accessible enabled row serves the model at all. The lookup is a
    // rescue attempt — if it fails, reject with the config error rather
    // than masking it behind an infrastructure error.
    let servingRow = null;
    try {
      servingRow = await ModelProviderService.create(
        prisma,
      ).findRowServingModel({
        projectId,
        provider,
        bareModel: modelName,
      });
    } catch {
      // fall through to the config error below
    }
    if (!servingRow) {
      throw new EvaluatorConfigError(
        `Model ${modelName} is not in the ${
          embeddings ? "embedding models" : "models"
        } list for ${provider}, please select another model for running this evaluation`,
      );
    }
  }

  const litellmParams = await prepareLitellmParams({
    model,
    modelProvider,
    projectId,
  });

  // The Azure deployment name is not a litellm call argument — litellm reads
  // the deployment out of the model string (`azure/<deployment>`). Sent as
  // `X_LITELLM_deployment` it landed in the call kwargs, where nothing
  // consumed it, and the request kept targeting `azure/<model-id>`: on a
  // provider whose deployment is named anything else, a deployment that does
  // not exist. `AZURE_DEPLOYMENT_NAME` / `AZURE_EMBEDDINGS_DEPLOYMENT_NAME`
  // are the names langevals already reads to rewrite the model string.
  const { deployment, ...callParams } = litellmParams;

  let envResult: Record<string, string> = Object.fromEntries(
    Object.entries(callParams).map(([key, value]) => [
      embeddings ? `X_LITELLM_EMBEDDINGS_${key}` : `X_LITELLM_${key}`,
      value,
    ]),
  );

  if (deployment) {
    envResult[
      embeddings ? "AZURE_EMBEDDINGS_DEPLOYMENT_NAME" : "AZURE_DEPLOYMENT_NAME"
    ] = deployment;
  }

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
