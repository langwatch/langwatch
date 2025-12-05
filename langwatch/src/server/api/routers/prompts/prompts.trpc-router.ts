import { PromptScope } from "@prisma/client";
import { z } from "zod";

import { PromptService } from "~/server/prompt-config";
import { checkProjectPermission } from "../../rbac";
import { createTRPCRouter, protectedProcedure } from "../../trpc";

import {
  handleSchema,
  inputsSchema,
  messageSchema,
  outputsSchema,
  promptingTechniqueSchema,
  responseFormatSchema,
} from "~/prompts/schemas";
import { nodeDatasetSchema } from "~/optimization_studio/types/dsl";

/**
 * Router for handling prompts - the business-facing interface
 */
export const promptsRouter = createTRPCRouter({
  /**
   * Get all prompts for project
   */
  getAllPromptsForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("prompts:view"))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      return await service.getAllPrompts(input);
    }),

  /**
   * Restore a prompt version
   */
  restoreVersion: protectedProcedure
    .input(
      z.object({
        versionId: z.string(),
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("prompts:update"))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      const authorId = ctx.session?.user?.id;
      return await service.restoreVersion({
        ...input,
        authorId,
      });
    }),

  /**
   * Create a new prompt
   */
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        data: z.object({
          scope: z.nativeEnum(PromptScope).optional(),
          authorId: z.string().optional(),
          commitMessage: z.string().optional(),
          prompt: z.string().optional(),
          messages: z.array(messageSchema).optional(),
          inputs: z.array(inputsSchema).optional(),
          outputs: z.array(outputsSchema).optional(),
          model: z.string().optional(),
          temperature: z.number().optional(),
          maxTokens: z.number().optional(),
          promptingTechnique: promptingTechniqueSchema.optional(),
          responseFormat: responseFormatSchema.optional(),
          demonstrations: nodeDatasetSchema.optional(),
          handle: handleSchema,
        }),
      }),
    )
    .use(checkProjectPermission("prompts:create"))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      const authorId = ctx.session?.user?.id;

      return await service.createPrompt({
        ...input.data,
        projectId: input.projectId,
        authorId,
      });
    }),

  /**
   * Update a prompt (creates a new version, requires commitMessage)
   * Scope and handle should not be updated here since they do not create a new version/require a commit message.
   * Use the updateHandle method instead for those.
   */
  update: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        data: z.object({
          commitMessage: z.string(),
          authorId: z.string().optional(),
          prompt: z.string().optional(),
          messages: z.array(messageSchema).optional(),
          inputs: z.array(inputsSchema).optional(),
          outputs: z.array(outputsSchema).optional(),
          model: z.string().optional(),
          temperature: z.number().optional(),
          maxTokens: z.number().optional(),
          promptingTechnique: promptingTechniqueSchema.optional(),
          responseFormat: responseFormatSchema.optional(),
          demonstrations: nodeDatasetSchema.optional(),
        }),
      }),
    )
    .use(checkProjectPermission("prompts:update"))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      const authorId = ctx.session?.user?.id;

      return await service.updatePrompt({
        idOrHandle: input.id,
        projectId: input.projectId,
        data: {
          ...input.data,
          authorId,
        },
      });
    }),

  /**
   * Update only the handle and scope without creating a new version
   */
  updateHandle: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        data: z.object({
          handle: handleSchema,
          scope: z.nativeEnum(PromptScope),
        }),
      }),
    )
    .use(checkProjectPermission("prompts:update"))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      return await service.updateHandle({
        idOrHandle: input.id,
        projectId: input.projectId,
        data: input.data,
      });
    }),

  /**
   * Get a prompt by id
   */
  getByIdOrHandle: protectedProcedure
    .input(
      z.object({
        idOrHandle: z.string(),
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("prompts:view"))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      return await service.getPromptByIdOrHandle(input);
    }),

  /**
   * Check if a handle is unique for a project
   */
  checkHandleUniqueness: protectedProcedure
    .input(
      z.object({
        handle: handleSchema,
        projectId: z.string(),
        scope: z.nativeEnum(PromptScope),
      }),
    )
    .use(checkProjectPermission("prompts:view"))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      return await service.checkHandleUniqueness(input);
    }),

  /**
   * Check if user can modify/delete a prompt
   */
  checkModifyPermission: protectedProcedure
    .input(
      z.object({
        idOrHandle: z.string(),
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("prompts:view"))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      return await service.checkModifyPermission(input);
    }),

  /**
   * Get all versions for a prompt
   */
  getAllVersionsForPrompt: protectedProcedure
    .input(
      z.object({
        idOrHandle: z.string(),
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("prompts:view"))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      return await service.getAllVersions(input);
    }),

  /**
   * Delete a prompt
   */
  delete: protectedProcedure
    .input(
      z.object({
        idOrHandle: z.string(),
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("prompts:delete"))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      return await service.deletePrompt(input);
    }),
});
