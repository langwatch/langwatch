import {
  type PrismaClient,
  type LlmPromptConfig,
  type LlmPromptConfigVersion,
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
