import { z } from "zod";
import { customModelUpdateInputSchema } from "../../modelProviders/customModel.schema";
import { ModelProviderService } from "../../modelProviders/modelProvider.service";
import { checkProjectPermission, hasProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  validateKeyWithCustomUrl,
  validateProviderApiKey,
} from "../../modelProviders/providerValidation";
import {
  getProjectModelProviders,
  getProjectModelProvidersForFrontend,
} from "./modelProviders.utils";

export type { ModelMetadataForFrontend } from "./modelProviders.utils";
export {
  getProjectModelProviders,
  getModelMetadataForFrontend,
  mergeCustomModelMetadata,
  getProjectModelProvidersForFrontend,
  prepareEnvKeys,
  prepareLitellmParams,
} from "./modelProviders.utils";

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
      const service = ModelProviderService.create(ctx.prisma);
      return await service.deleteModelProvider(input);
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

