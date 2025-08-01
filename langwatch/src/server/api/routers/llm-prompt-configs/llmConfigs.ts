import { TRPCError } from "@trpc/server";
import { z } from "zod";

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
      return await repository.getAllWithLatestVersion(input.projectId);
    }),

  /**
   * Get a single LLM prompt config by its id.
   */
  getByIdWithLatestVersion: protectedProcedure
    .input(idSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_VIEW))
    .query(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);

      try {
        const config =
          await repository.getConfigByIdOrReferenceIddWithLatestVersions(
            input.id,
            input.projectId
          );
        return config;
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt config not found.",
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
          message: "Failed to create config.",
        });
      }
    }),

  /**
   * Update an LLM prompt config's metadata (name only).
   */
  updatePromptConfig: protectedProcedure
    .input(
      projectIdSchema.merge(
        z.object({
          id: z.string(),
          name: z.string(),
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
          { name: input.name }
        );

        return updatedConfig;
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt config not found.",
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
          code: "NOT_FOUND",
          message: "Prompt config not found.",
        });
      }
    }),
});
