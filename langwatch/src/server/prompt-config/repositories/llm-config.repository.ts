import {
  type PrismaClient,
  type LlmPromptConfig,
  type PromptScope,
} from "@prisma/client";
import { nanoid } from "nanoid";

import { createLogger } from "../../../utils/logger";
import { NotFoundError } from "../errors";

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
  handle?: string;
  scope?: PromptScope;
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
  async getAllWithLatestVersion({
    projectId,
    organizationId,
  }: {
    projectId: string;
    organizationId: string;
  }): Promise<LlmConfigWithLatestVersion[]> {
    const configs = await this.prisma.llmPromptConfig.findMany({
      where: {
        OR: [{ projectId }, { organizationId, scope: "ORGANIZATION" }],
      },
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
            throw new Error(`Prompt config ${config.id} has no versions.`);
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
   * Get a single LLM config by ID or handle
   */
  async getConfigByIdOrHandleWithLatestVersion(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
  }): Promise<LlmConfigWithLatestVersion> {
    const { idOrHandle, projectId, organizationId } = params;
    const config = await this.prisma.llmPromptConfig.findFirst({
      where: {
        OR: [
          { id: idOrHandle },
          {
            handle: this.createHandle({
              handle: idOrHandle,
              scope: "PROJECT",
              projectId,
            }),
          },
          {
            handle: this.createHandle({
              handle: idOrHandle,
              scope: "ORGANIZATION",
              organizationId,
            }),
          },
        ],
      },
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!config) {
      throw new NotFoundError(
        `Prompt config not found. ID: ${idOrHandle}, Project ID: ${projectId}, Organization ID: ${organizationId}.`
      );
    }

    // This should never happen, but if it does, we want to know about it
    if (!config.versions[0]) {
      throw new NotFoundError(
        `Prompt config has no versions. ID: ${idOrHandle}`
      );
    }

    try {
      return {
        ...config,
        latestVersion: parseLlmConfigVersion(config.versions[0]),
      };
    } catch (error) {
      throw new Error(
        `Failed to parse LLM config version: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
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
      throw new NotFoundError(`Prompt config not found. ID: ${id}`);
    }

    // Update only the parent config metadata
    return this.prisma.llmPromptConfig.update({
      where: { id, projectId },
      data: {
        // Only update if the field is explicitly provided (including null)
        name: "name" in data ? data.name : existingConfig.name,
        handle: "handle" in data ? data.handle : existingConfig.handle,
        scope: "scope" in data ? data.scope : existingConfig.scope,
      },
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
          handle: configData.handle,
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
   * Get prompt by handle
   * @param handle - The handle to search for
   * @param projectId - Optional project ID for scoping
   * @returns The config or null if not found
   */
  async getByHandle(
    handle: string,
    projectId?: string
  ): Promise<LlmConfigWithLatestVersion | null> {
    const whereClause = {
      handle,
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

  /**
   * Creates a fully qualified handle by combining organization, project, and user-provided handle.
   * Format: {projectId}/{handle} or {organizationId}/{handle}
   *
   * This ensures handles are unique across the entire system and provides clear ownership context.
   *
   * @param handle - The user-provided handle
   * @param scope - The scope of the handle (PROJECT or ORGANIZATION)
   * @param projectId - The project ID to fetch organization context
   * @param organizationId - The organization ID to fetch project context
   * @returns Formatted handle string
   */
  createHandle(
    args:
      | {
          handle: string;
          scope: "PROJECT";
          projectId: string;
        }
      | {
          handle: string;
          scope: "ORGANIZATION";
          organizationId: string;
        }
  ): string {
    const { handle, scope } = args;

    if (scope === "ORGANIZATION") {
      return `${args.organizationId}/${handle}`;
    }

    return `${args.projectId}/${handle}`;
  }
}
