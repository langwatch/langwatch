import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import {
  modelProviders,
  type MaybeStoredModelProvider,
} from "../../modelProviders/registry";
import { prisma } from "../../db";

export const modelProviderRouter = createTRPCRouter({
  getAllForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
    .query(async ({ input }) => {
      const { projectId } = input;

      return await getProjectModelProviders(projectId);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        projectId: z.string(),
        provider: z.string(),
        enabled: z.boolean(),
        customKeys: z.object({}).passthrough().optional().nullable(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
    .mutation(async ({ input, ctx }) => {
      const { id, projectId, provider, enabled, customKeys } = input;

      if (!(provider in modelProviders)) {
        throw new Error("Invalid provider");
      }

      const validator =
        modelProviders[provider as keyof typeof modelProviders]!.keysSchema;
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
        customKeys: validatedKeys as any,
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
        return await ctx.prisma.modelProvider.update({
          where: { id: existingModelProvider.id, projectId },
          data,
        });
      } else {
        return await ctx.prisma.modelProvider.create({
          data,
        });
      }
    }),
});

export const getProjectModelProviders = async (projectId: string) => {
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
          const modelProvider_: MaybeStoredModelProvider = {
            provider: providerKey,
            enabled: modelProvider.enabledSince < project.createdAt,
            customKeys: null,
            deploymentMapping: null,
          };
          return [providerKey, modelProvider_];
        })
    );

  const savedModelProviders = (
    await prisma.modelProvider.findMany({
      where: { projectId },
    })
  ).reduce(
    (acc, modelProvider) => {
      return {
        ...acc,
        [modelProvider.provider]: modelProvider,
      };
    },
    {} as Record<string, MaybeStoredModelProvider>
  );

  return {
    ...defaultModelProviders,
    ...savedModelProviders,
  };
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
    Object.keys(providerDefinition.keysSchema.shape)
      .map((key) => [key, getModelOrDefaultEnvKey(modelProvider, key)])
      .filter(([_key, value]) => !!value)
  );
};

export const prepareLitellmParams = (
  model: string,
  modelProvider: MaybeStoredModelProvider
) => {
  const params: Record<string, string> = {};

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

  params.model = model;

  // TODO: add azure deployment as params.model as azure/<deployment-name>

  return params;
};
