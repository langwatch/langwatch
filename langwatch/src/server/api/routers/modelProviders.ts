import { z } from "zod";
import { dependencies } from "../../../injection/dependencies.server";
import { KEY_CHECK, MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import { prisma } from "../../db";
import type { CustomModelEntry } from "../../modelProviders/customModel.schema";
import {
  customModelUpdateInputSchema,
  toLegacyCompatibleCustomModels,
} from "../../modelProviders/customModel.schema";
import type {
  LLMModelEntry,
  ReasoningConfig,
} from "../../modelProviders/llmModels.types";
import { translateModelIdForLitellm } from "../../modelProviders/modelIdBoundary";
import { ModelProviderService } from "../../modelProviders/modelProvider.service";
import {
  getAllModels,
  getParameterConstraints,
  getProviderModelOptions,
  type MaybeStoredModelProvider,
  modelProviders,
  type ParameterConstraints,
} from "../../modelProviders/registry";
import { checkProjectPermission, hasProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  validateKeyWithCustomUrl,
  validateProviderApiKey,
} from "./providerValidation";

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

export const modelProviderRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;

      const hasSetupPermission = await hasProjectPermission(
        ctx,
        projectId,
        "project:update",
      );

      return await getProjectModelProviders(projectId, hasSetupPermission);
    }),
  getAllForProjectForFrontend: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const hasSetupPermission = await hasProjectPermission(
        ctx,
        projectId,
        "project:update",
      );
      return await getProjectModelProvidersForFrontend(
        projectId,
        hasSetupPermission,
      );
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        projectId: z.string(),
        provider: z.string(),
        enabled: z.boolean(),
        customKeys: z.object({}).passthrough().optional().nullable(),
        customModels: customModelUpdateInputSchema.optional().nullable(),
        customEmbeddingsModels: customModelUpdateInputSchema.optional().nullable(),
        extraHeaders: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .optional()
          .nullable(),
        defaultModel: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input, ctx }) => {
      const service = ModelProviderService.create(ctx.prisma);
      return await service.updateModelProvider({
        id: input.id,
        projectId: input.projectId,
        provider: input.provider,
        enabled: input.enabled,
        customKeys: input.customKeys as
          | Record<string, unknown>
          | null
          | undefined,
        customModels: input.customModels,
        customEmbeddingsModels: input.customEmbeddingsModels,
        extraHeaders: input.extraHeaders,
        defaultModel: input.defaultModel,
      });
    }),

  delete: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        projectId: z.string(),
        provider: z.string(),
      }),
    )
    .use(checkProjectPermission("project:delete"))
    .mutation(async ({ input, ctx }) => {
      const { id, projectId, provider } = input;
      if (id) {
        return await ctx.prisma.modelProvider.delete({
          where: { id, projectId },
        });
      } else {
        return await ctx.prisma.modelProvider.deleteMany({
          where: { provider, projectId },
        });
      }
    }),

  /**
   * Validates an API key for a given model provider.
   * This is a read-only query that tests if the provided API key works
   */
  validateApiKey: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        provider: z.string(),
        customKeys: z.record(z.string()),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .query(async ({ input }) => {
      const { provider, customKeys } = input;
      return validateProviderApiKey(provider, customKeys);
    }),

  /**
   * Validates a stored or env var API key against a custom or default base URL.
   * Gets API key from DB or env var and validates against the provided URL (or default if not provided).
   */
  validateKeyWithCustomUrl: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        provider: z.string(),
        customBaseUrl: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .query(async ({ input, ctx }) => {
      const { projectId, provider, customBaseUrl } = input;
      return validateKeyWithCustomUrl(
        projectId,
        provider,
        customBaseUrl,
        ctx.prisma,
      );
    }),
});

