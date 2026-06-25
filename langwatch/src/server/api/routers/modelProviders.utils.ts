import { buildManagedBedrockLitellmParams } from "../../../../ee/managed-providers/managedBedrockConfig";
import { prisma } from "../../db";
import type {
  LLMModelEntry,
  ReasoningConfig,
} from "../../modelProviders/llmModels.types";
import { translateModelIdForLitellm } from "../../modelProviders/modelIdBoundary";
import { ModelProviderService } from "../../modelProviders/modelProvider.service";
import {
  getAllModels,
  getParameterConstraints,
  type MaybeStoredModelProvider,
  modelProviders,
  type ParameterConstraints,
} from "../../modelProviders/registry";
import { parseWireValue } from "../../modelProviders/wireFormat";

/**
 * Normalises either wire format ("mp_abc/gpt-5" or "openai/gpt-5") into
 * the legacy provider-prefixed form LiteLLM expects. We always use the
 * resolved ModelProvider's provider string rather than trusting the
 * prefix in the wire value — the two never disagree for resolved rows,
 * and this keeps LiteLLM routing stable when new mp-id values arrive.
 */
function toLitellmModelId(wireValue: string, provider: string): string {
  const parsed = parseWireValue(wireValue);
  if (parsed.kind === "mp-id" || parsed.kind === "legacy") {
    return `${provider}/${parsed.model}`;
  }
  // Unknown shapes — no slash — were treated as provider-less in the
  // original code and just passed to LiteLLM verbatim.
  return wireValue;
}

/**
 * Simplified model metadata for frontend consumption
 */
export type ModelMetadataForFrontend = {
  id: string;
  name: string;
  provider: string;
  supportedParameters: string[];
  contextLength: number;
  maxCompletionTokens: number | null;
  defaultParameters: Record<string, unknown> | null;
  supportsImageInput: boolean;
  supportsAudioInput: boolean;
  pricing: LLMModelEntry["pricing"];
  /** Reasoning/thinking configuration for reasoning models */
  reasoningConfig?: ReasoningConfig;
  /** Provider-level parameter constraints (e.g., temperature max for Anthropic) */
  parameterConstraints?: ParameterConstraints;
};

export const getProjectModelProviders = async (
  projectId: string,
  includeKeys = true,
) => {
  const service = ModelProviderService.create(prisma);
  return await service.getProjectModelProviders(projectId, includeKeys);
};

/**
 * Get model metadata for all models, formatted for frontend consumption
 */
export const getModelMetadataForFrontend = (): Record<
  string,
  ModelMetadataForFrontend
> => {
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
  providers: Record<string, MaybeStoredModelProvider>,
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
  projectId: string,
  includeKeys = true,
) => {
  const service = ModelProviderService.create(prisma);
  const maskedProviders = await service.getProjectModelProvidersForFrontend(
    projectId,
    includeKeys,
  );

  // Include model metadata for all models, merged with custom model entries
  const registryMetadata = getModelMetadataForFrontend();
  const modelMetadata = mergeCustomModelMetadata(
    registryMetadata,
    maskedProviders,
  );

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
  organizationId: string,
) => {
  const service = ModelProviderService.create(prisma);
  const providers =
    await service.listOrgModelProvidersForFrontend(organizationId);

  const registryMetadata = getModelMetadataForFrontend();
  const providersAsRecord = Object.fromEntries(
    providers.map((p) => [p.id ?? `system-${p.provider}`, p]),
  );
  const modelMetadata = mergeCustomModelMetadata(
    registryMetadata,
    providersAsRecord,
  );

  return {
    providers,
    modelMetadata,
  };
};

export const listProjectModelProvidersForFrontend = async (
  projectId: string,
) => {
  const service = ModelProviderService.create(prisma);
  const providers = await service.listProjectModelProvidersForFrontend(
    projectId,
  );

  const registryMetadata = getModelMetadataForFrontend();
  const providersAsRecord = Object.fromEntries(
    providers.map((p) => [p.id ?? p.provider, p]),
  );
  const modelMetadata = mergeCustomModelMetadata(
    registryMetadata,
    providersAsRecord,
  );

  return {
    providers,
    modelMetadata,
  };
};

const getModelOrDefaultEnvKey = (
  modelProvider: MaybeStoredModelProvider,
  envKey: string,
) => {
  return (
    // Allow env var to be set to empty string '' on purpose to fallback to process.env defined one
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    (modelProvider.customKeys as Record<string, string>)?.[envKey] ||
    process.env[envKey]
  );
};

const getModelOrDefaultApiKey = (modelProvider: MaybeStoredModelProvider) => {
  const providerDefinition =
    modelProviders[modelProvider.provider as keyof typeof modelProviders];
  if (!providerDefinition) {
    return undefined;
  }
  return getModelOrDefaultEnvKey(modelProvider, providerDefinition.apiKey);
};

const getModelOrDefaultEndpointKey = (
  modelProvider: MaybeStoredModelProvider,
) => {
  const providerDefinition =
    modelProviders[modelProvider.provider as keyof typeof modelProviders];
  if (!providerDefinition) {
    return undefined;
  }
  return (
    providerDefinition.endpointKey &&
    getModelOrDefaultEnvKey(modelProvider, providerDefinition.endpointKey)
  );
};

