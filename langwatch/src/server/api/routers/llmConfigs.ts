import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup } from "../permission";
import { checkUserPermissionForProject } from "../permission";
import { LlmConfigRepository } from "../../repositories/llm-config.repository";

// Basic schema for the config JSON - adjust as needed for specific structure
const configJsonSchema = z
  .record(z.any())
  .describe("JSON configuration object");

// Base schema for parent LlmPromptConfig
const baseConfigSchema = z.object({
  name: z.string().min(1, "Name cannot be empty."),
});

// Base schema for LlmPromptConfigVersion
const baseVersionSchema = z.object({
  configData: configJsonSchema, // The actual config data for this version
  schemaVersion: z.string().min(1, "Schema version cannot be empty."),
  commitMessage: z.string().optional(),
});

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
  getVersions: protectedProcedure
    .input(configIdSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);

      try {
        const versions = await repository.versions.getVersions(
          input.configId,
          input.projectId
        );
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
    .input(idSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      const repository = new LlmConfigRepository(ctx.prisma);

      try {
        const version = await repository.versions.getVersionById(
          input.id,
          input.projectId
        );
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
    .input(baseVersionSchema.merge(configIdSchema).merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const { configData, schemaVersion, commitMessage, configId, projectId } =
        input;
      const repository = new LlmConfigRepository(ctx.prisma);

      try {
        const version = await repository.versions.createVersion({
          configId,
          projectId,
          configData,
          schemaVersion,
          commitMessage,
          authorId: ctx.session?.user?.id || null,
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
    .input(baseConfigSchema.merge(baseVersionSchema).merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const { name, configData, schemaVersion, commitMessage, projectId } =
        input;
      const repository = new LlmConfigRepository(ctx.prisma);

      try {
        const newConfig = await repository.createConfig(
          { name, projectId },
          {
            projectId,
            configData,
            schemaVersion,
            commitMessage: commitMessage ?? "Initial version",
            authorId: ctx.session?.user?.id || null,
          }
        );

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
    .input(baseConfigSchema.partial().merge(idSchema).merge(projectIdSchema))
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
