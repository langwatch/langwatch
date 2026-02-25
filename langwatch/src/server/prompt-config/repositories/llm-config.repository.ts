import type {
  LlmPromptConfig,
  LlmPromptConfigVersion,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { DEFAULT_MODEL } from "~/utils/constants";
import { createLogger } from "../../../utils/logger/server";
import { SchemaVersion } from "../enums";
import { NotFoundError } from "../errors";
import {
  getSchemaValidator,
  LATEST_SCHEMA_VERSION,
  type LatestConfigVersionSchema,
  parseLlmConfigVersion,
} from "./llm-config-version-schema";
import {
  type CreateLlmConfigVersionParams,
  LlmConfigVersionsRepository,
} from "./llm-config-versions.repository";

const logger = createLogger("langwatch:prompt-config:llm-config.repository");

/**
 * Interface for LLM Config data transfer objects
 */
export type CreateLlmConfigParams = Omit<
  LlmPromptConfig,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
> & {
  // Optional authorId to set on the config and version.
  // This is optional because it's not required for the config to be created,
  // and wouldn't be available via the API.
  authorId?: string;
};

/**
 * Interface for LLM Config with its latest version
 */
export interface LlmConfigWithLatestVersion extends LlmPromptConfig {
  latestVersion: LatestConfigVersionSchema & {
    author?: { name: string } | null;
  };
  _count?: {
    copiedPrompts?: number;
  } | null;
}

/**
 * Repository for managing LLM Configurations
 * Follows Single Responsibility Principle by focusing only on LLM config data access
 */
export class LlmConfigRepository {
  public readonly versions: LlmConfigVersionsRepository;

  constructor(
    private readonly prisma: PrismaClient,
    versions = new LlmConfigVersionsRepository(prisma),
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
        deletedAt: null,
        OR: [{ projectId }, { organizationId, scope: "ORGANIZATION" }],
      },
      orderBy: { updatedAt: "desc" },
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
          include: {
            author: {
              select: {
                name: true,
                id: true,
              },
            },
          },
          take: 1,
        },
        _count: {
          select: {
            copiedPrompts: true,
          },
        },
      },
    });

    // This is a quick and dirty way to handle the fact that some configs
    // may have been corrupted. They will have to be fixed manually.
    return configs
      .map((config) => {
        try {
          config.handle = this.removeHandlePrefixes(
            config.handle,
            projectId,
            organizationId,
          );

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
            "Error parsing LLM config version",
          );
          return null;
        }
      })
      .filter((config) => config !== null);
  }

  /**
   * Get prompt by id or handle
   */
  async getPromptByIdOrHandle(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
  }): Promise<LlmPromptConfig | null> {
    const { idOrHandle, projectId, organizationId } = params;

    return await this.prisma.llmPromptConfig.findFirst({
      where: {
        OR: [
          {
            projectId,
            OR: [
              { id: idOrHandle },
              {
                handle: this.createHandle({
                  handle: idOrHandle,
                  scope: "PROJECT",
                  projectId,
                }),
              },
            ],
          },
          {
            organizationId,
            scope: "ORGANIZATION",
            OR: [
              { id: idOrHandle },
              {
                handle: this.createHandle({
                  handle: idOrHandle,
                  scope: "ORGANIZATION",
                  organizationId,
                }),
              },
            ],
          },
        ],
      },
    });
  }

  /**
   * Get a single LLM config by ID or handle, either at project or organization level
   */
  async getConfigByIdOrHandleWithLatestVersion(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
    version?: number;
    versionId?: string;
  }): Promise<LlmConfigWithLatestVersion | null> {
    const { idOrHandle, projectId, organizationId } = params;
    const where: Prisma.LlmPromptConfigVersionWhereInput = {};

    if (params.version) {
      where.version = params.version;
    }

    if (params.versionId) {
      where.id = params.versionId;
    }

    if (params.version && params.versionId) {
      throw new Error("Cannot specify both version and versionId");
    }

    const config = await this.prisma.llmPromptConfig.findFirst({
      where: {
        OR: [
          {
            projectId,
            OR: [
              { id: idOrHandle },
              {
                handle: this.createHandle({
                  handle: idOrHandle,
                  scope: "PROJECT",
                  projectId,
                }),
              },
            ],
          },
          {
            organizationId,
            scope: "ORGANIZATION",
            OR: [
              { id: idOrHandle },
              {
                handle: this.createHandle({
                  handle: idOrHandle,
                  scope: "ORGANIZATION",
                  organizationId,
                }),
              },
            ],
          },
        ],
      },
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
          where,
          take: 1,
        },
      },
    });

    if (!config) {
      return null;
    }

    // This should never happen, but if it does, we want to know about it
    if (!config.versions[0]) {
      if (params.version) {
        throw new NotFoundError(
          `Prompt version ${params.version} not found for prompt ${idOrHandle}`,
        );
      } else if (params.versionId) {
        throw new NotFoundError(
          `Prompt version ID ${params.versionId} not found for prompt ${idOrHandle}`,
        );
      } else {
        throw new NotFoundError(
          `Prompt config has no versions. ID: ${idOrHandle}`,
        );
      }
    }

    config.handle = this.removeHandlePrefixes(
      config.handle,
      projectId,
      organizationId,
    );

    try {
      return {
        ...config,
        latestVersion: parseLlmConfigVersion(config.versions[0]),
      };
    } catch (error) {
      throw new Error(
        `Failed to parse LLM config version: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  /**
   * Update an LLM config's metadata (name only)
   */
  async updateConfig(
    idOrHandle: string,
    projectId: string,
    data: Partial<CreateLlmConfigParams>,
    options?: {
      tx?: Prisma.TransactionClient;
    },
  ): Promise<LlmPromptConfig> {
    const { tx } = options ?? {};
    const client = tx ?? this.prisma;
    // Get organizationId first using the proper approach
    const project = await client.project.findUnique({
      where: { id: projectId },
      include: {
        team: {
          include: { organization: true },
        },
      },
    });

    const organizationId = project?.team?.organization.id;

    if (!organizationId) {
      throw new NotFoundError(
        `Organization not found. Project ID: ${projectId}`,
      );
    }

    // Verify the config exists
    const existingConfig = await this.getPromptByIdOrHandle({
      idOrHandle,
      projectId,
      organizationId,
    });

    if (!existingConfig) {
      throw new NotFoundError(`Prompt config not found. ID: ${idOrHandle}`);
    }

    // Format handle with organization/project context if provided
    if (data.handle) {
      if (!existingConfig.organizationId) {
        // TODO: perhaps organizationId should be NOT NULL across the whole table
        throw new Error("Organization ID is required to update handle");
      }

      data.handle = this.createHandle({
        handle: data.handle,
        scope: data.scope ?? existingConfig.scope,
        projectId,
        organizationId: existingConfig.organizationId,
      });
    }

    const updatedConfig = await client.llmPromptConfig.update({
      where: { id: existingConfig.id, projectId },
      data: {
        // Only update if the field is explicitly provided (including null)
        name: "name" in data ? data.name : existingConfig.name,
        handle: "handle" in data ? data.handle : existingConfig.handle,
        scope: "scope" in data ? data.scope : existingConfig.scope,
      },
    });

    // Remove handle prefixes
    updatedConfig.handle = this.removeHandlePrefixes(
      updatedConfig.handle,
      projectId,
      existingConfig.organizationId,
    );

    return updatedConfig;
  }

  /**
   * Delete an LLM config and all its versions
   *
   * NOTE: This will only delete the config if the provided projectId matches the config's projectId
   * otherwise it will throw.
   */
  async deleteConfig(
    idOrHandle: string,
    projectId: string,
    organizationId: string,
  ): Promise<{ success: boolean }> {
    const config = await this.getConfigByIdOrHandleWithLatestVersion({
      idOrHandle,
      projectId,
      organizationId,
    });

    if (!config) {
      throw new NotFoundError(`Prompt config not found. ID: ${idOrHandle}`);
    }

    const isProjectMatch = config.projectId === projectId;
    if (!isProjectMatch) {
      throw new Error(
        `Project ID mismatch. Config projectId: ${config.projectId} does not match requested projectId: ${projectId}`,
      );
    }

    // Soft-delete: set deletedAt instead of hard-deleting, so existing
    // suite references can still identify the prompt as deleted.
    await this.prisma.llmPromptConfig.update({
      where: { id: config.id, projectId },
      data: { deletedAt: new Date() },
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
   * @deprecated This is a bad pattern. We should only create drafts via the UI/API/Clients.
   */
  async createConfigWithInitialVersion(params: {
    configData: CreateLlmConfigParams;
    /**
     * If no version data is provided, we'll create a default version.
     * If version data is provided, we'll use it to create the initial version.
     *
     * The version data should not include the configId, or projectId.
     * These will be set automatically from the newly created config.
     */
    versionData?: Omit<
      CreateLlmConfigVersionParams,
      "configId" | "projectId"
    > & {
      prompt?: string;
    };
  }): Promise<LlmConfigWithLatestVersion> {
    const { configData, versionData } = params;

    // Sanity check on the authorId
    if (
      versionData?.authorId &&
      configData?.authorId !== versionData.authorId
    ) {
      throw new Error("Author ID mismatch between config and version data");
    }

    if (configData.handle) {
      configData.handle = this.createHandle({
        handle: configData.handle,
        scope: configData.scope,
        projectId: configData.projectId,
        organizationId: configData.organizationId,
      });
    }

    return await this.prisma.$transaction(async (tx) => {
      // Create the config within the transaction
      const newConfig = await tx.llmPromptConfig.create({
        data: {
          id: this.generateConfigId(),
          name: configData.name ?? "",
          projectId: configData.projectId,
          organizationId: configData.organizationId,
          handle: configData.handle,
          scope: configData.scope,
        },
        include: {
          project: true,
        },
      });
      const { project } = newConfig;
      const defaultModel = project.defaultModel ?? DEFAULT_MODEL;

      // Set the version data to the provided version data, or undefined if no version data is provided.
      let newVersionData: Partial<CreateLlmConfigVersionParams> | undefined =
        versionData;

      // If no version data is provided, we'll create a default (draft) version.
      if (!newVersionData) {
        const configData = this.buildDefaultVersionConfigData({
          model: defaultModel,
        });

        newVersionData = {
          configData,
          schemaVersion: LATEST_SCHEMA_VERSION,
          commitMessage: "Initial version",
        };
      }

      // Ensure a model is set if configData is provided
      if (newVersionData.configData && !newVersionData.configData.model) {
        newVersionData.configData.model = defaultModel;
      }

      const newVersion = await tx.llmPromptConfigVersion.create({
        data: {
          ...newVersionData,
          version: 1,
          configData: newVersionData.configData as Prisma.InputJsonValue,
          id: this.versions.generateVersionId(),
          configId: newConfig.id,
          projectId: newConfig.projectId,
          authorId: configData.authorId ?? null,
          schemaVersion: newVersionData.schemaVersion ?? LATEST_SCHEMA_VERSION,
        },
      });

      // Update the config's updatedAt timestamp
      const updatedConfig = await tx.llmPromptConfig.update({
        where: { id: newConfig.id, projectId: configData.projectId },
        data: { updatedAt: new Date() },
      });

      updatedConfig.handle = this.removeHandlePrefixes(
        updatedConfig.handle,
        configData.projectId,
        configData.organizationId,
      );

      return {
        ...updatedConfig,
        latestVersion: parseLlmConfigVersion(newVersion),
      };
    });
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
        },
  ): string {
    const { handle, scope } = args;

    if (scope === "ORGANIZATION") {
      return `${args.organizationId}/${handle}`;
    }

    return `${args.projectId}/${handle}`;
  }

  removeHandlePrefixes(
    handle: string | null,
    projectId: string,
    organizationId: string,
  ): string | null {
    if (!handle) {
      return null;
    }

    if (handle.startsWith(`${projectId}/`)) {
      return handle.slice(projectId.length + 1);
    }

    if (handle.startsWith(`${organizationId}/`)) {
      return handle.slice(organizationId.length + 1);
    }

    return handle;
  }

  /**
   * Get a specific version by version number for a config
   */
  async getConfigVersionByNumber(params: {
    idOrHandle: string;
    versionNumber: number;
    projectId: string;
    organizationId: string;
  }): Promise<LlmPromptConfigVersion | null> {
    const { idOrHandle, versionNumber, projectId, organizationId } = params;

    const config = await this.getConfigByIdOrHandleWithLatestVersion({
      idOrHandle,
      projectId,
      organizationId,
    });

    if (!config) {
      return null;
    }

    return this.prisma.llmPromptConfigVersion.findFirst({
      where: {
        configId: config.id,
        projectId,
        version: versionNumber,
      },
    });
  }

  /**
   * Check if user has permission to modify a prompt
   */
  async checkModifyPermission(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
  }): Promise<{ hasPermission: boolean; reason?: string }> {
    const { idOrHandle, projectId, organizationId } = params;

    const config = await this.getConfigByIdOrHandleWithLatestVersion({
      idOrHandle,
      projectId,
      organizationId,
    });

    if (!config) {
      return { hasPermission: true }; // Can create new
    }

    // If it's an organization-level prompt but not created by this project
    if (config.scope === "ORGANIZATION" && config.projectId !== projectId) {
      return {
        hasPermission: false,
        reason:
          "Only the project that created this organization-level prompt can modify it",
      };
    }

    return { hasPermission: true };
  }

  /**
   * Compare two config data objects for content equality
   * Uses Zod schema normalization to ensure strict structural comparison
   */
  compareConfigContent(
    config1: unknown,
    config2: unknown,
  ): { isEqual: boolean; differences?: string[] } {
    try {
      // Get the configData schema for normalization
      const schemaValidator = getSchemaValidator(SchemaVersion.V1_0);
      const configDataSchema = schemaValidator.shape.configData;

      // Normalize both configs using Zod parsing - this ensures:
      // 1. Consistent field ordering
      // 2. Type coercion and validation
      // 3. Removal of extra fields not in schema
      // 4. Default value application
      const parseResult1 = configDataSchema.safeParse(config1);
      const parseResult2 = configDataSchema.safeParse(config2);

      // If either config fails validation, they can't be equal
      if (!parseResult1.success || !parseResult2.success) {
        const differences: string[] = [];
        if (!parseResult1.success) {
          differences.push(
            "config1 validation failed: " + parseResult1.error.message,
          );
        }
        if (!parseResult2.success) {
          differences.push(
            "config2 validation failed: " + parseResult2.error.message,
          );
        }
        return { isEqual: false, differences };
      }

      const normalized1 = parseResult1.data;
      const normalized2 = parseResult2.data;

      // Compare normalized configs using deterministic JSON serialization
      const json1 = JSON.stringify(
        normalized1,
        Object.keys(normalized1).sort(),
        2,
      );
      const json2 = JSON.stringify(
        normalized2,
        Object.keys(normalized2).sort(),
        2,
      );

      const isEqual = json1 === json2;

      if (!isEqual) {
        // Enhanced difference detection using normalized configs
        const differences: string[] = [];

        // TODO: move this to a more git diff kinda of approach
        if (normalized1.model !== normalized2.model) {
          differences.push(
            `model: ${normalized1.model} → ${normalized2.model}`,
          );
        }
        if (normalized1.prompt !== normalized2.prompt) {
          differences.push("prompt content differs");
        }
        if (
          JSON.stringify(normalized1.messages) !==
          JSON.stringify(normalized2.messages)
        ) {
          differences.push("messages differ");
        }
        if (
          JSON.stringify(normalized1.inputs) !==
          JSON.stringify(normalized2.inputs)
        ) {
          differences.push("inputs differ");
        }
        if (
          JSON.stringify(normalized1.outputs) !==
          JSON.stringify(normalized2.outputs)
        ) {
          differences.push("outputs differ");
        }
        if (normalized1.temperature !== normalized2.temperature) {
          differences.push(
            `temperature: ${normalized1.temperature} → ${normalized2.temperature}`,
          );
        }
        if (normalized1.max_tokens !== normalized2.max_tokens) {
          differences.push(
            `max_tokens: ${normalized1.max_tokens} → ${normalized2.max_tokens}`,
          );
        }

        return { isEqual: false, differences };
      }

      return { isEqual: true };
    } catch (error) {
      logger.error({ error }, "Error comparing config content");
      // If comparison fails, assume they're different
      return {
        isEqual: false,
        differences: [
          "Unable to compare configs: " +
            (error instanceof Error ? error.message : "Unknown error"),
        ],
      };
    }
  }

  /**
   * Checks whether a non-deleted LLM prompt config exists for the given id,
   * accessible from the specified project or organization (org-scoped).
   */
  async existsForProjectOrOrg(params: {
    id: string;
    projectId: string;
    organizationId: string;
  }): Promise<boolean> {
    const config = await this.prisma.llmPromptConfig.findFirst({
      where: {
        id: params.id,
        deletedAt: null,
        OR: [
          { projectId: params.projectId },
          { organizationId: params.organizationId, scope: "ORGANIZATION" },
        ],
      },
      select: { id: true },
    });
    return config !== null;
  }

  private generateConfigId() {
    return `prompt_${nanoid()}`;
  }

  /**
   * Build a default version base for a config
   */
  private buildDefaultVersionConfigData(
    params: Record<string, unknown>,
  ): CreateLlmConfigVersionParams["configData"] {
    return {
      prompt: "You are a helpful assistant",
      model: "openai/gpt-5.2",
      messages: [
        {
          role: "user",
          content: "{{input}}",
        },
      ],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      demonstrations: {
        inline: {
          records: {},
          columnTypes: [],
        },
      },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "response",
          schema: { type: "str" },
        },
      },
      ...params,
    };
  }
}