export const prepareEnvKeys = (modelProvider: MaybeStoredModelProvider) => {
  const providerDefinition =
    modelProviders[modelProvider.provider as keyof typeof modelProviders];
  if (!providerDefinition) {
    return {};
  }

  // TODO: add AZURE_DEPLOYMENT_NAME and AZURE_EMBEDDINGS_DEPLOYMENT_NAME for deployment name mapping

  const getSchemaShape = (schema: any) => {
    if ("innerType" in schema) {
      return schema.innerType().shape;
    }
    if ("shape" in schema) {
      return schema.shape;
    }
    return {};
  };

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
 * Modern Azure OpenAI api-version used for direct (non-gateway) calls.
 * Without an explicit version the downstream gateway (Bifrost) falls back
 * to a stale GA default (2024-10-21) that returns "Resource not found" for
 * newer (gpt-5-class) Azure deployments — even when the deployment name is
 * correct. Overridable per provider via the AZURE_OPENAI_API_VERSION key.
 */
export const DEFAULT_AZURE_API_VERSION = "2025-04-01-preview";

export const prepareLitellmParams = async ({
  model,
  modelProvider,
  projectId,
}: {
  model: string;
  modelProvider: MaybeStoredModelProvider;
  projectId: string;
}) => {
  const params: Record<string, string> = {};

  // Normalise the incoming wire value for LiteLLM. After iter 109 two
  // formats coexist: the canonical `{mpId}/{model}` and the legacy
  // `{provider}/{model}`. LiteLLM only understands the latter; translate
  // the model portion into a canonical provider-prefixed form using the
  // resolved ModelProvider so downstream routing keeps working.
  const litellmModelInput = toLitellmModelId(model, modelProvider.provider);
  // Translate model ID for LiteLLM (e.g., "anthropic/claude-opus-4.5" -> "anthropic/claude-opus-4-5")
  // Custom models use OpenAI-compatible API format, so we replace the prefix.
  // LiteLLM routes "openai/" prefixed models through its OpenAI-compatible handler.
  params.model = translateModelIdForLitellm(litellmModelInput).replace(
    "custom/",
    "openai/",
  );

  const apiKey = getModelOrDefaultApiKey(modelProvider);
  if (apiKey && modelProvider.provider !== "vertex_ai") {
    params.api_key = apiKey;
  }
  const endpoint = getModelOrDefaultEndpointKey(modelProvider);
  if (endpoint) {
    // Strip trailing /v1 for Anthropic - LiteLLM adds it internally
    if (modelProvider.provider === "anthropic") {
      params.api_base = endpoint.replace(/\/v1\/?$/, "");
    } else {
      params.api_base = endpoint;
    }
  }

  if (modelProvider.provider === "vertex_ai") {
    params.vertex_credentials = apiKey ?? "invalid";
    params.vertex_project =
      getModelOrDefaultEnvKey(modelProvider, "VERTEXAI_PROJECT") ?? "invalid";
    params.vertex_location =
      getModelOrDefaultEnvKey(modelProvider, "VERTEXAI_LOCATION") ?? "invalid";
  }

  if (modelProvider.provider === "bedrock") {
    delete params.api_key;
    params.aws_access_key_id =
      getModelOrDefaultEnvKey(modelProvider, "AWS_ACCESS_KEY_ID") ?? "invalid";
    params.aws_secret_access_key =
      getModelOrDefaultEnvKey(modelProvider, "AWS_SECRET_ACCESS_KEY") ??
      "invalid";
    params.aws_region_name =
      getModelOrDefaultEnvKey(modelProvider, "AWS_REGION_NAME") ?? "invalid";
  }

  // Azure: resolve api-version and deployment so the downstream gateway
  // (Bifrost) targets the right Azure surface.
  if (modelProvider.provider === "azure") {
    const gatewayBaseUrl = getModelOrDefaultEnvKey(
      modelProvider,
      "AZURE_API_GATEWAY_BASE_URL",
    );

    if (gatewayBaseUrl) {
      // API Gateway mode: route through the customer's gateway endpoint with
      // its own pinned api-version (the gateway/APIM owns version policy).
      params.api_base = gatewayBaseUrl;
      params.use_azure_gateway = "true";
      params.api_version =
        getModelOrDefaultEnvKey(modelProvider, "AZURE_API_GATEWAY_VERSION") ??
        "2024-05-01-preview";
    } else {
      // Direct mode: pin a modern api-version (see DEFAULT_AZURE_API_VERSION).
      params.api_version =
        getModelOrDefaultEnvKey(modelProvider, "AZURE_OPENAI_API_VERSION") ??
        DEFAULT_AZURE_API_VERSION;
    }

    // Map the model id to its Azure deployment name when the provider defines
    // an explicit deploymentMapping (the deployment name need not equal the
    // model id). The gateway/control-plane path already honours this field
    // (config.materialiser); mirror it here so the in-process Studio /
    // playground path agrees instead of assuming model id == deployment name.
    const deploymentMap = modelProvider.deploymentMapping as Record<
      string,
      string
    > | null;
    if (deploymentMap) {
      const bareModel = params.model.split("/").slice(1).join("/");
      const deployment = deploymentMap[bareModel] ?? deploymentMap[model];
      if (deployment) {
        params.deployment = deployment;
      }
    }

    // Pass through all extra headers
    if (modelProvider.extraHeaders) {
      const extraHeaders = modelProvider.extraHeaders as {
        key: string;
        value: string;
      }[];
      params.extra_headers = JSON.stringify(
        Object.fromEntries(extraHeaders.map(({ key, value }) => [key, value])),
      );
    }
  }

  return await buildManagedBedrockLitellmParams({
    params,
    projectId,
    model,
    modelProvider,
  });
};
