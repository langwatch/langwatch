import {
  type PrismaClient,
  type LlmPromptConfig,
  type LlmPromptConfigVersion,
  type User,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
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
interface LlmConfigVersionDTO {
  configId: string;
  projectId: string;
  configData: Record<string, any>;
  schemaVersion: string;
  commitMessage?: string;
  authorId?: string | null;
}

/**
 * Interface for LLM Config with its latest version
 */
interface LlmConfigWithLatestVersion extends LlmPromptConfig {
  latestVersion: LlmPromptConfigVersion;
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
  async getAllConfigs(projectId: string): Promise<LlmPromptConfig[]> {
    return this.prisma.llmPromptConfig.findMany({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
    });
  }

  /**
   * Get a single LLM config by ID
   */
  async getConfigById(
    id: string,
    projectId: string
  ): Promise<LlmPromptConfig & { versions: LlmPromptConfigVersion[] }> {
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

    return config;
  }

  /**
   * Create a new LLM config with its initial version
   */
  async createConfig(
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
    const version = await this.versionsRepository.createVersion({
      projectId: config.projectId,
      commitMessage: versionData.commitMessage ?? "Initial version",
      authorId: versionData.authorId ?? null,
      configId: config.id,
      configData: versionData.configData,
      schemaVersion: versionData.schemaVersion,
    });

    return {
      ...config,
      latestVersion: version,
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
