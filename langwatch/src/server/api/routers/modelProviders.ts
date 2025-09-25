import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  TeamRoleGroup,
  checkUserPermissionForProject,
  backendHasTeamProjectPermission,
} from "../permission";
import {
  getProviderModelOptions,
  modelProviders,
  type MaybeStoredModelProvider,
} from "../../modelProviders/registry";
import { prisma } from "../../db";
import { dependencies } from "../../../injection/dependencies.server";
import { KEY_CHECK } from "../../../utils/constants";

export const modelProviderRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.PROJECT_VIEW))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;

      const hasSetupPermission = await backendHasTeamProjectPermission(
        ctx,
        { projectId },
        TeamRoleGroup.SETUP_PROJECT
      );

      return await getProjectModelProviders(projectId, hasSetupPermission);
    }),
  getAllForProjectForFrontend: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.PROJECT_VIEW))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const hasSetupPermission = await backendHasTeamProjectPermission(
        ctx,
        { projectId },
        TeamRoleGroup.SETUP_PROJECT
      );
      return await getProjectModelProvidersForFrontend(
        projectId,
        hasSetupPermission
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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
    .mutation(async ({ input, ctx }) => {
      const {
        id,
        projectId,
        provider,
        enabled,
        customKeys,
        customModels,
        customEmbeddingsModels,
      } = input;

      if (!(provider in modelProviders)) {
        throw new Error("Invalid provider");
      }

      const validator = z.union([
        modelProviders[provider as keyof typeof modelProviders]!.keysSchema,
        z.object({ MANAGED: z.string() }),
      ]);
      let validatedKeys;
      try {
        validatedKeys = customKeys ? validator.parse(customKeys) : null;
      } catch (e) {
        throw new Error(`Invalid keys for ${provider}`);
      }

      const data = {
        projectId,
        provider,
        enabled,
        customModels,
        customEmbeddingsModels,
      };

      const existingModelProvider = id
        ? await ctx.prisma.modelProvider.findUnique({
            where: { id, projectId },
          })
        : // TOOD: when we go support custom models, this should be skipped
          await ctx.prisma.modelProvider.findFirst({
            where: { provider, projectId },
          });

      if (existingModelProvider) {
        // Merge custom keys, preserving existing values when frontend sends "HAS_KEY" or dots
        let mergedCustomKeys: Record<string, any> | null = validatedKeys;
        if (validatedKeys && existingModelProvider.customKeys) {
          mergedCustomKeys = {
            ...(existingModelProvider.customKeys as Record<string, any>),
            ...Object.fromEntries(
              Object.entries(validatedKeys).filter(
                ([_key, value]) => value !== "HAS_KEY••••••••••••••••••••••••"
              )
            ),
          };
        }

        return await ctx.prisma.modelProvider.update({
          where: { id: existingModelProvider.id, projectId },
          data: {
            ...data,
<<<<<<< HEAD
            customKeys: mergedCustomKeys as any,
=======
            customKeys: mergedCustomKeys ?? undefined,
>>>>>>> e7948829 (fix drift)
            customModels: customModels ? customModels : [],
            customEmbeddingsModels: customEmbeddingsModels
              ? customEmbeddingsModels
              : [],
          },
        });
      } else {
        return await ctx.prisma.modelProvider.create({
          data: {
            ...data,
            customModels: customModels ?? undefined,
            customEmbeddingsModels: customEmbeddingsModels ?? undefined,
          },
        });
      }
    }),

  delete: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        projectId: z.string(),
        provider: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
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
});

export const getProjectModelProviders = async (
  projectId: string,
  includeKeys = true
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
              (m) => m.value
            ),
            embeddingsModels: getProviderModelOptions(
              providerKey,
              "embedding"
            ).map((m) => m.value),
            deploymentMapping: null,
          };
          return [providerKey, modelProvider_];
        })
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
          defaultModelProviders[modelProvider.provider]?.enabled
    )
    .reduce(
      (acc, modelProvider) => {
        const modelProvider_: MaybeStoredModelProvider = {
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
        };

        if (!includeKeys) {
          modelProvider_.customKeys = null;
        }

        return {
          ...acc,
          [modelProvider.provider]: modelProvider_,
        };
      },
      {} as Record<string, MaybeStoredModelProvider>
    );

  return {
    ...defaultModelProviders,
    ...savedModelProviders,
  };
};

// Frontend-only function that masks API keys for security
export const getProjectModelProvidersForFrontend = async (
  projectId: string,
  includeKeys = true
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
              ? "HAS_KEY••••••••••••••••••••••••"
              : value,
          ])
        ),
      };
    }
  }

  return maskedProviders;
};

const getModelOrDefaultEnvKey = (
  modelProvider: MaybeStoredModelProvider,
  envKey: string
) => {
  return (
    (modelProvider.customKeys as Record<string, string>)?.[envKey] ??
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
  modelProvider: MaybeStoredModelProvider
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

  return Object.fromEntries(
    Object.keys(
      ("innerType" in providerDefinition.keysSchema
        ? providerDefinition.keysSchema.innerType()
        : providerDefinition.keysSchema
      ).shape
    )
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
      .filter(([_key, value]) => !!value)
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
      "AZURE_API_GATEWAY_BASE_URL"
    );
    const gatewayVersion = getModelOrDefaultEnvKey(
      modelProvider,
      "AZURE_API_GATEWAY_VERSION"
    ) ?? "2024-05-01-preview";
    const gatewayHeaderName = getModelOrDefaultEnvKey(
      modelProvider,
      "AZURE_API_GATEWAY_HEADER_NAME"
    );
    const gatewayHeaderKey = getModelOrDefaultEnvKey(
      modelProvider,
      "AZURE_API_GATEWAY_HEADER_KEY"
    );

    // If API Gateway is configured, route through the gateway endpoint
    if (gatewayBaseUrl) {
      params.api_base = gatewayBaseUrl;
      params.use_azure_gateway = "true";
      params.api_version = gatewayVersion;
      // Set custom header parameters for API Gateway
      if (gatewayHeaderName && gatewayHeaderKey) {
        params.azure_api_gateway_header_name = gatewayHeaderName;
        params.azure_api_gateway_header_key = gatewayHeaderKey;
      }
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
