/**
 * The legacy Model Provider shapes the execution paths still speak.
 *
 * LiteLLM dispatch, the evaluator runner, the workflow DSL and the Azure
 * content-safety env resolver were all written against the Prisma row this
 * feature used to hand out. They are adapted here, at the edge of the package,
 * so the canonical DTOs (`ModelProviderExecution`, `ModelProviderSummary`) stay
 * the only thing the service returns and no caller reaches a row shape again.
 *
 * `toLegacyExecutionProvider` and `toLegacyProviderSummary` differ only in what
 * they are given: the first adapts the server-only execution DTO, whose
 * `customKeys` are decrypted, and the second the summary DTO, whose credentials
 * are already masked. Neither masks anything itself — mixing them up would put
 * a decrypted key on a browser response, so they are named for the DTO rather
 * than merged into one call.
 */
import {
  customModelEntrySchema,
  getAllModels,
  getParameterConstraints,
  getSchemaShape,
  modelProviders,
  type Model,
  type ModelMetadataForFrontend,
  type ModelProviderExecution,
  type ModelProviderService,
  type ModelProviderSummary,
} from "@langwatch/model-provider-contract";

type LegacyModelProviderScope = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

type LegacyCustomModel = {
  modelId: string;
  displayName: string;
  mode: "chat" | "embedding";
  maxTokens?: number | null;
  supportedParameters?: string[];
  multimodalInputs?: Array<"image" | "file" | "audio">;
};

/**
 * The legacy execution shape used by LiteLLM and the workflow DSL.  It is
 * deliberately assembled from the canonical server-only execution DTO at the
 * app boundary: contract callers never receive the app's registry type or
 * Prisma row shape.
 */
export type LegacyModelProviderExecution = {
  id: string;
  organizationId: string;
  provider: string;
  name: string;
  enabled: boolean;
  defaultModel?: string;
  routingHandle: string | null;
  scopes: LegacyModelProviderScope[];
  scopeType?: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId?: string;
  customKeys: Record<string, unknown> | null;
  customModels: LegacyCustomModel[];
  customEmbeddingsModels: LegacyCustomModel[];
  extraHeaders: Array<{ key: string; value: string }>;
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  rateLimitRpd: number | null;
  fallbackPriorityGlobal: number | null;
  providerConfig: Record<string, unknown> | null;
  deploymentMapping?: Record<string, string> | null;
  createdAt: Date;
  updatedAt: Date;
  models?: string[] | null;
  embeddingsModels?: string[] | null;
  disabledByDefault?: boolean;
  isSystem: boolean;
  embeddingsUnsupported: boolean;
};

function scopeRank(scopeType: LegacyModelProviderExecution["scopeType"]): number {
  if (scopeType === "PROJECT") return 3;
  if (scopeType === "TEAM") return 2;
  return 1;
}

function narrowestScope(scopes: LegacyModelProviderExecution["scopes"]): {
  scopeType?: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId?: string;
} {
  const scope = [...scopes].sort(
    (left, right) => scopeRank(right.scopeType) - scopeRank(left.scopeType),
  )[0];
  return scope ? { scopeType: scope.scopeType, scopeId: scope.scopeId } : {};
}

function toLegacyCustomModel(
  model: Model,
  mode: "chat" | "embedding",
): LegacyModelProviderExecution["customModels"][number] {
  return customModelEntrySchema.parse({
    modelId: model.id,
    displayName: model.label,
    mode,
    ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
    ...(model.supportedParameters === undefined
      ? {}
      : { supportedParameters: model.supportedParameters }),
    ...(model.multimodalInputs === undefined ? {} : { multimodalInputs: model.multimodalInputs }),
  });
}

