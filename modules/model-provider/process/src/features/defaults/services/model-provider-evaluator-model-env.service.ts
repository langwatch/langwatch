import {
  computeClampedMaxTokens,
  EvaluatorConfigError,
  type ModelProviderApi,
} from "@langwatch/model-provider-contract";

import {
  getProjectModelProviders,
  type LegacyModelProviderExecution,
  prepareEnvKeys,
} from "../../../rules/legacy-model-provider.rules.ts";
import { pickMaxTokensCeiling } from "../../../rules/max-tokens-ceiling.rules.ts";

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
    const modelProvider = getEnabledProvider(modelProviders, model, embeddings);

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
    const envResult: Record<string, string> = litellmEnv(litellmParams, modelProvider, embeddings);

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

type ProjectModelProviders = Awaited<ReturnType<typeof getProjectModelProviders>>;

/**
 * The project's row for the model's provider. Throws `EvaluatorConfigError`
 * when the provider is missing or disabled; for an embeddings model the error
 * also lists the enabled providers that do serve embeddings.
 */
function getEnabledProvider(
  modelProviders: ProjectModelProviders,
  model: string,
  embeddings: boolean,
): LegacyModelProviderExecution {
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
    .toSorted();
  const availability =
    availableProviders.length > 0
      ? ` Available embeddings providers: ${availableProviders.join(", ")}.`
      : " No enabled embeddings providers are available.";

  return new EvaluatorConfigError(
    `settings.embeddings_model is "${model}", but provider "${provider}" is ${status}. Set the project's EMBEDDINGS default or select an enabled embeddings model.${availability}`,
    {
      meta: {
        setting: "settings.embeddings_model",
        model,
        provider,
        status,
        availableEmbeddingsProviders: availableProviders,
      },
    },
  );
}

/**
 * The X_LITELLM_* block for the model's litellm params. An Azure deployment
 * name is not a litellm call param, so it goes on its own env key instead.
 */
function litellmEnv(
  litellmParams: Record<string, string>,
  modelProvider: LegacyModelProviderExecution,
  embeddings: boolean,
): Record<string, string> {
  const prefix = embeddings ? "X_LITELLM_EMBEDDINGS_" : "X_LITELLM_";
  const { deployment, ...callParams } = litellmParams;
  return {
    ...Object.fromEntries(
      Object.entries(callParams).map(([key, value]) => [`${prefix}${key}`, value]),
    ),
    ...azureDeploymentEnv(modelProvider, deployment, embeddings),
  };
}

/** An Azure provider's deployment name, on the env key for this model kind. */
function azureDeploymentEnv(
  modelProvider: LegacyModelProviderExecution,
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
  const key = embeddings ? "AZURE_EMBEDDINGS_DEPLOYMENT_NAME" : "AZURE_DEPLOYMENT_NAME";
  return { [key]: deployment };
}
