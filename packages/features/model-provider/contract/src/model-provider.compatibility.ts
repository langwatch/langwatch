import { z } from "zod";
import { modelCatalogEntrySchema, getAllModels } from "./catalog/model-catalog";
import { customModelEntrySchema, type CustomModelEntry } from "./custom-model";
import {
  getParameterConstraints,
  parameterConstraintsSchema,
} from "./model-provider-registry";
import {
  modelProviderScopeSchema,
  type Model,
  type ModelProviderSummary,
} from "./model-provider";

const extraHeaderSchema = z.object({ key: z.string(), value: z.string() }).strict();

export const legacyModelProviderSchema = z
  .object({
    id: z.string().optional(),
    organizationId: z.string().nullable().optional(),
    provider: z.string(),
    name: z.string().optional(),
    routingHandle: z.string().nullable().optional(),
    enabled: z.boolean(),
    defaultModel: z.string().optional(),
    customKeys: z.record(z.string(), z.unknown()).nullable().optional(),
    extraHeaders: z.array(extraHeaderSchema).nullable().optional(),
    customModels: z.array(customModelEntrySchema).nullable().optional(),
    customEmbeddingsModels: z.array(customModelEntrySchema).nullable().optional(),
    deploymentMapping: z.record(z.string(), z.string()).nullable().optional(),
    rateLimitRpm: z.number().int().nonnegative().nullable().optional(),
    rateLimitTpm: z.number().int().nonnegative().nullable().optional(),
    rateLimitRpd: z.number().int().nonnegative().nullable().optional(),
    rotationPolicy: z.literal("MANUAL").optional(),
    providerConfig: z.unknown().optional(),
    fallbackPriorityGlobal: z.number().int().nullable().optional(),
    healthStatus: z.enum(["UNKNOWN", "HEALTHY", "DEGRADED", "CIRCUIT_OPEN"]).nullable().optional(),
    circuitOpenedAt: z.date().nullable().optional(),
    lastHealthCheckAt: z.date().nullable().optional(),
    disabledAt: z.date().nullable().optional(),
    models: z.array(z.string()).nullable().optional(),
    embeddingsModels: z.array(z.string()).nullable().optional(),
    disabledByDefault: z.boolean().optional(),
    isSystem: z.boolean().optional(),
    embeddingsUnsupported: z.boolean().optional(),
    scopes: z.array(modelProviderScopeSchema).optional(),
    scopeType: modelProviderScopeSchema.shape.scopeType.optional(),
    scopeId: z.string().optional(),
    createdAt: z.date().optional(),
    updatedAt: z.date().optional(),
  })
  .strict();
export type LegacyModelProvider = z.infer<typeof legacyModelProviderSchema>;

export const modelMetadataForFrontendSchema = modelCatalogEntrySchema
  .pick({
    id: true,
    name: true,
    provider: true,
    supportedParameters: true,
    contextLength: true,
    maxCompletionTokens: true,
    defaultParameters: true,
    supportsImageInput: true,
    supportsAudioInput: true,
    pricing: true,
    reasoningConfig: true,
  })
  .extend({ parameterConstraints: parameterConstraintsSchema.optional() })
  .strict();
export type ModelMetadataForFrontend = z.infer<typeof modelMetadataForFrontendSchema>;

export const legacyModelProviderMapSchema = z.record(
  z.string(),
  legacyModelProviderSchema,
);
export const modelMetadataForFrontendMapSchema = z.record(
  z.string(),
  modelMetadataForFrontendSchema,
);
export const legacyModelProviderMapResponseSchema = z
  .object({
    providers: legacyModelProviderMapSchema,
    modelMetadata: modelMetadataForFrontendMapSchema,
  })
  .strict();
export const legacyModelProviderListResponseSchema = z
  .object({
    providers: z.array(legacyModelProviderSchema),
    modelMetadata: modelMetadataForFrontendMapSchema,
  })
  .strict();

function scopeRank(scopeType: LegacyModelProvider["scopeType"]): number {
  if (scopeType === "PROJECT") return 3;
  if (scopeType === "TEAM") return 2;
  return 1;
}

function narrowestScope(scopes: ModelProviderSummary["scopes"]): {
  scopeType?: LegacyModelProvider["scopeType"];
  scopeId?: string;
} {
  const ordered = [...scopes].sort(
    (left, right) => scopeRank(right.scopeType) - scopeRank(left.scopeType),
  );
  const scope = ordered[0];
  return scope ? { scopeType: scope.scopeType, scopeId: scope.scopeId } : {};
}

function toLegacyCustomModel(
  model: Model,
  mode: CustomModelEntry["mode"],
): CustomModelEntry {
  return customModelEntrySchema.parse({
    modelId: model.id,
    displayName: model.label,
    mode,
    ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
    ...(model.supportedParameters === undefined
      ? {}
      : { supportedParameters: model.supportedParameters }),
    ...(model.multimodalInputs === undefined
      ? {}
      : { multimodalInputs: model.multimodalInputs }),
  });
}

