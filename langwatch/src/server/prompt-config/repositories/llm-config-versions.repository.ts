import {
  type PrismaClient,
  type LlmPromptConfigVersion,
  type User,
  type LlmPromptConfig,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";

import {
  type LatestConfigVersionSchema,
  type SchemaVersion,
  parseLlmConfigVersion,
} from "./llm-config-version-schema";

/**
 * Interface for LLM Config Version data transfer objects
 */
export type LlmConfigVersionDTO = LatestConfigVersionSchema;

/**
 * Repository for managing LLM Configuration Versions
 * Follows Single Responsibility Principle by focusing only on LLM config versions data access
 */
export class LlmConfigVersionsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get all versions for a specific config
   */
  async getVersions({
    configId,
    projectId,
  }: {
    configId: string;
    projectId: string;
  }): Promise<(LlmPromptConfigVersion & { author: User | null })[]> {
    // Verify the config exists
    const config = await this.prisma.llmPromptConfig.findUnique({
      where: { id: configId, projectId },
    });

    if (!config) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Prompt config not found.",
      });
    }

    // Get all versions
    return this.prisma.llmPromptConfigVersion.findMany({
      where: { configId, projectId },
      orderBy: { createdAt: "desc" },
      include: {
        author: true,
      },
    });
  }

  /**
   * Get a specific version by ID
   */
  async getVersionById({
    versionId,
    projectId,
  }: {
    versionId: string;
    projectId: string;
  }): Promise<
    LlmPromptConfigVersion & { author: User | null; config: LlmPromptConfig }
  > {
    const version = await this.prisma.llmPromptConfigVersion.findFirst({
      where: {
        id: versionId,
        projectId,
        config: { projectId },
      },
      include: {
        author: true,
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
  }

  /**
   * Get the latest version for a config
   */
  async getLatestVersion(
    configId: string,
    projectId: string
  ): Promise<LlmPromptConfigVersion & { author: User | null }> {
    // Verify the config exists
    const config = await this.prisma.llmPromptConfig.findUnique({
      where: { id: configId, projectId },
    });

    if (!config) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Prompt config not found.",
      });
    }

    // Get the latest version
    const latestVersion = await this.prisma.llmPromptConfigVersion.findFirst({
      where: { configId, projectId },
      orderBy: { createdAt: "desc" },
      include: {
        author: true,
      },
    });

    if (!latestVersion) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No versions found for this config.",
      });
    }

    return latestVersion;
  }

  /**
   * Create a new version for an existing config
   */
  async createVersion(
    versionData: LlmConfigVersionDTO
  ): Promise<LlmPromptConfigVersion & { schemaVersion: SchemaVersion }> {
    // Validate the config data
    parseLlmConfigVersion(versionData);
    // Create the new version
    const version = await this.prisma.llmPromptConfigVersion.create({
      data: versionData,
    });

    // Update the parent config's updatedAt timestamp
    const { configId, projectId } = versionData;
    await this.prisma.llmPromptConfig.update({
      where: { id: configId, projectId },
      data: { updatedAt: new Date() },
    });

    return {
      ...version,
      schemaVersion: version.schemaVersion as SchemaVersion,
    };
  }

  /**
   * Restore a version by creating a new version with the same config data
   */
  async restoreVersion(
    id: string,
    projectId: string,
    authorId: string | null
  ): Promise<LlmPromptConfigVersion> {
    // Find the version to restore
    const version = await this.prisma.llmPromptConfigVersion.findUnique({
      where: { id, projectId },
    });

    if (!version) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Version not found.",
      });
    }

    // Create a new version with the same config data
    const newVersion = await this.prisma.llmPromptConfigVersion.create({
      data: {
        commitMessage: `Restore from version ${version.version}`,
        authorId,
        configId: version.configId,
        schemaVersion: version.schemaVersion,
        projectId: version.projectId,
        configData: version.configData as Record<string, any>,
      },
    });

    // Update the parent config's updatedAt timestamp
    await this.prisma.llmPromptConfig.update({
      where: { id: version.configId, projectId },
      data: { updatedAt: new Date() },
    });

    return newVersion;
  }
}