function toLegacyExecutionShape(
  provider: ModelProviderExecution | ModelProviderSummary,
): LegacyModelProviderExecution {
  const scopes = provider.scopes.map((scope) => ({
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
  }));
  return {
    id: provider.id,
    organizationId: provider.organizationId,
    provider: provider.provider,
    name: provider.name,
    enabled: provider.enabled,
    ...(provider.defaultModel === undefined ? {} : { defaultModel: provider.defaultModel }),
    routingHandle: provider.routingHandle,
    scopes,
    ...narrowestScope(scopes),
    customKeys: provider.customKeys,
    customModels: provider.customModels.map((model) => toLegacyCustomModel(model, "chat")),
    customEmbeddingsModels: provider.customEmbeddingsModels.map((model) =>
      toLegacyCustomModel(model, "embedding"),
    ),
    extraHeaders: provider.extraHeaders,
    rateLimitRpm: provider.rateLimitRpm,
    rateLimitTpm: provider.rateLimitTpm,
    rateLimitRpd: provider.rateLimitRpd,
    fallbackPriorityGlobal: provider.fallbackPriorityGlobal,
    providerConfig: provider.providerConfig,
    deploymentMapping: provider.deploymentMapping ?? null,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
    models: provider.models ?? null,
    embeddingsModels: provider.embeddingsModels ?? null,
    ...(provider.disabledByDefault === undefined
      ? {}
      : { disabledByDefault: provider.disabledByDefault }),
    isSystem: provider.isSystem,
    embeddingsUnsupported: provider.embeddingsUnsupported,
  };
}

/** Adapts a canonical execution DTO without masking its server-only credentials. */
export function toLegacyExecutionProvider(
  provider: ModelProviderExecution,
): LegacyModelProviderExecution {
  return toLegacyExecutionShape(provider);
}

/** Adapts a canonical summary DTO, whose credentials have already been masked. */
export function toLegacyProviderSummary(
  provider: ModelProviderSummary,
): LegacyModelProviderExecution {
  return toLegacyExecutionShape(provider);
}

export const getProjectModelProviders = async (
  service: ModelProviderService,
  projectId: string,
): Promise<Record<string, LegacyModelProviderExecution>> => {
  const providers = await service.getExecutionProviders({ projectId });
  return Object.fromEntries(
    Object.entries(providers).map(([provider, value]) => [
      provider,
      toLegacyExecutionProvider(value),
    ]),
  );
};

/**
 * Get model metadata for all models, formatted for frontend consumption
 */
export const getModelMetadataForFrontend = (): Record<string, ModelMetadataForFrontend> => {
  const allModels = getAllModels();

  return Object.fromEntries(
    Object.entries(allModels).map(([id, model]) => [
      id,
      {
        id: model.id,
        name: model.name,
        provider: model.provider,
        supportedParameters: model.supportedParameters,
        contextLength: model.contextLength,
        maxCompletionTokens: model.maxCompletionTokens,
        defaultParameters: model.defaultParameters,
        supportsImageInput: model.supportsImageInput,
        supportsAudioInput: model.supportsAudioInput,
        pricing: model.pricing,
        reasoningConfig: model.reasoningConfig,
        parameterConstraints: getParameterConstraints(model.id),
      },
    ]),
  );
};

/**
 * Merges custom model entries from providers into the model metadata record.
 * This allows consumers like LLMConfigPopover to look up custom model parameters
 * by their full model ID (e.g., "openai/my-model").
 */
export const mergeCustomModelMetadata = (
  existingMetadata: Record<string, ModelMetadataForFrontend>,
  providers: Record<string, LegacyModelProviderExecution>,
): Record<string, ModelMetadataForFrontend> => {
  const merged = { ...existingMetadata };

  for (const [providerKey, providerConfig] of Object.entries(providers)) {
    const allCustomModels = [
      ...(providerConfig.customModels ?? []),
      ...(providerConfig.customEmbeddingsModels ?? []),
    ];

    for (const entry of allCustomModels) {
      const fullId = `${providerKey}/${entry.modelId}`;
      merged[fullId] = {
        id: fullId,
        name: entry.displayName,
        provider: providerKey,
        supportedParameters: entry.supportedParameters ?? [],
        contextLength: 0,
        maxCompletionTokens: entry.maxTokens ?? null,
        defaultParameters: null,
        supportsImageInput: entry.multimodalInputs?.includes("image") ?? false,
        supportsAudioInput: entry.multimodalInputs?.includes("audio") ?? false,
        pricing: { inputCostPerToken: 0, outputCostPerToken: 0 },
        parameterConstraints: getParameterConstraints(fullId),
      };
    }
  }

  return merged;
};