/** Lossless compatibility mapper for existing Model Provider transports. */
export function toLegacyModelProvider(
  provider: ModelProviderSummary,
): LegacyModelProvider {
  const scopes = provider.scopes.map(({ scopeType, scopeId }) => ({
    scopeType,
    scopeId,
  }));

  return legacyModelProviderSchema.parse({
    id: provider.id,
    organizationId: provider.organizationId,
    provider: provider.provider,
    name: provider.name,
    routingHandle: provider.routingHandle,
    enabled: provider.enabled,
    defaultModel: provider.defaultModel,
    customKeys: provider.customKeys,
    extraHeaders: provider.extraHeaders,
    customModels: provider.customModels.map((model) =>
      toLegacyCustomModel(model, "chat"),
    ),
    customEmbeddingsModels: provider.customEmbeddingsModels.map((model) =>
      toLegacyCustomModel(model, "embedding"),
    ),
    deploymentMapping: provider.deploymentMapping ?? null,
    rateLimitRpm: provider.rateLimitRpm,
    rateLimitTpm: provider.rateLimitTpm,
    rateLimitRpd: provider.rateLimitRpd,
    rotationPolicy: provider.rotationPolicy,
    providerConfig: provider.providerConfig,
    fallbackPriorityGlobal: provider.fallbackPriorityGlobal,
    healthStatus: provider.healthStatus,
    circuitOpenedAt: provider.circuitOpenedAt,
    lastHealthCheckAt: provider.lastHealthCheckAt,
    disabledAt: provider.disabledAt,
    models: provider.models ?? null,
    embeddingsModels: provider.embeddingsModels ?? null,
    disabledByDefault: provider.disabledByDefault,
    isSystem: provider.isSystem,
    embeddingsUnsupported: provider.embeddingsUnsupported,
    scopes,
    ...narrowestScope(scopes),
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  });
}

export function toLegacyModelProviderMap(
  providers: Record<string, ModelProviderSummary>,
): Record<string, LegacyModelProvider> {
  return Object.fromEntries(
    Object.entries(providers).map(([key, provider]) => [
      key,
      toLegacyModelProvider(provider),
    ]),
  );
}

export function toLegacyModelProviderMapResponse(
  providers: Record<string, ModelProviderSummary>,
): z.infer<typeof legacyModelProviderMapResponseSchema> {
  const legacyProviders = toLegacyModelProviderMap(providers);
  const modelMetadata = mergeCustomModelMetadata(
    getModelMetadataForFrontend(),
    legacyProviders,
  );

  return legacyModelProviderMapResponseSchema.parse({
    providers: legacyProviders,
    modelMetadata,
  });
}

export function toLegacyModelProviderListResponse(
  providers: ModelProviderSummary[],
): z.infer<typeof legacyModelProviderListResponseSchema> {
  const legacyProviders = providers.map(toLegacyModelProvider);
  const providersById = Object.fromEntries(
    legacyProviders.map((provider) => [
      provider.id ?? `system-${provider.provider}`,
      provider,
    ]),
  );
  const modelMetadata = mergeCustomModelMetadata(
    getModelMetadataForFrontend(),
    providersById,
  );

  return legacyModelProviderListResponseSchema.parse({
    providers: legacyProviders,
    modelMetadata,
  });
}

export function getModelMetadataForFrontend(): Record<string, ModelMetadataForFrontend> {
  return Object.fromEntries(
    Object.entries(getAllModels()).map(([id, model]) => [
      id,
      modelMetadataForFrontendSchema.parse({
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
      }),
    ]),
  );
}

export function mergeCustomModelMetadata(
  existing: Record<string, ModelMetadataForFrontend>,
  providers: Record<string, LegacyModelProvider>,
): Record<string, ModelMetadataForFrontend> {
  const merged = { ...existing };

  for (const [providerKey, provider] of Object.entries(providers)) {
    const customModels = [
      ...(provider.customModels ?? []),
      ...(provider.customEmbeddingsModels ?? []),
    ];

    for (const model of customModels) {
      const id = `${providerKey}/${model.modelId}`;
      merged[id] = modelMetadataForFrontendSchema.parse({
        id,
        name: model.displayName,
        provider: providerKey,
        supportedParameters: model.supportedParameters ?? [],
        contextLength: 0,
        maxCompletionTokens: model.maxTokens ?? null,
        defaultParameters: null,
        supportsImageInput: model.multimodalInputs?.includes("image") ?? false,
        supportsAudioInput: model.multimodalInputs?.includes("audio") ?? false,
        pricing: { inputCostPerToken: 0, outputCostPerToken: 0 },
        parameterConstraints: getParameterConstraints(id),
      });
    }
  }

  return merged;
}
