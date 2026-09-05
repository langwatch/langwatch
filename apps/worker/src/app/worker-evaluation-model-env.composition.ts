import {
  EvaluationModelEnvPort,
  type EvaluationAzureSafetyCredentialsPort,
} from "@langwatch/evaluation-server";
import { isAzureEvaluatorType, EvaluatorConfigError } from "@langwatch/evaluation-contract";
import type { AVAILABLE_EVALUATORS, EvaluatorTypes } from "@langwatch/evaluator-contract";
import type { ManagedProviderService } from "@langwatch/enterprise-managed-provider-contract";
import { clampMaxTokens, type ModelProviderService } from "@langwatch/model-provider-contract";
import {
  getProjectModelProviders,
  prepareEnvKeys,
  prepareLitellmParams,
  resolveMaxTokensCeiling,
} from "@langwatch/model-provider-server";
import type { WorkerModelProviders } from "./worker-model-provider.composition";

/**
 * The evaluator environment, over the composed gateway. Takes the whole
 * `WorkerModelProviders` bundle, not two services, so a caller can never mix
 * a gateway from one graph with a managed-provider service from another.
 */
export function createWorkerEvaluationModelEnv(input: {
  models: WorkerModelProviders;
  azureSafetyCredentials: EvaluationAzureSafetyCredentialsPort;
  /** The process environment an evaluator's own `envVars` are read from. */
  environment: Readonly<Record<string, string | undefined>>;
}): WorkerEvaluationModelEnv {
  return WorkerEvaluationModelEnv.create({
    modelProviders: input.models.modelProviders,
    managedProviders: input.models.managedProviders,
    azureSafetyCredentials: input.azureSafetyCredentials,
    environment: input.environment,
  });
}

/**
 * The environment an evaluator executes with, resolved from the project's
 * model providers. Composed HERE since it bridges two features' server
 * packages. The Azure Content Safety branch never reads `process.env`.
 */
export class WorkerEvaluationModelEnv extends EvaluationModelEnvPort {
  static create(input: {
    modelProviders: ModelProviderService;
    managedProviders: ManagedProviderService;
    azureSafetyCredentials: EvaluationAzureSafetyCredentialsPort;
    /** The process environment an evaluator's own `envVars` are read from. */
    environment: Readonly<Record<string, string | undefined>>;
  }): WorkerEvaluationModelEnv {
    return new WorkerEvaluationModelEnv(input);
  }

  private constructor(
    private readonly deps: {
      modelProviders: ModelProviderService;
      managedProviders: ManagedProviderService;
      azureSafetyCredentials: EvaluationAzureSafetyCredentialsPort;
      environment: Readonly<Record<string, string | undefined>>;
    },
  ) {
    super();
  }

  async resolveForEvaluator({
    evaluatorType,
    evaluator,
    projectId,
    settings,
  }: {
    evaluatorType: EvaluatorTypes;
    evaluator: (typeof AVAILABLE_EVALUATORS)[EvaluatorTypes];
    projectId: string;
    settings?: Record<string, unknown>;
  }): Promise<Record<string, string>> {
    let evaluatorEnv: Record<string, string>;
    if (isAzureEvaluatorType(evaluatorType)) {
      evaluatorEnv =
        (await this.deps.azureSafetyCredentials.tryGetForTenant({ tenantId: projectId })) ?? {};
    } else {
      evaluatorEnv = Object.fromEntries(
        (evaluator.envVars ?? []).map((envVar) => [envVar, this.deps.environment[envVar]!]),
      );
    }

    if (
      settings &&
      "model" in settings &&
      typeof settings.model === "string" &&
      evaluatorType !== "openai/moderation"
    ) {
      evaluatorEnv = {
        ...evaluatorEnv,
        ...(await setupModelEnv(
          this.deps.modelProviders,
          this.deps.managedProviders,
          settings.model,
          false,
          projectId,
          settings,
        )),
      };
    }

    if (
      settings &&
      "embeddings_model" in settings &&
      typeof settings.embeddings_model === "string"
    ) {
      evaluatorEnv = {
        ...evaluatorEnv,
        ...(await setupModelEnv(
          this.deps.modelProviders,
          this.deps.managedProviders,
          settings.embeddings_model,
          true,
          projectId,
          settings,
        )),
      };
    }

    return evaluatorEnv;
  }
}

/**
 * Builds the X_LITELLM_* env block for an evaluator calling a specific model:
 * validates the provider, projects litellm params, and overlays whitelisted
 * generation params. Throws `EvaluatorConfigError` for misconfigured providers.
 */
export async function setupModelEnv(
  modelProvidersService: ModelProviderService,
  managedProviders: ManagedProviderService,
  model: string,
  embeddings: boolean,
  projectId: string,
  settings?: Record<string, unknown>,
): Promise<Record<string, string>> {
  const modelProviders = await getProjectModelProviders(modelProvidersService, projectId);
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
  const isCustomModel = customModelList?.some((m) => m.modelId === modelName);

  if (modelList && modelList.length > 0 && !modelList.includes(modelName) && !isCustomModel) {
    // The collapse winner isn't necessarily the row that serves this model —
    // `prepareLitellmParams` below may swap to a wider-scope row. Only reject
    // when no accessible enabled row serves the model at all; a lookup
    // failure falls through to the config error rather than an infra one.
    let servingRow = null;
    try {
      servingRow = await modelProvidersService.tryFindRowServingModel({
        projectId,
        provider,
        model: modelName,
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

  const litellmParams = await prepareLitellmParams(modelProvidersService, managedProviders, {
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
      const envKey = embeddings ? `X_LITELLM_EMBEDDINGS_${param}` : `X_LITELLM_${param}`;
      envResult[envKey] = String(value);
    }
  }

  if (embeddings) {
    envResult = { ...envResult, ...prepareEnvKeys({ modelProvider, environment: process.env }) };
  }

  return envResult;
}
