import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { nanoid } from "nanoid";
import { TeamRoleGroup } from "../permission";
import { checkUserPermissionForProject } from "../permission";

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

export const llmConfigsRouter = createTRPCRouter({
  /**
   * Get all LLM Prompt Configs for a specific project.
   */
  getPromptConfigs: protectedProcedure
    .input(projectIdSchema)
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      // Get all configs for this project
      const configs = await ctx.prisma.llmPromptConfig.findMany({
        where: {
          projectId: input.projectId,
        },
        orderBy: {
          updatedAt: "desc",
        },
      });

      // For each config, get its latest version (if any)
      const configsWithLatestVersion = await Promise.all(
        configs.map(async (config) => {
          const latestVersion =
            await ctx.prisma.llmPromptConfigVersion.findFirst({
              where: {
                configId: config.id,
              },
              orderBy: {
                createdAt: "desc",
              },
            });

          return {
            ...config,
            latestVersion,
          };
        })
      );

      return configsWithLatestVersion;
    }),

  /**
   * Get a single LLM Prompt Config by its ID.
   */
  getPromptConfigById: protectedProcedure
    .input(idSchema.merge(projectIdSchema)) // Need projectId for permission check
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      const config = await ctx.prisma.llmPromptConfig.findUnique({
        where: {
          id: input.id,
          projectId: input.projectId, // Ensure it belongs to the correct project
        },
      });

      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt config not found.",
        });
      }

      // Get the latest version
      const latestVersion = await ctx.prisma.llmPromptConfigVersion.findFirst({
        where: {
          configId: config.id,
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

      return {
        ...config,
        latestVersion,
      };
    }),

  /**
   * Get all versions for a specific config.
   */
  getPromptConfigVersions: protectedProcedure
    .input(configIdSchema.merge(projectIdSchema)) // Need both for permission check
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
  getPromptConfigVersionById: protectedProcedure
    .input(idSchema.merge(projectIdSchema)) // Version ID and projectId
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      // Find the version, but join to config to check project permission
      const version = await ctx.prisma.llmPromptConfigVersion.findFirst({
        where: {
          id: input.id,
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
          id: `llmcfg_${nanoid()}`,
          name,
          projectId,
        },
      });

      // Create the initial version (v1)
      const version = await ctx.prisma.llmPromptConfigVersion.create({
        data: {
          id: `llmver_${nanoid()}`,
          version: "1", // Initial version is always "1"
          commitMessage: commitMessage || "Initial version",
          authorId: ctx.session?.user?.id || null,
          configId: config.id,
          configData,
          schemaVersion,
        },
      });

      return {
        ...config,
        latestVersion: version,
      };
    }),

  /**
   * Create a new version for an existing config.
   */
  createPromptConfigVersion: protectedProcedure
    .input(baseVersionSchema.merge(configIdSchema).merge(projectIdSchema))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const { configData, schemaVersion, commitMessage, configId, projectId } =
        input;

      // First, verify the config exists within the project
      const config = await ctx.prisma.llmPromptConfig.findUnique({
        where: { id: configId, projectId },
      });

      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt config not found.",
        });
      }

      // Find the maximum version to determine next version number
      const maxVersionResult =
        await ctx.prisma.llmPromptConfigVersion.findFirst({
          where: { configId },
          orderBy: { version: "desc" },
          select: { version: true },
        });

      // Parse the current max version and increment
      let nextVersion = "1";
      if (maxVersionResult) {
        // Assuming versions are numeric strings
        const currentMaxVersion = parseInt(maxVersionResult.version, 10);
        if (!isNaN(currentMaxVersion)) {
          nextVersion = (currentMaxVersion + 1).toString();
        }
      }

      // Create the new version
      const version = await ctx.prisma.llmPromptConfigVersion.create({
        data: {
          id: `llmver_${nanoid()}`,
          version: nextVersion,
          commitMessage,
          authorId: ctx.session?.user?.id || null,
          configId,
          configData,
          schemaVersion,
        },
      });

      // Update the parent config's updatedAt timestamp
      await ctx.prisma.llmPromptConfig.update({
        where: { id: configId },
        data: { updatedAt: new Date() },
      });

      return version;
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
        where: { id: input.id },
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

      // Delete the parent config (all versions will be cascade deleted)
      await ctx.prisma.llmPromptConfig.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  /**
   * Get the latest version for a config (helper)
   */
  getLatestPromptConfigVersion: protectedProcedure
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
        where: { configId: input.configId },
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
});
