import { z } from "zod";
import { dependencies } from "../../../injection/dependencies.server";
import {
  KEY_CHECK,
  MASKED_KEY_PLACEHOLDER,
  OPENAI_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_BASE_URL,
  XAI_DEFAULT_BASE_URL,
  CEREBRAS_DEFAULT_BASE_URL,
  GROQ_DEFAULT_BASE_URL,
  GEMINI_DEFAULT_BASE_URL,
} from "../../../utils/constants";
import { prisma } from "../../db";
import {
  getProviderModelOptions,
  type MaybeStoredModelProvider,
  modelProviders,
} from "../../modelProviders/registry";
import {
  checkProjectPermission,
  hasProjectPermission,
  skipPermissionCheck,
} from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";


/** Validation result returned by all validation functions */
type ValidationResult = { valid: boolean; error?: string };

/**
 * Authentication strategy for API key validation.
 * - `bearer`: Uses `Authorization: Bearer {key}` header (OpenAI-compatible)
 * - `anthropic`: Uses `x-api-key` header with `anthropic-version`
 * - `gemini`: Uses query parameter `?key=`
 * - `skip`: Provider requires complex auth (e.g., AWS, gcloud), skip validation
 */
type AuthStrategy = "bearer" | "anthropic" | "gemini" | "skip";

/**
 * Configuration for validating a model provider's API key.
 * Uses the modelProviders registry for apiKey and endpointKey field names.
 */
interface ProviderValidationConfig {
  /** Authentication strategy to use */
  authStrategy: AuthStrategy;
  /** Default base URL for the provider's API */
  defaultBaseUrl: string;
}

/**
 * Registry mapping provider keys to their validation configuration.
 * Providers not in this registry will skip validation.
 *
 * @remarks
 * - Uses `modelProviders` registry for `apiKey` and `endpointKey` field names
 * - Bedrock, Vertex AI, and Azure are excluded (complex auth requirements)
 */
const PROVIDER_VALIDATION_CONFIG: Record<string, ProviderValidationConfig> = {
  openai: { authStrategy: "bearer", defaultBaseUrl: OPENAI_DEFAULT_BASE_URL },
  anthropic: {
    authStrategy: "anthropic",
    defaultBaseUrl: ANTHROPIC_DEFAULT_BASE_URL,
  },
  gemini: { authStrategy: "gemini", defaultBaseUrl: GEMINI_DEFAULT_BASE_URL },
  deepseek: { authStrategy: "bearer", defaultBaseUrl: DEEPSEEK_DEFAULT_BASE_URL },
  xai: { authStrategy: "bearer", defaultBaseUrl: XAI_DEFAULT_BASE_URL },
  cerebras: { authStrategy: "bearer", defaultBaseUrl: CEREBRAS_DEFAULT_BASE_URL },
  groq: { authStrategy: "bearer", defaultBaseUrl: GROQ_DEFAULT_BASE_URL },
  custom: { authStrategy: "bearer", defaultBaseUrl: "" },
  // Providers with complex auth - explicitly skip validation
  bedrock: { authStrategy: "skip", defaultBaseUrl: "" },
  vertex_ai: { authStrategy: "skip", defaultBaseUrl: "" },
  azure: { authStrategy: "skip", defaultBaseUrl: "" },
};

// ============================================================================
// API KEY VALIDATION HELPERS
// ============================================================================

/**
 * Builds the models endpoint URL by normalizing and appending /models if needed.
 *
 * @param baseUrl - The user-provided base URL (may be empty)
 * @param defaultBaseUrl - The default base URL for the provider
 * @returns The full URL to the models endpoint
 */
function buildModelsEndpointUrl(
  baseUrl: string,
  defaultBaseUrl: string,
): string {
  const endpoint = baseUrl || defaultBaseUrl;
  const normalized = endpoint.replace(/\/$/, "");

  return normalized.endsWith("/models")
    ? normalized
    : `${normalized}/models`;
}

/**
 * Handles HTTP response errors and returns appropriate error messages.
 *
 * @param response - The fetch Response object
 * @returns ValidationResult with error message
 */
function handleHttpError(response: Response): ValidationResult {
  if (response.status === 401 || response.status === 403) {
    return {
      valid: false,
      error: "Invalid API key. Please check your API key and try again.",
    };
  }
  return {
    valid: false,
    error: `API validation failed (${response.status}). Please check your credentials.`,
  };
}

/**
 * Validates using Bearer token authentication (OpenAI-compatible).
 *
 * @param apiKey - The API key to validate
 * @param baseUrl - The user-provided base URL
 * @param defaultBaseUrl - The default base URL for the provider
 * @returns Promise resolving to validation result
 */
async function validateWithBearerToken(
  apiKey: string,
  baseUrl: string,
  defaultBaseUrl: string,
): Promise<ValidationResult> {
  const url = buildModelsEndpointUrl(baseUrl, defaultBaseUrl);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return handleHttpError(response);
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      error:
        "Failed to validate API key. Please check your network connection and base URL.",
    };
  }
}

