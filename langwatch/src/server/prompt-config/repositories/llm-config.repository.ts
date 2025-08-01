import { type PrismaClient, type LlmPromptConfig } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";

import { createLogger } from "../../../utils/logger";

import {
  LATEST_SCHEMA_VERSION,
  parseLlmConfigVersion,
  type LatestConfigVersionSchema,
} from "./llm-config-version-schema";
import { LlmConfigVersionsRepository } from "./llm-config-versions.repository";

const logger = createLogger("langwatch:prompt-config:llm-config.repository");

/**
 * Interface for LLM Config data transfer objects
 */
interface LlmConfigDTO {
  name: string;
  projectId: string;
  authorId?: string;
}

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

    // This is a quick and dirty way to handle the fact that some configs
    // may have been corrupted. They will have to be fixed manually.
    return configs
      .map((config) => {
        try {
          if (!config.versions?.[0]) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `Prompt config ${config.id} has no versions.`,
            });
          }

          return {
            ...config,
            latestVersion: parseLlmConfigVersion(config.versions[0]),
          };
        } catch (error) {
          logger.error(
            { error, configId: config.id },
            "Error parsing LLM config version"
          );
          return null;
        }
      })
      .filter((config) => config !== null) as LlmConfigWithLatestVersion[];
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

    try {
      return {
        ...config,
        latestVersion: parseLlmConfigVersion(config.versions[0]),
      };
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Failed to parse LLM config version: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }
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

  /**
   * Create config with initial version
   *
   * We want to use this method to create a config with an initial version
   * because it ensures that the config and version are created in the same
   * transaction, which is important for maintaining data integrity,
   * and because all configs should have an initial version.
   */
  async createConfigWithInitialVersion(
    configData: LlmConfigDTO
  ): Promise<LlmConfigWithLatestVersion> {
    return await this.prisma.$transaction(async (tx) => {
      // Create the config within the transaction
      const newConfig = await tx.llmPromptConfig.create({
        data: {
          id: `prompt_${nanoid()}`,
          name: configData.name,
          projectId: configData.projectId,
        },
      });

      // Get the default model for the project
      const defaultModel = await tx.project.findUnique({
        where: { id: configData.projectId },
      });

      // Create the initial version within the same transaction
      const newVersion = await tx.llmPromptConfigVersion.create({
        data: {
          id: `prompt_version_${nanoid()}`,
          configId: newConfig.id,
          projectId: configData.projectId,
          authorId: configData.authorId,
          version: 0,
          configData: {
            model: defaultModel?.defaultModel ?? "openai/gpt-4o-mini",
            prompt: "You are a helpful assistant",
            messages: [
              {
                role: "user",
                content: "{{input}}",
              },
            ],
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            demonstrations: {
              columns: [],
              rows: [],
            },
          },
          schemaVersion: LATEST_SCHEMA_VERSION,
          commitMessage: "Initial version",
        },
      });

      // Update the config's updatedAt timestamp
      const updatedConfig = await tx.llmPromptConfig.update({
        where: { id: newConfig.id, projectId: configData.projectId },
        data: { updatedAt: new Date() },
      });

      return {
        ...updatedConfig,
        latestVersion: parseLlmConfigVersion(newVersion),
      };
    });
  }

  /**
   * Get prompt by reference ID
   * @param referenceId - The reference ID to search for
   * @param projectId - Optional project ID for scoping
   * @returns The config or null if not found
   */
  async getByReferenceId(
    referenceId: string,
    projectId?: string
  ): Promise<LlmConfigWithLatestVersion | null> {
    const whereClause = {
      referenceId,
      deletedAt: null,
      ...(projectId && { projectId }),
    };

    const config = await this.prisma.llmPromptConfig.findFirst({
      where: whereClause,
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!config || !config.versions[0]) {
      return null;
    }

    return {
      ...config,
      latestVersion: parseLlmConfigVersion(config.versions[0]),
    };
  }
}
