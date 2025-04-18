import { type PrismaClient, type LlmPromptConfig } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import {
  parseLlmConfigVersion,
  type LatestConfigVersionSchema,
} from "./llm-config-version-schema";
import { LlmConfigVersionsRepository } from "./llm-config-versions.repository";

/**
 * Interface for LLM Config data transfer objects
 */
interface LlmConfigDTO {
  name: string;
  projectId: string;
}

/**
 * Interface for LLM Config Version data transfer objects
 */
type LlmConfigVersionDTO = LatestConfigVersionSchema;

/**
 * Interface for LLM Config with its latest version
 */
export interface LlmConfigWithLatestVersion extends LlmPromptConfig {
  latestVersion: LatestConfigVersionSchema;
}

/**
 * Repository for managing LLM Configurations
 * Follows Single Responsibility Principle by focusing only on LLM config data access
 */
export class LlmConfigRepository {
  public readonly versions: LlmConfigVersionsRepository;

  constructor(
    private readonly prisma: PrismaClient,
    versions = new LlmConfigVersionsRepository(prisma)
  ) {
    this.versions = versions;
  }

  /**
   * Get all LLM configs for a project
   */
  async getAllWithLatestVersion(
    projectId: string
  ): Promise<LlmConfigWithLatestVersion[]> {
    const configs = await this.prisma.llmPromptConfig.findMany({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    return configs.map((config) => {
      if (!config.versions[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt config has no versions.",
        });
      }

      return {
        ...config,
        latestVersion: parseLlmConfigVersion(config.versions[0]),
      };
    });
  }

  /**
   * Get a single LLM config by ID
   */
  async getConfigByIdWithLatestVersions(
    id: string,
    projectId: string
  ): Promise<LlmConfigWithLatestVersion> {
    const config = await this.prisma.llmPromptConfig.findUnique({
      where: { id, projectId },
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
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

    // This should never happen, but if it does, we want to know about it
    if (!config.versions[0]) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Prompt config has no versions.",
      });
    }

    return {
      ...config,
      latestVersion: parseLlmConfigVersion(config.versions[0]),
    };
  }

  /**
   * Create config with no versions
   */
  async createConfig(configData: LlmConfigDTO): Promise<LlmPromptConfig> {
    return this.prisma.llmPromptConfig.create({
      data: {
        name: configData.name,
        projectId: configData.projectId,
      },
    });
  }

  /**
   */
  async initConfig(
    configData: LlmConfigDTO,
    versionData: Omit<LlmConfigVersionDTO, "configId">
  ): Promise<LlmConfigWithLatestVersion> {
    // Create the parent config
    const config = await this.prisma.llmPromptConfig.create({
      data: {
        name: configData.name,
        projectId: configData.projectId,
      },
    });

    // Create the initial version using the versions repository
    const version = await this.versions.createVersion({
      projectId: config.projectId,
      commitMessage: versionData.commitMessage ?? "Initial version",
      authorId: versionData.authorId,
      configId: config.id,
      configData: versionData.configData,
      schemaVersion: versionData.schemaVersion,
    });

    return {
      ...config,
      latestVersion: parseLlmConfigVersion(version),
    };
  }

  /**
   * Update an LLM config's metadata (name only)
   */
  async updateConfig(
    id: string,
    projectId: string,
    data: Partial<LlmConfigDTO>
  ): Promise<LlmPromptConfig> {
    // Verify the config exists
    const existingConfig = await this.prisma.llmPromptConfig.findUnique({
      where: { id, projectId },
    });

    if (!existingConfig) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Prompt config not found.",
      });
    }

    // Update only the parent config metadata
    return this.prisma.llmPromptConfig.update({
      where: { id, projectId },
      data: { name: data.name },
    });
  }

  /**
   * Delete an LLM config and all its versions
   */
  async deleteConfig(
    id: string,
    projectId: string
  ): Promise<{ success: boolean }> {
    await this.prisma.llmPromptConfig.delete({
      where: { id, projectId },
    });

    return { success: true };
  }
}