// Frontend-only function that masks API keys for security and includes model metadata
export const getProjectModelProvidersForFrontend = async (
  service: ModelProviderService,
  projectId: string,
) => {
  const providers = await service.getForProject({ projectId });
  const maskedProviders = Object.fromEntries(
    Object.entries(providers).map(([provider, value]) => [
      provider,
      toLegacyProviderSummary(value),
    ]),
  );

  // Include model metadata for all models, merged with custom model entries
  const registryMetadata = getModelMetadataForFrontend();
  const modelMetadata = mergeCustomModelMetadata(registryMetadata, maskedProviders);

  return {
    providers: maskedProviders,
    modelMetadata,
  };
};

// List shape (one entry per row) for surfaces that need to render every
// stored credential — the Model Providers settings table can show two
// rows of the same provider when the user has e.g. "OpenAI — Org" and
// "OpenAI — Project override" side by side. The Record-by-provider-key
// `getProjectModelProvidersForFrontend` collapses those duplicates and
// is not safe to use here.
export const listOrgModelProvidersForFrontend = async (
  service: ModelProviderService,
  organizationId: string,
) => {
  const providers = (await service.listForOrganization({ organizationId })).map(
    toLegacyProviderSummary,
  );

  const registryMetadata = getModelMetadataForFrontend();
  const providersAsRecord = Object.fromEntries(
    providers.map((p) => [p.id ?? `system-${p.provider}`, p]),
  );
  const modelMetadata = mergeCustomModelMetadata(registryMetadata, providersAsRecord);

  return {
    providers,
    modelMetadata,
  };
};

export const listProjectModelProvidersForFrontend = async (
  service: ModelProviderService,
  projectId: string,
) => {
  const providers = (await service.listForProject({ projectId })).map(toLegacyProviderSummary);

  const registryMetadata = getModelMetadataForFrontend();
  const providersAsRecord = Object.fromEntries(providers.map((p) => [p.id ?? p.provider, p]));
  const modelMetadata = mergeCustomModelMetadata(registryMetadata, providersAsRecord);

  return {
    providers,
    modelMetadata,
  };
};

const getModelOrDefaultEnvKey = (modelProvider: LegacyModelProviderExecution, envKey: string) => {
  const storedValue = modelProvider.customKeys?.[envKey];
  return (
    // Allow env var to be set to empty string '' on purpose to fallback to process.env defined one
    (typeof storedValue === "string" ? storedValue : "") || process.env[envKey]
  );
};

const getProviderDefinition = (provider: string) =>
  Object.entries(modelProviders).find(([providerKey]) => providerKey === provider)?.[1];

export const prepareEnvKeys = (modelProvider: LegacyModelProviderExecution) => {
  const providerDefinition = getProviderDefinition(modelProvider.provider);
  if (!providerDefinition) {
    return {};
  }

  // TODO: add AZURE_DEPLOYMENT_NAME and AZURE_EMBEDDINGS_DEPLOYMENT_NAME for deployment name mapping

  return Object.fromEntries(
    Object.keys(getSchemaShape(providerDefinition.keysSchema))
      .map((key) => [key, getModelOrDefaultEnvKey(modelProvider, key)])
      .map(([key, value]) => {
        if (key === "CUSTOM_API_KEY") {
          return ["OPENAI_API_KEY", value];
        }
        if (key === "CUSTOM_BASE_URL") {
          return ["OPENAI_BASE_URL", value];
        }
        return [key, value];
      })
      .filter(([_key, value]) => !!value),
  );
};

/**
 * The managed-provider service is still accepted and still ignored: every
 * caller passes it, and the routing decision it used to feed moved into
 * `prepareExecution`. Typed `unknown` rather than reaching for the enterprise
 * contract, because nothing here reads it and naming the type would put an
 * enterprise dependency on this package for a parameter with no body.
 */
export const prepareLitellmParams = async (
  service: ModelProviderService,
  _managedProviders: unknown,
  {
    model,
    projectId,
  }: {
    model: string;
    modelProvider: LegacyModelProviderExecution;
    projectId: string;
  },
): Promise<Record<string, string>> => service.prepareExecution({ model, projectId });
