import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

import { LlmConfigRepository } from "../../../prompt-config/repositories/llm-config.repository";
import { TeamRoleGroup } from "../../permission";
import { checkUserPermissionForProject } from "../../permission";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { getOrganizationIdForProject } from "./llmConfigs";

const idSchema = z.object({
  id: z.string(),
});

const projectIdSchema = z.object({
  projectId: z.string(),
});

const configIdSchema = z.object({
  configId: z.string(),
});

/**
 * Router for handling LLM prompt config versions
 */
export const llmConfigVersionsRouter = createTRPCRouter({
  /**
   * Get all versions for a specific config.
   */
  getVersionsForConfigById: protectedProcedure
    .input(
      projectIdSchema.merge(
        z.object({
          configId: z.string(),
        })
      )
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_VIEW))
    .query(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);
      const organizationId = await getOrganizationIdForProject(input.projectId);

      try {
        const versions =
          await repository.versions.getVersionsForConfigByIdOrHandle({
            idOrHandle: input.configId,
            projectId: input.projectId,
            organizationId,
          });
        return versions;
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt config not found.",
        });
      }
    }),

  /**
   * Get a specific version by id.
   */
  getById: protectedProcedure
    .input(
      projectIdSchema.merge(
        z.object({
          versionId: z.string(),
        })
      )
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_VIEW))
    .query(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);

      try {
        const version = await repository.versions.getVersionById(input);
        return version;
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt config version not found.",
        });
      }
    }),

  /**
   * Create a new version for an existing config.
   */
  create: protectedProcedure
    .input(
      getLatestConfigVersionSchema().omit({ version: true, authorId: true })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);
      const authorId = ctx.session?.user?.id;
      const organizationId = await getOrganizationIdForProject(input.projectId);

      try {
        const version = await repository.versions.createVersion(
          {
            ...input,
            authorId,
          },
          organizationId
        );

        return version;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create version: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          cause: error,
        });
      }
    }),

  /**
   * Get the latest version for a config
   */
  getLatest: protectedProcedure
    .input(configIdSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_VIEW))
    .query(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);

      try {
        const latestVersion = await repository.versions.getLatestVersion(
          input.configId,
          input.projectId
        );
        return latestVersion;
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No versions found for this config.",
        });
      }
    }),

  /**
   * Restore a version
   */
  restore: protectedProcedure
    .input(idSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const { id, projectId } = input;
      const repository = new LlmConfigRepository(ctx.prisma);
      const organizationId = await getOrganizationIdForProject(projectId);

      try {
        const newVersion = await repository.versions.restoreVersion(
          id,
          projectId,
          organizationId,
          ctx.session?.user?.id || null
        );

        return newVersion;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to restore version: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          cause: error,
        });
      }
    }),
});