/**
 * Validates using Anthropic's x-api-key header authentication.
 *
 * @param apiKey - The API key to validate
 * @param defaultBaseUrl - The default base URL for Anthropic
 * @returns Promise resolving to validation result
 */
async function validateWithAnthropicAuth(
  apiKey: string,
  defaultBaseUrl: string,
): Promise<ValidationResult> {
  const url = buildModelsEndpointUrl("", defaultBaseUrl);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return handleHttpError(response);
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      error:
        "Failed to validate API key. Please check your network connection.",
    };
  }
}

/**
 * Validates using Gemini's query parameter authentication.
 *
 * @param apiKey - The API key to validate
 * @param defaultBaseUrl - The default base URL for Gemini
 * @returns Promise resolving to validation result
 */
async function validateWithGeminiAuth(
  apiKey: string,
  defaultBaseUrl: string,
): Promise<ValidationResult> {
  const url = `${defaultBaseUrl}/models?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      // Gemini returns 400 for invalid keys
      if (response.status === 400 || response.status === 403) {
        return {
          valid: false,
          error: "Invalid API key. Please check your API key and try again.",
        };
      }
      return handleHttpError(response);
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      error:
        "Failed to validate API key. Please check your network connection.",
    };
  }
}

/**
 * Validates an API key for a given model provider.
 *
 * Uses the `modelProviders` registry to dynamically get API key and endpoint
 * field names, and the `PROVIDER_VALIDATION_CONFIG` to determine the auth strategy.
 *
 * @param provider - The provider key (e.g., "openai", "anthropic")
 * @param customKeys - Record containing the API key and optional base URL
 * @returns Promise resolving to validation result
 *
 * @remarks
 * - Skips validation if the API key is masked (editing existing provider without changing key)
 * - Skips validation for providers with complex auth (Bedrock, Vertex AI, Azure)
 *
 * @example
 * ```ts
 * const result = await validateProviderApiKey("openai", {
 *   OPENAI_API_KEY: "sk-...",
 *   OPENAI_BASE_URL: "https://api.openai.com/v1"
 * });
 * ```
 */
async function validateProviderApiKey(
  provider: string,
  customKeys: Record<string, string>,
): Promise<ValidationResult> {
  // Get provider definition from registry
  const providerDef = modelProviders[provider as keyof typeof modelProviders];
  if (!providerDef) {
    return { valid: true }; // Unknown provider, skip validation
  }

  // Get validation config
  const validationConfig = PROVIDER_VALIDATION_CONFIG[provider];
  if (!validationConfig || validationConfig.authStrategy === "skip") {
    return { valid: true }; // No validation config or explicitly skipped
  }

  // Extract API key and base URL using registry field names
  const apiKeyField = providerDef.apiKey;
  const endpointField = providerDef.endpointKey;

  const apiKey = customKeys[apiKeyField]?.trim() ?? "";
  const baseUrl = endpointField ? (customKeys[endpointField]?.trim() ?? "") : "";

  // Skip validation if API key is masked (user editing existing provider without changing key)
  if (apiKey === MASKED_KEY_PLACEHOLDER) {
    return { valid: true };
  }

  // Skip validation if no API key provided (schema validation handles required fields)
  if (!apiKey) {
    // For custom provider, also check if base URL is provided
    if (provider === "custom" && !baseUrl) {
      return { valid: true };
    }
    // For providers with optional base URL, skip if no API key
    if (provider !== "custom") {
      return { valid: true };
    }
  }

  // For providers that support base URL without API key (e.g., OpenAI with proxy)
  if (baseUrl && !apiKey && provider !== "custom") {
    return { valid: true };
  }

  // Validate based on auth strategy
  const { authStrategy, defaultBaseUrl } = validationConfig;

  switch (authStrategy) {
    case "bearer":
      return validateWithBearerToken(apiKey, baseUrl, defaultBaseUrl);
    case "anthropic":
      return validateWithAnthropicAuth(apiKey, defaultBaseUrl);
    case "gemini":
      return validateWithGeminiAuth(apiKey, defaultBaseUrl);
    default:
      return { valid: true };
  }
}

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
        customModels: z.array(z.string()).optional().nullable(),
        customEmbeddingsModels: z.array(z.string()).optional().nullable(),
        extraHeaders: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .optional()
          .nullable(),
        defaultModel: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input, ctx }) => {
      const {
        id,
        projectId,
        provider,
        enabled,
        customKeys,
        customModels,
        customEmbeddingsModels,
        extraHeaders,
        defaultModel,
      } = input;

      if (!(provider in modelProviders)) {
        throw new Error("Invalid provider");
      }

      const providerSchema =
        modelProviders[provider as keyof typeof modelProviders]!.keysSchema;
      const validator = z.union([
        providerSchema,
        z.object({ MANAGED: z.string() }),
      ]);
      let validatedKeys;
      try {
        validatedKeys = customKeys ? validator.parse(customKeys) : null;

        // Filter out null values for Azure provider to avoid saving nulls to database
        if (provider === "azure" && validatedKeys) {
          validatedKeys = Object.fromEntries(
            Object.entries(validatedKeys).filter(
              ([_, value]) => value !== null,
            ),
          );
          // If all keys are filtered out, set to null
          if (Object.keys(validatedKeys).length === 0) {
            validatedKeys = null;
          }
        }
      } catch {
        throw new Error(`Invalid keys for ${provider}`);
      }

      const data = {
        projectId,
        provider,
        enabled,
        customModels,
        customEmbeddingsModels,
        extraHeaders,
      };

      const existingModelProvider = id
        ? await ctx.prisma.modelProvider.findUnique({
            where: { id, projectId },
          })
        : // TOOD: when we go support custom models, this should be skipped
          await ctx.prisma.modelProvider.findFirst({
            where: { provider, projectId },
          });

      const modelProviderResult = await ctx.prisma.$transaction(async (tx) => {
        let result: Awaited<
          ReturnType<
            typeof tx.modelProvider.update | typeof tx.modelProvider.create
          >
        >;

        if (existingModelProvider) {
          // Smart merging: preserve masked standard keys, but replace extra headers completely
          let mergedCustomKeys: Record<string, any> = validatedKeys ?? {};
          if (validatedKeys && existingModelProvider.customKeys) {
            const existingKeys = existingModelProvider.customKeys as Record<
              string,
              any
            >;

            mergedCustomKeys = {
              // Start with new keys (includes all extra headers)
              ...validatedKeys,
              // Override with existing values for masked standard keys
              ...Object.fromEntries(
                Object.entries(existingKeys)
                  .filter(
                    ([key, _value]) =>
                      (validatedKeys as any)[key] === MASKED_KEY_PLACEHOLDER,
                  )
                  .map(([key, value]) => [key, value]),
              ),
            };
          }

          result = await tx.modelProvider.update({
            where: { id: existingModelProvider.id, projectId },
            data: {
              ...data,
              customKeys: mergedCustomKeys,
              customModels: customModels ? customModels : [],
              customEmbeddingsModels: customEmbeddingsModels
                ? customEmbeddingsModels
                : [],
              extraHeaders: extraHeaders ? extraHeaders : [],
            },
          });
        } else {
          result = await tx.modelProvider.create({
            data: {
              ...data,
              customModels: customModels ?? undefined,
              customEmbeddingsModels: customEmbeddingsModels ?? undefined,
              extraHeaders: extraHeaders ? (extraHeaders as any) : [],
            },
          });
        }

        // Update project's default model if provided
        if (defaultModel !== void 0) {
          await tx.project.update({
            where: { id: projectId },
            data: { defaultModel },
          });
        }

        return result;
      });

      return modelProviderResult;
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
   * This is a read-only query that tests if the provided API key works.
   * No project permission is required since we're just validating user-provided keys.
   */
  validateApiKey: protectedProcedure
    .input(
      z.object({
        provider: z.string(),
        customKeys: z.record(z.string()),
      }),
    )
    .use(skipPermissionCheck)
    .query(async ({ input }) => {
      const { provider, customKeys } = input;
      return validateProviderApiKey(provider, customKeys);
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
    .filter(
      (modelProvider) =>
        modelProvider.customKeys ??
        modelProvider.enabled !==
          defaultModelProviders[modelProvider.provider]?.enabled,
    )
    .reduce(
      (acc, modelProvider) => {
        const modelProvider_: MaybeStoredModelProvider = {
          id: modelProvider.id,
          provider: modelProvider.provider,
          enabled: modelProvider.enabled,
          customKeys: modelProvider.customKeys,
          models: modelProvider.customModels as string[] | null,
          embeddingsModels: modelProvider.customEmbeddingsModels as
            | string[]
            | null,
          deploymentMapping: modelProvider.deploymentMapping,
          disabledByDefault:
            defaultModelProviders[modelProvider.provider]?.disabledByDefault,
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

// Frontend-only function that masks API keys for security
export const getProjectModelProvidersForFrontend = async (
  projectId: string,
  includeKeys = true,
) => {
  const modelProviders = await getProjectModelProviders(projectId, includeKeys);

  if (!includeKeys) {
    return modelProviders;
  }

  // Mask only API keys, keep URLs visible
  const maskedProviders = { ...modelProviders };
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

  return maskedProviders;
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

  params.model = model.replace("custom/", "openai/");

  const apiKey = getModelOrDefaultApiKey(modelProvider);
  if (apiKey && modelProvider.provider !== "vertex_ai") {
    params.api_key = apiKey;
  }
  const endpoint = getModelOrDefaultEndpointKey(modelProvider);
  if (endpoint) {
    params.api_base = endpoint;
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
