import {
  computeClampedMaxTokens,
  EvaluatorConfigError,
  type ModelProviderApi,
} from "@langwatch/model-provider-contract";

import { getProjectModelProviders, prepareEnvKeys } from "../rules/legacy-model-provider.rules.ts";
import { pickMaxTokensCeiling } from "../rules/max-tokens-ceiling.rules.ts";

const GENERATION_PARAMS = [
  "temperature",
  "max_tokens",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "reasoning_effort",
] as const;

type EvaluatorModelEnvInput = Parameters<ModelProviderApi["prepareEvaluatorModelEnv"]>[0];

/** The environment block an evaluator calls one model with: main's `setupModelEnv`, one to one. */
export class ModelProviderEvaluatorModelEnvService {
  readonly #modelProviders: Pick<
    ModelProviderApi,
    "getExecutionProviders" | "findRowServingModel" | "prepareExecution"
  >;
  readonly #environment: Readonly<Record<string, string | undefined>>;

  private constructor(options: {
    modelProviders: Pick<
      ModelProviderApi,
      "getExecutionProviders" | "findRowServingModel" | "prepareExecution"
    >;
    environment: Readonly<Record<string, string | undefined>>;
  }) {
    this.#modelProviders = options.modelProviders;
    this.#environment = options.environment;
  }

  static create(options: {
    modelProviders: Pick<
      ModelProviderApi,
      "getExecutionProviders" | "findRowServingModel" | "prepareExecution"
    >;
    /** The composing process's fallback for every provider key a row did not store. */
    environment: Readonly<Record<string, string | undefined>>;
  }): ModelProviderEvaluatorModelEnvService {
    return new ModelProviderEvaluatorModelEnvService(options);
  }

  async prepare({
    projectId,
    model,
    embeddings,
    settings,
  }: EvaluatorModelEnvInput): Promise<Record<string, string>> {
    const modelProviders = await getProjectModelProviders(this.#modelProviders, projectId);
    const provider = model.split("/")[0]!;
    const modelProvider = modelProviders[provider];

    if (!modelProvider) {
      throw new EvaluatorConfigError(`Provider ${provider} is not configured`);
    }
    if (!modelProvider.enabled) {
      throw new EvaluatorConfigError(`Provider ${provider} is not enabled`);
    }

    const modelName = model.split("/").slice(1).join("/");
    const modelList = embeddings ? modelProvider.embeddingsModels : modelProvider.models;
    const customModelList = embeddings
      ? modelProvider.customEmbeddingsModels
      : modelProvider.customModels;
    const isCustomModel = customModelList?.some((entry) => entry.modelId === modelName);

    if (modelList && modelList.length > 0 && !modelList.includes(modelName) && !isCustomModel) {
      const served = await this.#isServedByAnyRow({ projectId, provider, model: modelName });
      if (!served) {
        throw new EvaluatorConfigError(
          `Model ${modelName} is not in the ${
            embeddings ? "embedding models" : "models"
          } list for ${provider}, please select another model for running this evaluation`,
        );
      }
    }

    const prefix = embeddings ? "X_LITELLM_EMBEDDINGS_" : "X_LITELLM_";
    const litellmParams = await this.#modelProviders.prepareExecution({ model, projectId });
    const envResult: Record<string, string> = Object.fromEntries(
      Object.entries(litellmParams).map(([key, value]) => [`${prefix}${key}`, value]),
    );

    Object.assign(
      envResult,
      generationParamsEnv({
        prefix,
        settings,
        maxTokensCeiling: pickMaxTokensCeiling(model, modelProvider),
      }),
    );

    if (!embeddings) return envResult;

    return {
      ...envResult,
      ...prepareEnvKeys({ modelProvider, environment: { ...this.#environment } }),
    };
  }

  /** Only a row serving the model clears the list check; a failed lookup is the config error. */
  async #isServedByAnyRow(input: {
    projectId: string;
    provider: string;
    model: string;
  }): Promise<boolean> {
    try {
      return (await this.#modelProviders.findRowServingModel(input)) !== null;
    } catch {
      return false;
    }
  }
}

/** The whitelisted generation settings, with `max_tokens` clamped to the model's ceiling. */
function generationParamsEnv({
  prefix,
  settings,
  maxTokensCeiling,
}: {
  prefix: string;
  settings: Readonly<Record<string, unknown>> | undefined;
  maxTokensCeiling: number | undefined;
}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const param of GENERATION_PARAMS) {
    const value = settings?.[param];
    if (value === undefined || value === null) continue;
    if (param === "max_tokens" && typeof value === "number") {
      env[`${prefix}${param}`] = String(computeClampedMaxTokens(value, maxTokensCeiling));
    } else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      env[`${prefix}${param}`] = String(value);
    } else {
      env[`${prefix}${param}`] = JSON.stringify(value);
    }
  }
  return env;
}
