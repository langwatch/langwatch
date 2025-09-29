import { PromptScope } from "@prisma/client";
import { z } from "zod";

import { PromptService } from "~/server/prompt-config";

import { TeamRoleGroup } from "../../permission";
import { checkUserPermissionForProject } from "../../permission";
import { createTRPCRouter, protectedProcedure } from "../../trpc";

import { handleSchema, inputsSchema, messageSchema, outputsSchema, promptingTechniqueSchema } from "~/prompt-configs/schemas";
import { nodeDatasetSchema } from "~/optimization_studio/types/dsl";

/**
 * Router for handling prompts - the business-facing interface
 * Currently only supports upsert operation
 * TODO: Add other operations as needed
 */
export const promptsRouter = createTRPCRouter({
  /**
   * Upsert a prompt - create if it doesn't exist, update if it does
   */
  upsert: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        handle: handleSchema,
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
          demonstrations: nodeDatasetSchema.optional(),
        }),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      const authorId = ctx.session?.user?.id;

      return await service.upsertPrompt({
        handle: input.handle,
        projectId: input.projectId,
        data: {
          ...input.data,
          authorId,
        }
      });
    }),


  /**
   * Update a prompt
   */
  update: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      handle: handleSchema,
      data: z.object({
        scope: z.nativeEnum(PromptScope).optional(),
        commitMessage: z.string().optional(),
      })
    }))
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      return await service.updatePrompt({
        idOrHandle: input.handle,
        projectId: input.projectId,
        data: input.data,
      });
    }),

  /**
   * Get a prompt by version id
   */
  getByVersionId: protectedProcedure
    .input(z.object({
      versionId: z.string(),
      projectId: z.string(),
    }))
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_VIEW))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      const { versionId, ...rest } = input;
      return await service.getPromptByVersionId({
        versionId,
        ...rest,
      });
    }),

  /**
   * Get a prompt by id
   */
  getById: protectedProcedure
    .input(z.object({
      id: z.string(),
      projectId: z.string(),
    }))
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_VIEW))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      return await service.getPromptByIdOrHandle({
        idOrHandle: input.id,
        projectId: input.projectId,
      });
    }),
});