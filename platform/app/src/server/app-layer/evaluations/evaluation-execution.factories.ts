import {
  getProjectModelProviders,
  prepareEnvKeys,
  prepareLitellmParams,
} from "~/server/api/routers/modelProviders.utils";
import { prisma } from "~/server/db";
import { pickGenerationParams } from "~/server/evaluations/generationParams";
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
 * Builds the X_LITELLM_* env block for an evaluator that needs to call a
 * specific model. Validates the provider is configured + enabled, projects
 * litellm params, and overlays whitelisted generation params (temperature,
 * max_tokens, etc.) from the evaluator settings.
 *
 * Throws `EvaluatorConfigError` for misconfigured providers — callers who
 * need a per-worker error class should catch and rewrap.
 */
export async function setupModelEnv(
  model: string,
  embeddings: boolean,
  projectId: string,
  settings?: Record<string, unknown>,
): Promise<Record<string, string>> {
  const modelProviders = await getProjectModelProviders(projectId);
  const provider = model.split("/")[0]!;
  const modelProvider = requireEnabledProvider(
    modelProviders,
    model,
    embeddings,
  );

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
  let envResult = litellmEnv(litellmParams, modelProvider, embeddings);

  // Generation params (temperature, max_tokens, etc.)
  const maxTokensCeiling = resolveMaxTokensCeiling(model, modelProvider);
  const generationParams = pickGenerationParams(settings);
  for (const [param, rawValue] of Object.entries(generationParams)) {
    let value = rawValue;
    if (param === "max_tokens" && typeof value === "number") {
      value = clampMaxTokens(value, maxTokensCeiling);
    }
    const envKey = embeddings
      ? `X_LITELLM_EMBEDDINGS_${param}`
      : `X_LITELLM_${param}`;
    envResult[envKey] = String(value);
  }

  if (embeddings) {
    envResult = { ...envResult, ...prepareEnvKeys(modelProvider) };
  }

  return envResult;
}

type ProjectModelProviders = Awaited<
  ReturnType<typeof getProjectModelProviders>
>;
type ProjectModelProvider = NonNullable<ProjectModelProviders[string]>;

/**
 * The project's row for the model's provider. Throws `EvaluatorConfigError`
 * when the provider is missing or disabled; for an embeddings model the error
 * also lists the enabled providers that do serve embeddings.
 */
function requireEnabledProvider(
  modelProviders: ProjectModelProviders,
  model: string,
  embeddings: boolean,
): ProjectModelProvider {
  const provider = model.split("/")[0]!;
  const modelProvider = modelProviders[provider];
  if (modelProvider?.enabled) return modelProvider;

  const status = modelProvider ? "not enabled" : "not configured";
  throw embeddings
    ? embeddingsProviderError(modelProviders, model, status)
    : new EvaluatorConfigError(`Provider ${provider} is ${status}`);
}

function embeddingsProviderError(
  modelProviders: ProjectModelProviders,
  model: string,
  status: "not configured" | "not enabled",
): EvaluatorConfigError {
  const provider = model.split("/")[0]!;
  const availableProviders = Object.entries(modelProviders)
    .filter(
      ([, candidate]) =>
        candidate.enabled &&
        !candidate.embeddingsUnsupported &&
        ((candidate.embeddingsModels?.length ?? 0) > 0 ||
          (candidate.customEmbeddingsModels?.length ?? 0) > 0),
    )
    .map(([name]) => name)
    .sort();
  const availability =
    availableProviders.length > 0
      ? ` Available embeddings providers: ${availableProviders.join(", ")}.`
      : " No enabled embeddings providers are available.";

  return new EvaluatorConfigError(
    `settings.embeddings_model is "${model}", but provider "${provider}" is ${status}. Set the project's EMBEDDINGS default or select an enabled embeddings model.${availability}`,
  );
}

/**
 * The X_LITELLM_* block for the model's litellm params. An Azure deployment
 * name is not a litellm call param, so it goes on its own env key instead.
 */
function litellmEnv(
  litellmParams: Awaited<ReturnType<typeof prepareLitellmParams>>,
  modelProvider: ProjectModelProvider,
  embeddings: boolean,
): Record<string, string> {
  const { deployment, ...callParams } = litellmParams;
  return {
    ...Object.fromEntries(
      Object.entries(callParams).map(([key, value]) => [
        embeddings ? `X_LITELLM_EMBEDDINGS_${key}` : `X_LITELLM_${key}`,
        value,
      ]),
    ),
    ...azureDeploymentEnv(modelProvider, deployment, embeddings),
  };
}

/** An Azure provider's deployment name, on the env key for this model kind. */
function azureDeploymentEnv(
  modelProvider: ProjectModelProvider,
  deployment: unknown,
  embeddings: boolean,
): Record<string, string> {
  if (
    modelProvider.provider !== "azure" ||
    typeof deployment !== "string" ||
    deployment.trim() === ""
  ) {
    return {};
  }
  const key = embeddings
    ? "AZURE_EMBEDDINGS_DEPLOYMENT_NAME"
    : "AZURE_DEPLOYMENT_NAME";
  return { [key]: deployment };
}
