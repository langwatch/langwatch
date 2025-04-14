import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup } from "../permission";
import { checkUserPermissionForProject } from "../permission";
import type { LlmPromptConfigVersion } from "@prisma/client";
import type { JsonValue } from "@prisma/client/runtime/library";

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
 * Router for handling LLM Prompt Config Versions
 */
export const llmConfigVersionsRouter = createTRPCRouter({
  /**
   * Get all versions for a specific config.
   */
  getVersions: protectedProcedure
    .input(configIdSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      // First verify the config exists within the project
      const config = await ctx.prisma.llmPromptConfig.findUnique({
        where: {
          id: input.configId,
          projectId: input.projectId,
        },
      });

      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt config not found.",
        });
      }

      // Get all versions for this config
      const versions = await ctx.prisma.llmPromptConfigVersion.findMany({
        where: {
          configId: input.configId,
          projectId: input.projectId,
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });

      return versions;
    }),

  /**
   * Get a specific version by ID.
   */
  getById: protectedProcedure
    .input(idSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      // Find the version, but join to config to check project permission
      const version = await ctx.prisma.llmPromptConfigVersion.findFirst({
        where: {
          id: input.id,
          projectId: input.projectId,
          config: {
            projectId: input.projectId,
          },
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          config: true,
        },
      });

      if (!version) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt config version not found.",
        });
      }

      return version;
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

      // Create the new version
      const version = await ctx.prisma.llmPromptConfigVersion.create({
        data: {
          commitMessage,
          authorId: ctx.session?.user?.id || null,
          configId,
          configData,
          schemaVersion,
          projectId,
        },
      });

      // Update the parent config's updatedAt timestamp
      await ctx.prisma.llmPromptConfig.update({
        where: { id: configId, projectId },
        data: { updatedAt: new Date() },
      });

      return version;
    }),

  /**
   * Get the latest version for a config
   */
  getLatest: protectedProcedure
    .input(configIdSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      // First verify the config exists within the project
      const config = await ctx.prisma.llmPromptConfig.findUnique({
        where: { id: input.configId, projectId: input.projectId },
      });

      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt config not found.",
        });
      }

      // Get the latest version
      const latestVersion = await ctx.prisma.llmPromptConfigVersion.findFirst({
        where: { configId: input.configId, projectId: input.projectId },
        orderBy: { createdAt: "desc" },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });

      if (!latestVersion) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No versions found for this config.",
        });
      }

      return latestVersion;
    }),

  /**
   * Restore a version
   */
  restore: protectedProcedure
    .input(idSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const { id, projectId } = input;

      // Find the version to restore
      const version = await ctx.prisma.llmPromptConfigVersion.findUnique({
        where: { id, projectId },
      });

      if (!version) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Version not found.",
        });
      }

      // Create a new version with the same config data
      const newVersion = await ctx.prisma.llmPromptConfigVersion.create({
        data: {
          commitMessage: `Restore from version ${version.version}`,
          authorId: ctx.session?.user?.id ?? null,
          configId: version.configId,
          schemaVersion: version.schemaVersion,
          projectId: version.projectId,
          // This any shouldn't be needed, but I don't know what is the difference between JsonInputValue and JsonValue
          configData: version.configData as any,
        },
      });

      // Update the parent config's updatedAt timestamp
      await ctx.prisma.llmPromptConfig.update({
        where: { id: version.configId, projectId },
        data: { updatedAt: new Date() },
      });

      return newVersion;
    }),
});

/**
 * Router for handling LLM Prompt Configs
 */
export const llmConfigsRouter = createTRPCRouter({
  versions: llmConfigVersionsRouter,

  /**
   * Get all LLM Prompt Configs for a specific project.
   */
  getPromptConfigs: protectedProcedure
    .input(projectIdSchema)
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      // Get all configs for this project
      return await ctx.prisma.llmPromptConfig.findMany({
        where: {
          projectId: input.projectId,
        },
        orderBy: {
          updatedAt: "desc",
        },
      });
    }),

  /**
   * Get a single LLM Prompt Config by its ID.
   */
  getPromptConfigById: protectedProcedure
    .input(idSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      const config = await ctx.prisma.llmPromptConfig.findUnique({
        where: {
          id: input.id,
          projectId: input.projectId,
        },
        include: {
          versions: {
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
          },
        },
      });

      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt config not found.",
        });
      }

      return config;
    }),

  /**
   * Create a new LLM Prompt Config with its initial version.
   */
  createPromptConfig: protectedProcedure
    .input(baseConfigSchema.merge(baseVersionSchema).merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const { name, configData, schemaVersion, commitMessage, projectId } =
        input;

      // Create the parent config
      const config = await ctx.prisma.llmPromptConfig.create({
        data: {
          name,
          projectId,
        },
      });

      const version = await ctx.prisma.llmPromptConfigVersion.create({
        data: {
          projectId: config.projectId,
          commitMessage: commitMessage ?? "Initial version",
          authorId: ctx.session?.user?.id ?? null,
          configId: config.id,
          configData,
          schemaVersion,
        },
      });

      return {
        ...config,
        projectId,
        latestVersion: version,
      };
    }),

  /**
   * Update an LLM Prompt Config's metadata (name only).
   */
  updatePromptConfig: protectedProcedure
    .input(baseConfigSchema.partial().merge(idSchema).merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      // First, verify the config exists within the project
      const existingConfig = await ctx.prisma.llmPromptConfig.findUnique({
        where: { id: input.id, projectId: input.projectId },
      });

      if (!existingConfig) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt config not found.",
        });
      }

      // Update only the parent config metadata (name)
      const updatedConfig = await ctx.prisma.llmPromptConfig.update({
        where: { id: input.id, projectId: input.projectId },
        data: { name: input.name },
      });

      return updatedConfig;
    }),

  /**
   * Delete an LLM Prompt Config and all its versions.
   */
  deletePromptConfig: protectedProcedure
    .input(idSchema.merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      // Delete the parent config (all versions will be cascade deleted)
      await ctx.prisma.llmPromptConfig.delete({
        where: { id: input.id, projectId: input.projectId },
      });

      return { success: true };
    }),
});
