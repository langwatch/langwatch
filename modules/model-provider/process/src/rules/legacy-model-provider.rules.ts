/**
 * The legacy Model Provider shapes the execution paths still speak.
 */
import {
  customModelEntrySchema,
  type CustomModelEntry,
  getSchemaShape,
  modelProviders,
  type Model,
  type ModelProviderExecution,
  type ModelProviderApi,
  type ModelProviderSummary,
} from "@langwatch/model-provider-contract";

type LegacyModelProviderScope = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

/**
 * The legacy custom-model entry IS the canonical one: every value here is
 * produced by `customModelEntrySchema.parse`, so restating it with a wider
 * `supportedParameters: string[]` only broke callers that read it back.
 */
type LegacyCustomModel = CustomModelEntry;

/**
 * The legacy execution shape used by LiteLLM and the workflow DSL. It is deliberately
 * assembled from the canonical server-only execution DTO at the app boundary: contract
 * callers never receive the app's registry type or Prisma row shape.
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
  extraHeaders: { key: string; value: string }[];
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  rateLimitRpd: number | null;
  fallbackPriorityGlobal: number | null;
  providerConfig: Record<string, unknown> | null;
  deploymentMapping?: Record<string, string> | null;
  createdAt: ModelProviderExecution["createdAt"];
  updatedAt: ModelProviderExecution["updatedAt"];
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
  const scope = [...scopes].toSorted(
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

export const getProjectModelProviders = async (
  service: Pick<ModelProviderApi, "getExecutionProviders">,
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

const getModelOrDefaultEnvKey = ({
  modelProvider,
  environment,
  envKey,
}: {
  modelProvider: LegacyModelProviderExecution;
  environment: Record<string, string | undefined>;
  envKey: string;
}) => {
  const storedValue = modelProvider.customKeys?.[envKey];
  return (
    // Allow a key to be stored as the empty string on purpose, to fall back to
    // the one the composing process was configured with.
    (typeof storedValue === "string" ? storedValue : "") || environment[envKey]
  );
};

const getProviderDefinition = (provider: string) =>
  Object.entries(modelProviders).find(([providerKey]) => providerKey === provider)?.[1];

/**
 * `environment` is the composing process's own configuration, the fallback for
 * every key this provider did not store one for.
 */
export const prepareEnvKeys = ({
  modelProvider,
  environment,
}: {
  modelProvider: LegacyModelProviderExecution;
  environment: Record<string, string | undefined>;
}): Record<string, string> => {
  const providerDefinition = getProviderDefinition(modelProvider.provider);
  if (!providerDefinition) {
    return {};
  }

  // TODO: add AZURE_DEPLOYMENT_NAME and AZURE_EMBEDDINGS_DEPLOYMENT_NAME for
  // deployment name mapping

  return Object.fromEntries(
    Object.keys(getSchemaShape(providerDefinition.keysSchema))
      .map((key) => [key, getModelOrDefaultEnvKey({ modelProvider, environment, envKey: key })])
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
 * `_managedProviders` is still accepted but unused; the routing decision it fed moved into
 * `prepareExecution`. Typed `unknown` to avoid an enterprise dependency for a parameter with no
 * body.
 */
export const prepareLitellmParams = async (
  service: Pick<ModelProviderApi, "prepareExecution">,
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
