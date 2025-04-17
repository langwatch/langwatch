import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup } from "../permission";
import { checkUserPermissionForProject } from "../permission";
import { LlmConfigRepository } from "../../repositories/llm-config.repository";
import { getLatestConfigVersionSchema } from "~/server/repositories/llm-config-version-schema";

const idSchema = z.object({
  id: z.string(),
});

const projectIdSchema = z.object({
  projectId: z.string(),
});

const configIdSchema = z.object({
  configId: z.string(),
});

const configDataSchema = z
  .object({
    name: z.string(),
  })
  .merge(projectIdSchema);

/**
 * Router for handling LLM prompt config versions
 */
export const llmConfigVersionsRouter = createTRPCRouter({
  /**
   * Get all versions for a specific config.
   */
  getVersions: protectedProcedure
    .input(
      projectIdSchema.merge(
        z.object({
          configId: z.string(),
        })
      )
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);

      try {
        const versions = await repository.versions.getVersions(input);
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
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
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
    .input(getLatestConfigVersionSchema().omit({ authorId: true }))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);
      const authorId = ctx.session?.user?.id;

      try {
        // TODO: Validate the config data against the schema before saving
        const version = await repository.versions.createVersion({
          ...input,
          authorId,
        });

        return version;
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Failed to create version.",
        });
      }
    }),

  /**
   * Get the latest version for a config
   */
  getLatest: protectedProcedure
    .input(configIdSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
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
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const { id, projectId } = input;
      const repository = new LlmConfigRepository(ctx.prisma);

      try {
        const newVersion = await repository.versions.restoreVersion(
          id,
          projectId,
          ctx.session?.user?.id || null
        );

        return newVersion;
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Version not found.",
        });
      }
    }),
});

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
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);
      return await repository.getAllConfigs(input.projectId);
    }),

  /**
   * Get a single LLM prompt config by its id.
   */
  getPromptConfigById: protectedProcedure
    .input(idSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);

      try {
        const config = await repository.getConfigById(
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
  createPromptConfig: protectedProcedure
    .input(configDataSchema)
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);

      try {
        const newConfig = await repository.createConfig(input);

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
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
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
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
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
