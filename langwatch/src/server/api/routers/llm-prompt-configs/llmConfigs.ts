import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { PromptService } from "~/server/prompt-config/prompt.service";

import { LlmConfigRepository } from "../../../prompt-config/repositories/llm-config.repository";
import { TeamRoleGroup } from "../../permission";
import { checkUserPermissionForProject } from "../../permission";
import { createTRPCRouter, protectedProcedure } from "../../trpc";

import { llmConfigVersionsRouter } from "./llmPromptConfigVersions";
import { prisma } from "../../../db";
import { PromptScope } from "@prisma/client";

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
      const organizationId = await getOrganizationIdForProject(input.projectId);

      return await repository.getAllWithLatestVersion({
        projectId: input.projectId,
        organizationId,
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
      const organizationId = await getOrganizationIdForProject(input.projectId);

      const config = await repository.getConfigByIdOrHandleWithLatestVersion({
        idOrHandle: input.id,
        projectId: input.projectId,
        organizationId,
      });

      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt config not found",
        });
      }

      return config;
    }),

  /**
   * Create a new LLM prompt config with its initial version.
   */
  createConfigWithInitialVersion: protectedProcedure
    .input(configDataSchema)
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);
      const organizationId = await getOrganizationIdForProject(input.projectId);
      const authorId = ctx.session?.user?.id;

      const newConfig = await repository.createConfigWithInitialVersion({
        ...input,
        authorId,
        organizationId,
        scope: "PROJECT",
      });

      return newConfig;
    }),

  /**
   * Update an LLM prompt config's metadata (name, handle and scope).
   */
  updatePromptConfig: protectedProcedure
    .input(
      projectIdSchema.merge(
        z.object({
          id: z.string(),
          name: z.string(),
          handle: z.string().optional(),
          scope: z.nativeEnum(PromptScope).optional(),
        })
      )
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);

      const updatedConfig = await repository.updateConfig(
        input.id,
        input.projectId,
        {
          name: input.name,
          handle: input.handle,
          scope: input.scope,
        }
      );

      return updatedConfig;
    }),

  /**
   * Delete an LLM prompt config and all its versions.
   */
  deletePromptConfig: protectedProcedure
    .input(idSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);

      return await repository.deleteConfig(input.id, input.projectId);
    }),

  /**
   * Check if a handle is unique for a project.
   */
  checkHandleUniqueness: protectedProcedure
    .input(
      z.object({
        handle: z.string(),
        scope: z.nativeEnum(PromptScope),
        projectId: z.string(),
        excludeId: z.string().optional(), // Exclude current config when editing
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_VIEW))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);

      const organizationId = await getOrganizationIdForProject(input.projectId);

      return await service.checkHandleUniqueness({
        handle: input.handle,
        scope: input.scope,
        projectId: input.projectId,
        organizationId,
        excludeId: input.excludeId,
      });
    }),
});

async function getOrganizationIdForProject(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
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
      message: "Organization not found",
    });
  }

  return project.team.organization.id;
}
