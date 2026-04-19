import { z } from "zod";
import { customModelUpdateInputSchema } from "../../modelProviders/customModel.schema";
import { ModelProviderService } from "../../modelProviders/modelProvider.service";
import {
  checkProjectPermission,
  checkOrganizationPermission,
  hasProjectPermission,
} from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  validateKeyWithCustomUrl,
  validateProviderApiKey,
} from "./providerValidation";
import {
  getProjectModelProviders,
  getProjectModelProvidersForFrontend,
} from "./modelProviders.utils";
import { isManagedProvider } from "../../../../ee/managed-providers/managedBedrockConfig";

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
        // Multi-scope writes (iter 109). `scopes` is the canonical shape;
        // `scopeType`/`scopeId` remain for the transition period so older
        // callers still compile. When both arrive, `scopes` wins. The
        // service runs the fail-closed authz check on every entry before
        // persisting — any non-manageable scope aborts the whole write.
        scopes: z
          .array(
            z.object({
              scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
              scopeId: z.string().min(1),
            }),
          )
          .min(1, "At least one scope must be selected.")
          .optional(),
        scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]).optional(),
        scopeId: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input, ctx }) => {
      const service = ModelProviderService.create(ctx.prisma);
      return await service.updateModelProvider(
        {
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
          scopes: input.scopes,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
        },
        { prisma: ctx.prisma, session: ctx.session },
      );
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
      return await service.deleteModelProvider(input, {
        prisma: ctx.prisma,
        session: ctx.session,
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

  isManagedProvider: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        provider: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(({ input }) => {
      return { managed: isManagedProvider(input.organizationId, input.provider) };
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