export const getProjectModelProviders = async (
  projectId: string,
  includeKeys = true,
) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  const defaultModelProviders: Record<string, MaybeStoredModelProvider> =
    Object.fromEntries(
      Object.entries(modelProviders)
        .filter(([_providerKey, modelProvider]) => {
          return modelProvider.enabledSince;
        })
        .map(([providerKey, modelProvider]) => {
          const enabled =
            modelProvider.enabledSince < project.createdAt &&
            !!process.env[modelProvider.apiKey] &&
            (providerKey !== "vertex_ai" || !!process.env.VERTEXAI_PROJECT);

          const modelProvider_: MaybeStoredModelProvider = {
            provider: providerKey,
            enabled,
            disabledByDefault: !enabled,
            customKeys: null,
            models: getProviderModelOptions(providerKey, "chat").map(
              (m) => m.value,
            ),
            embeddingsModels: getProviderModelOptions(
              providerKey,
              "embedding",
            ).map((m) => m.value),
            deploymentMapping: null,
            extraHeaders: [],
          };
          return [providerKey, modelProvider_];
        }),
    );

  const savedModelProviders = (
    await prisma.modelProvider.findMany({
      where: { projectId },
    })
  )
    .filter((modelProvider) => {
      // Keep if has custom keys
      if (modelProvider.customKeys) return true;

      // Keep if enabled status differs from default
      const defaultProvider = defaultModelProviders[modelProvider.provider];
      if (modelProvider.enabled !== defaultProvider?.enabled) return true;

      // Keep if has custom models or embeddings (works for both string[] and object[])
      const customModels = modelProvider.customModels as unknown[] | null;
      const customEmbeddings = modelProvider.customEmbeddingsModels as
        | unknown[]
        | null;
      const hasCustomModels = customModels && customModels.length > 0;
      const hasCustomEmbeddings =
        customEmbeddings && customEmbeddings.length > 0;

      return hasCustomModels || hasCustomEmbeddings;
    })
    .reduce(
      (acc, modelProvider) => {
        // Always use registry models for models/embeddingsModels
        const defaultProvider =
          defaultModelProviders[modelProvider.provider];

        // Convert DB custom models (may be legacy string[] or new object[])
        const customModels = toLegacyCompatibleCustomModels(
          modelProvider.customModels,
          "chat",
        );
        const customEmbeddingsModels = toLegacyCompatibleCustomModels(
          modelProvider.customEmbeddingsModels,
          "embedding",
        );

        const modelProvider_: MaybeStoredModelProvider = {
          id: modelProvider.id,
          provider: modelProvider.provider,
          enabled: modelProvider.enabled,
          customKeys: modelProvider.customKeys,
          models: defaultProvider?.models ?? null,
          embeddingsModels: defaultProvider?.embeddingsModels ?? null,
          customModels:
            customModels.length > 0 ? customModels : null,
          customEmbeddingsModels:
            customEmbeddingsModels.length > 0
              ? customEmbeddingsModels
              : null,
          deploymentMapping: modelProvider.deploymentMapping,
          disabledByDefault: defaultProvider?.disabledByDefault,
          extraHeaders: modelProvider.extraHeaders as
            | { key: string; value: string }[]
            | null,
        };

        if (!includeKeys) {
          modelProvider_.customKeys = null;
        }

        return {
          ...acc,
          [modelProvider.provider]: modelProvider_,
        };
      },
      {} as Record<string, MaybeStoredModelProvider>,
    );

  return {
    ...defaultModelProviders,
    ...savedModelProviders,
  };
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
  const modelProvidersData = await getProjectModelProviders(
    projectId,
    includeKeys,
  );

  // Mask only API keys, keep URLs visible
  const maskedProviders = { ...modelProvidersData };
  if (includeKeys) {
    for (const [provider, config] of Object.entries(maskedProviders)) {
      if (config.customKeys) {
        maskedProviders[provider] = {
          ...config,
          customKeys: Object.fromEntries(
            Object.entries(config.customKeys).map(([key, value]) => [
              key,
              // Only mask values that look like API keys (contain "_KEY" pattern)
              KEY_CHECK.some((k) => key.includes(k))
                ? MASKED_KEY_PLACEHOLDER
                : value,
            ]),
          ),
        };
      }
    }
  }

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

  // Translate model ID for LiteLLM (e.g., "anthropic/claude-opus-4.5" -> "anthropic/claude-opus-4-5")
  // Custom models use OpenAI-compatible API format, so we replace the prefix.
  // LiteLLM routes "openai/" prefixed models through its OpenAI-compatible handler.
  params.model = translateModelIdForLitellm(model).replace(
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

  // Handle Azure API Gateway configuration
  if (modelProvider.provider === "azure") {
    const gatewayBaseUrl = getModelOrDefaultEnvKey(
      modelProvider,
      "AZURE_API_GATEWAY_BASE_URL",
    );
    const gatewayVersion =
      getModelOrDefaultEnvKey(modelProvider, "AZURE_API_GATEWAY_VERSION") ??
      "2024-05-01-preview";

    // If API Gateway is configured, route through the gateway endpoint
    if (gatewayBaseUrl) {
      params.api_base = gatewayBaseUrl;
      params.use_azure_gateway = "true";
      params.api_version = gatewayVersion;
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

  if (dependencies.managedModelProviderLitellmParams) {
    return await dependencies.managedModelProviderLitellmParams({
      params,
      projectId,
      model,
      modelProvider,
    });
  }

  // TODO: add azure deployment as params.model as azure/<deployment-name>

  return params;
};
