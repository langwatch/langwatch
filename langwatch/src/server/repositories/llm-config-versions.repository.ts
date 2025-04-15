import {
  type PrismaClient,
  type LlmPromptConfigVersion,
  type User,
  type LlmPromptConfig,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";

/**
 * Interface for LLM Config Version data transfer objects
 */
interface LlmConfigVersionDTO {
  configId: string;
  projectId: string;
  configData: Record<string, any>;
  schemaVersion: string;
  commitMessage?: string;
  authorId?: string | null;
}

/**
 * Repository for managing LLM Configuration Versions
 * Follows Single Responsibility Principle by focusing only on LLM config versions data access
 */
export class LlmConfigVersionsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get all versions for a specific config
   */
  async getVersions(
    configId: string,
    projectId: string
  ): Promise<(LlmPromptConfigVersion & { author: User | null })[]> {
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
  async getVersionById(
    id: string,
    projectId: string
  ): Promise<
    LlmPromptConfigVersion & { author: User | null; config: LlmPromptConfig }
  > {
    const version = await this.prisma.llmPromptConfigVersion.findFirst({
      where: {
        id,
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
  ): Promise<LlmPromptConfigVersion> {
    // Create the new version
    const version = await this.prisma.llmPromptConfigVersion.create({
      data: {
        commitMessage: versionData.commitMessage,
        authorId: versionData.authorId ?? null,
        configId: versionData.configId,
        configData: versionData.configData,
        schemaVersion: versionData.schemaVersion,
        projectId: versionData.projectId,
      },
    });

    // Update the parent config's updatedAt timestamp
    await this.prisma.llmPromptConfig.update({
      where: { id: versionData.configId, projectId: versionData.projectId },
      data: { updatedAt: new Date() },
    });

    return version;
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
