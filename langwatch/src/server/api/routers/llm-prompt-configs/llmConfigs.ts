import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { PromptService } from "~/server/prompt-config/prompt.service";

import { LlmConfigRepository } from "../../../prompt-config/repositories/llm-config.repository";
import { TeamRoleGroup } from "../../permission";
import { checkUserPermissionForProject } from "../../permission";
import { createTRPCRouter, protectedProcedure } from "../../trpc";

import { llmConfigVersionsRouter } from "./llmPromptConfigVersions";

const idSchema = z.object({
  id: z.string(),
});

const projectIdSchema = z.object({
  projectId: z.string(),
});

const configDataSchema = z
  .object({
    name: z.string(),
  })
  .merge(projectIdSchema);

/**
 * Router for handling LLM prompt configs
 */
export const llmConfigsRouter = createTRPCRouter({
  versions: llmConfigVersionsRouter,

  /**
   * Get all LLM prompt configs for a specific project.
   */
  getPromptConfigs: protectedProcedure
    .input(projectIdSchema)
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_VIEW))
    .query(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);
      const project = await ctx.prisma.project.findUnique({
        where: {
          id: input.projectId,
        },
        include: {
          team: {
            include: {
              organization: true,
            },
          },
        },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found.",
        });
      }

      return await repository.getAllWithLatestVersion({
        projectId: input.projectId,
        organizationId: project?.team.organization.id,
      });
    }),

  /**
   * Get a single LLM prompt config by its id.
   */
  getByIdWithLatestVersion: protectedProcedure
    .input(idSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_VIEW))
    .query(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);
      const project = await ctx.prisma.project.findUnique({
        where: {
          id: input.projectId,
        },
        include: {
          team: {
            include: {
              organization: true,
            },
          },
        },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found.",
        });
      }

      try {
        const config = await repository.getConfigByIdOrHandleWithLatestVersion({
          idOrHandle: input.id,
          projectId: input.projectId,
          organizationId: project?.team.organization.id,
        });
        return config;
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt config not found",
          cause: error,
        });
      }
    }),

  /**
   * Create a new LLM prompt config with its initial version.
   */
  createConfigWithInitialVersion: protectedProcedure
    .input(configDataSchema)
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);
      const authorId = ctx.session?.user?.id;

      try {
        const newConfig = await repository.createConfigWithInitialVersion({
          ...input,
          authorId,
        });

        return newConfig;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Failed to create config",
          cause: error,
        });
      }
    }),

  /**
   * Update an LLM prompt config's metadata (name and referenceId).
   */
  updatePromptConfig: protectedProcedure
    .input(
      projectIdSchema.merge(
        z.object({
          id: z.string(),
          name: z.string(),
          referenceId: z.string().optional(), // Add referenceId support
        })
      )
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);

      try {
        const updatedConfig = await repository.updateConfig(
          input.id,
          input.projectId,
          {
            name: input.name,
            referenceId: input.referenceId,
          }
        );

        return updatedConfig;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to update config: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          cause: error,
        });
      }
    }),

  /**
   * Delete an LLM prompt config and all its versions.
   */
  deletePromptConfig: protectedProcedure
    .input(idSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);

      try {
        return await repository.deleteConfig(input.id, input.projectId);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Failed to delete config",
          cause: error,
        });
      }
    }),

  /**
   * Check if a reference ID is unique for a project.
   */
  checkReferenceIdUniqueness: protectedProcedure
    .input(
      z.object({
        referenceId: z.string(),
        projectId: z.string(),
        excludeId: z.string().optional(), // Exclude current config when editing
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_VIEW))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);

      return await service.checkReferenceIdUniqueness({
        referenceId: input.referenceId,
        projectId: input.projectId,
        excludeId: input.excludeId,
      });
    }),
});
