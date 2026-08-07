import {
  getProjectModelProviders,
  prepareEnvKeys,
  prepareLitellmParams,
} from "~/server/api/routers/modelProviders.utils";
import { prisma } from "~/server/db";
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
        const modelEnv = await setupModelEnv({
          model: settings.model,
          embeddings: false,
          projectId,
          settings,
        });
        evaluatorEnv = { ...evaluatorEnv, ...modelEnv };
      }

      if (
        settings &&
        "embeddings_model" in settings &&
        typeof settings.embeddings_model === "string"
      ) {
        const embeddingsEnv = await setupModelEnv({
          model: settings.embeddings_model,
          embeddings: true,
          projectId,
          settings,
        });
        evaluatorEnv = { ...evaluatorEnv, ...embeddingsEnv };
      }

      return evaluatorEnv;
    },
  };
}

type ModelProviderRecord = Awaited<
  ReturnType<typeof getProjectModelProviders>
>[string];

/**
 * Resolves and validates the configured provider for `model`. Throws
 * `EvaluatorConfigError` when the provider is missing or disabled.
 */
async function resolveEnabledModelProvider({
  model,
  projectId,
}: {
  model: string;
  projectId: string;
}): Promise<{ provider: string; modelProvider: ModelProviderRecord }> {
  const modelProviders = await getProjectModelProviders(projectId);
  const provider = model.split("/")[0]!;
  const modelProvider = modelProviders[provider];

  if (!modelProvider) {
    throw new EvaluatorConfigError(`Provider ${provider} is not configured`);
  }
  if (!modelProvider.enabled) {
    throw new EvaluatorConfigError(`Provider ${provider} is not enabled`);
  }

  return { provider, modelProvider };
}

/**
 * Confirms `modelName` is servable by `modelProvider`, either via its own
 * model list or a custom model entry. When neither lists it, falls back to
 * a cross-row lookup before rejecting — see inline note for why.
 */
async function assertModelIsServable({
  modelProvider,
  modelName,
  embeddings,
  projectId,
  provider,
}: {
  modelProvider: ModelProviderRecord;
  modelName: string;
  embeddings: boolean;
  projectId: string;
  provider: string;
}): Promise<void> {
  const modelList = embeddings
    ? modelProvider.embeddingsModels
    : modelProvider.models;

  const customModelList = embeddings
    ? modelProvider.customEmbeddingsModels
    : modelProvider.customModels;
  const isCustomModel = customModelList?.some((m) => m.modelId === modelName);

  if (
    !modelList ||
    modelList.length === 0 ||
    modelList.includes(modelName) ||
    isCustomModel
  ) {
    return;
  }

  // The collapse winner for the provider key is not necessarily the row
  // that serves this model: with multi-instance providers the model may
  // come from a wider-scope row's custom catalog, and
  // prepareLitellmParams below swaps to that row. Only reject when no
  // accessible enabled row serves the model at all. The lookup is a
  // rescue attempt — if it fails, reject with the config error rather
  // than masking it behind an infrastructure error.
  let servingRow = null;
  try {
    servingRow = await ModelProviderService.create(prisma).findRowServingModel({
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

const GENERATION_PARAMS = [
  "temperature",
  "max_tokens",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "reasoning_effort",
] as const;

// Clamps a max_tokens value to the provider's ceiling; every other
// generation param passes through unchanged.
function normalizeGenerationParamValue({
  param,
  value,
  maxTokensCeiling,
}: {
  param: (typeof GENERATION_PARAMS)[number];
  value: unknown;
  maxTokensCeiling: number | undefined;
}): unknown {
  if (param === "max_tokens" && typeof value === "number") {
    return clampMaxTokens(value, maxTokensCeiling);
  }
  return value;
}

// Overlays whitelisted generation params (temperature, max_tokens, etc.) from
// the evaluator settings onto the litellm env block, clamping max_tokens to
// the provider's ceiling.
function applyGenerationParams({
  envResult,
  settings,
  model,
  modelProvider,
  embeddings,
}: {
  envResult: Record<string, string>;
  settings: Record<string, unknown> | undefined;
  model: string;
  modelProvider: ModelProviderRecord;
  embeddings: boolean;
}): void {
  const maxTokensCeiling = resolveMaxTokensCeiling(model, modelProvider);
  for (const param of GENERATION_PARAMS) {
    const rawValue = settings?.[param];
    if (rawValue === undefined || rawValue === null) continue;

    const value = normalizeGenerationParamValue({
      param,
      value: rawValue,
      maxTokensCeiling,
    });
    const envKey = embeddings
      ? `X_LITELLM_EMBEDDINGS_${param}`
      : `X_LITELLM_${param}`;
    envResult[envKey] = String(value);
  }
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
export async function setupModelEnv({
  model,
  embeddings,
  projectId,
  settings,
}: {
  model: string;
  embeddings: boolean;
  projectId: string;
  settings?: Record<string, unknown>;
}): Promise<Record<string, string>> {
  const { provider, modelProvider } = await resolveEnabledModelProvider({
    model,
    projectId,
  });

  const modelName = model.split("/").slice(1).join("/");
  await assertModelIsServable({
    modelProvider,
    modelName,
    embeddings,
    projectId,
    provider,
  });

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

  applyGenerationParams({
    envResult,
    settings,
    model,
    modelProvider,
    embeddings,
  });

  if (embeddings) {
    envResult = { ...envResult, ...prepareEnvKeys(modelProvider) };
  }

  return envResult;
}
