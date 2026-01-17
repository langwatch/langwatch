import { z } from "zod";
import { dependencies } from "../../../injection/dependencies.server";
import { prisma } from "../../db";
import { ModelProviderService } from "../../modelProviders/modelProvider.service";
import {
  type MaybeStoredModelProvider,
  modelProviders,
} from "../../modelProviders/registry";
import { checkProjectPermission, hasProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  validateKeyWithCustomUrl,
  validateProviderApiKey,
} from "./providerValidation";

export const modelProviderRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const service = ModelProviderService.create(ctx.prisma);

      const hasSetupPermission = await hasProjectPermission(
        ctx,
        projectId,
        "project:update",
      );

      return await service.getProjectModelProviders(
        projectId,
        hasSetupPermission,
      );
    }),
  getAllForProjectForFrontend: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const service = ModelProviderService.create(ctx.prisma);
      const hasSetupPermission = await hasProjectPermission(
        ctx,
        projectId,
        "project:update",
      );
      return await service.getProjectModelProvidersForFrontend(
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
      const service = ModelProviderService.create(ctx.prisma);
      return await service.deleteModelProvider({
        id: input.id,
        projectId: input.projectId,
        provider: input.provider,
      });
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

/**
 * Gets all model providers for a project.
 * Delegates to ModelProviderService for business logic.
 */
export const getProjectModelProviders = async (
  projectId: string,
  includeKeys = true,
) => {
  const service = ModelProviderService.create(prisma);
  return service.getProjectModelProviders(projectId, includeKeys);
};

/**
 * Gets model providers with API keys masked for frontend display.
 * Delegates to ModelProviderService for business logic.
 */
export const getProjectModelProvidersForFrontend = async (
  projectId: string,
  includeKeys = true,
) => {
  const service = ModelProviderService.create(prisma);
  return service.getProjectModelProvidersForFrontend(projectId, includeKeys);
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
