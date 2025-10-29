import {
  type Prisma,
  type PrismaClient,
  type PromptScope,
  type LlmPromptConfigVersion,
} from "@prisma/client";
import { type z } from "zod";

import { SchemaVersion } from "./enums";
import { NotFoundError, SystemPromptConflictError } from "./errors";
import { PromptVersionService } from "./prompt-version.service";
import {
  type CreateLlmConfigParams,
  type CreateLlmConfigVersionParams,
  LlmConfigRepository,
  type LlmConfigWithLatestVersion,
} from "./repositories";
import {
  type getLatestConfigVersionSchema,
  LATEST_SCHEMA_VERSION,
  type LatestConfigVersionSchema,
} from "./repositories/llm-config-version-schema";

import {
  type inputsSchema,
  type messageSchema,
  type outputsSchema,
  type promptingTechniqueSchema,
} from "~/prompt-configs/schemas/field-schemas";

// Extract the configData type from the schema
type ConfigData = z.infer<
  ReturnType<typeof getLatestConfigVersionSchema>
>["configData"];

/**
 * Full prompt shape that combines prompt config with version data.
 * This is the complete shape that should be returned to API consumers.
 * Uses camelCase for professional external API.
 */
export type VersionedPrompt = {
  id: string;
  /**
   * @deprecated Use handle instead
   */
  name: string;
  handle: string | null;
  scope: PromptScope;
  version: number;
  versionId: string;
  versionCreatedAt: Date;
  model: string;
  temperature?: number;
  maxTokens?: number;
  prompt: string;
  projectId: string;
  organizationId: string;
  messages: Array<{
    role: LatestConfigVersionSchema["configData"]["messages"][number]["role"];
    content: string;
  }>;
  authorId: string | null;
  author?: {
    id: string;
    name: string;
  } | null;
  inputs: LatestConfigVersionSchema["configData"]["inputs"];
  outputs: LatestConfigVersionSchema["configData"]["outputs"];
  responseFormat?: LatestConfigVersionSchema["configData"]["response_format"];
  demonstrations?: LatestConfigVersionSchema["configData"]["demonstrations"];
  promptingTechnique?: LatestConfigVersionSchema["configData"]["prompting_technique"];
  commitMessage?: string;
  updatedAt: Date;
  createdAt: Date;
};

/**
 * Service layer for managing LLM prompt configurations.
 * Handles business logic for prompt operations including handle formatting.
 */
export class PromptService {
  readonly repository: LlmConfigRepository;
  readonly versionService: PromptVersionService;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = new LlmConfigRepository(prisma);
    this.versionService = new PromptVersionService(prisma);
  }

  /**
   * Get all prompts for a project
   */
  async getAllPrompts(params: {
    projectId: string;
    organizationId?: string;
    version?: "latest" | "all";
  }): Promise<VersionedPrompt[]> {
    const { projectId } = params;

    const organizationId =
      params.organizationId ??
      (await this.getOrganizationIdFromProjectId(projectId));

    const configs = await this.repository.getAllWithLatestVersion({
      projectId,
      organizationId,
    });

    return configs.map((config) => this.transformToVersionedPrompt(config));
  }

  /**
   * Gets a prompt by ID or handle.
   * If a handle is provided, it will be formatted with the organization and project context.
   *
   * @param params - The parameters object
   * @param params.idOrHandle - The ID or handle of the prompt
   * @param params.projectId - The project ID for authorization and context
   * @returns The prompt configuration
   */
  async getPromptByIdOrHandle(params: {
    idOrHandle: string;
    projectId: string;
    version?: number;
    organizationId?: string;
    versionId?: string;
  }): Promise<VersionedPrompt | null> {
    const { idOrHandle, projectId } = params;
    const organizationId =
      params.organizationId ??
      (await this.getOrganizationIdFromProjectId(projectId));
    const config = await this.repository.getConfigByIdOrHandleWithLatestVersion(
      {
        idOrHandle,
        projectId,
        organizationId,
        version: params.version,
        versionId: params.versionId,
      },
    );

    if (!config) {
      return null;
    }

    return this.transformToVersionedPrompt(config);
  }

  /**
   * Get all versions for a prompt
   */
  async getAllVersions(params: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<VersionedPrompt[]> {
    // If no organizationId is provided, get it from the projectId
    const organizationId: string =
      params.organizationId ??
      (await this.getOrganizationIdFromProjectId(params.projectId));

    // Get the config
    const config = await this.repository.getPromptByIdOrHandle({
      idOrHandle: params.idOrHandle,
      projectId: params.projectId,
      organizationId,
    });

    // If the config doesn't exist, return an empty array
    if (!config) {
      throw new NotFoundError("Prompt not found");
    }

    // Get the versions
    const versions =
      (await this.repository.versions.getVersionsForConfigByIdOrHandle({
        idOrHandle: params.idOrHandle,
        projectId: params.projectId,
        organizationId,
      })) as LatestConfigVersionSchema[];

    return versions.map((version) =>
      this.transformToVersionedPrompt({
        ...config,
        latestVersion: version,
      }),
    );
  }

  /**
   * Creates a new prompt configuration with an initial version.
   * Will create a default version if no version data is provided.
   *
   * @param params - The parameters object
   * @param params.name - The name of the prompt (do not use this, use handle instead)
   * @param params.projectId - The project ID for authorization and context
   * @param params.organizationId - The organization ID for authorization and context
   * @param params.handle - The handle of the prompt (also used as name)
   * @param params.scope - The scope of the prompt (defaults to "PROJECT")
   * @param params.authorId - Optional author ID for the initial version
   * @param params.configData - Optional initial configuration data
   * @param params.schemaVersion - Optional schema version (defaults to latest)
   * @returns The created prompt configuration with its initial version
   */
  async createPrompt(params: {
    // Config data
    projectId: string;
    organizationId?: string;
    handle: string;
    scope?: PromptScope;
    // Version data
    authorId?: string;
    prompt?: string;
    messages?: z.infer<typeof messageSchema>[];
    inputs?: z.infer<typeof inputsSchema>[];
    outputs?: z.infer<typeof outputsSchema>[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    promptingTechnique?: z.infer<typeof promptingTechniqueSchema>;
    demonstrations?: LatestConfigVersionSchema["configData"]["demonstrations"];
    responseFormat?: LatestConfigVersionSchema["configData"]["response_format"];
    commitMessage?: string | null;
  }): Promise<VersionedPrompt> {
    const organizationId =
      params.organizationId ??
      (await this.getOrganizationIdFromProjectId(params.projectId));
    // If any of the version data is provided,
    // we should create a version from that data
    // and it's not consideered a draft
    const shouldCreateVersion = Boolean(
      params.prompt !== undefined ||
        params.messages !== undefined ||
        params.inputs !== undefined ||
        params.outputs !== undefined ||
        params.model !== undefined ||
        params.temperature !== undefined ||
        params.maxTokens !== undefined ||
        params.promptingTechnique !== undefined ||
        params.demonstrations !== undefined ||
        params.responseFormat !== undefined,
    );

    shouldCreateVersion &&
      this.versionService.assertNoSystemPromptConflict({
        prompt: params.prompt,
        messages: params.messages,
      });

    // Normalize system message into prompt
    const normalizedCreate = this.normalizeSystemMessage({
      prompt: params.prompt,
      messages: params.messages,
    });
    params.prompt = normalizedCreate.prompt;
    params.messages = normalizedCreate.messages as unknown as
      | Array<{
          role: "user" | "assistant" | "system";
          content: string;
        }>
      | undefined;

    if (!normalizedCreate.prompt && !params.prompt) {
      throw new SystemPromptConflictError(
        "A system prompt is required when creating a prompt",
      );
    }

    const config = await this.repository.createConfigWithInitialVersion({
      configData: {
        name: params.handle,
        handle: params.handle ?? null,
        projectId: params.projectId,
        organizationId,
        scope: params.scope ?? "PROJECT",
        authorId: params.authorId,
      },
      versionData: shouldCreateVersion
        ? {
            configData: this.transformToDbFormat({
              prompt: params.prompt,
              messages: params.messages,
              inputs: params.inputs ?? [{ identifier: "input", type: "str" }],
              outputs: params.outputs ?? [
                { identifier: "output", type: "str" },
              ],
              model: params.model,
              temperature: params.temperature,
              maxTokens: params.maxTokens,
              promptingTechnique: params.promptingTechnique,
              demonstrations: params.demonstrations,
              responseFormat: params.responseFormat,
            }) as LatestConfigVersionSchema["configData"],
            schemaVersion: LATEST_SCHEMA_VERSION,
            commitMessage: params.commitMessage ?? "Initial version",
            authorId: params.authorId ?? null,
            version: 1,
          }
        : undefined,
    });

    return this.transformToVersionedPrompt(config);
  }

  /**
   * Normalize system message rules for prompt/messages.
   * Single Responsibility: Ensure system content lives in prompt and is removed from messages.
   */
  private normalizeSystemMessage(data: {
    prompt?: string;
    messages?: Array<{ role: string; content: string }> | undefined;
  }): { prompt?: string; messages?: Array<{ role: string; content: string }> } {
    const messageSystemPrompt = data.messages?.find(
      (msg) => msg.role === "system",
    )?.content;
    const normalized: {
      prompt?: string;
      messages?: Array<{ role: string; content: string }>;
    } = { ...data };
    if (messageSystemPrompt) {
      normalized.prompt = normalized.prompt ?? messageSystemPrompt;
      normalized.messages = (normalized.messages ?? []).filter(
        (msg) => msg.role !== "system",
      );
    }
    return normalized;
  }

  // Draft persistence removed (client-only draft creation/update)

  /**
   * Updates only the prompt's handle and scope without creating a new version.
   * Single Responsibility: Update the prompt's handle and scope.
   */
  async updateHandle(params: {
    idOrHandle: string;
    projectId: string;
    data: {
      handle?: string;
      scope?: PromptScope;
    };
  }): Promise<VersionedPrompt> {
    const { idOrHandle, projectId, data } = params;

    const updatedConfig = await this.repository.updateConfig(
      idOrHandle,
      projectId,
      data,
    );

    // Get the latest version to return complete prompt
    const latestVersion = (await this.repository.versions.getLatestVersion(
      updatedConfig.id,
      projectId,
    )) as LatestConfigVersionSchema;

    return this.transformToVersionedPrompt({
      ...updatedConfig,
      latestVersion,
    } as LlmConfigWithLatestVersion);
  }

  /**
   * Updates a prompt configuration with the provided data.
   * Creates a new version. Requires a commit message.
   *
   * @param params - The parameters object
   * @param params.idOrHandle - The prompt configuration ID or handle
   * @param params.projectId - The project ID for authorization and context
   * @param params.data - The update data (must include commitMessage)
   * @returns The updated prompt configuration
   */
  async updatePrompt(params: {
    idOrHandle: string;
    projectId: string;
    data: {
      commitMessage: string;
    } & Partial<
      Omit<
        CreateLlmConfigParams &
          Omit<CreateLlmConfigVersionParams, "configData"> &
          CreateLlmConfigVersionParams["configData"],
        | "id"
        | "createdAt"
        | "updatedAt"
        | "deletedAt"
        | "configId"
        | "projectId"
        | "name"
        | "commitMessage"
      >
    >;
  }): Promise<VersionedPrompt> {
    const { idOrHandle, projectId, data } = params;
    const { handle, scope, ...newVersionData } = data;

    this.versionService.assertNoSystemPromptConflict(newVersionData);

    const normalizedUpdate = this.normalizeSystemMessage(newVersionData);
    newVersionData.prompt = normalizedUpdate.prompt;
    newVersionData.messages = normalizedUpdate.messages as unknown as
      | Array<{
          role: "user" | "assistant" | "system";
          content: string;
        }>
      | undefined;

    // Handle in a transaction to ensure atomicity
    const result = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Update the config
        const updatedConfig = await this.repository.updateConfig(
          idOrHandle,
          projectId,
          {
            handle,
            scope,
          },
          { tx },
        );

        // Get the latest version
        // TODO: This should use the version service instead of accessing the repository directly
        const latestVersion = (await this.repository.versions.getLatestVersion(
          updatedConfig.id,
          projectId,
          { tx },
        )) as LatestConfigVersionSchema;

        // Create the new version directly
        const updatedVersion: LlmPromptConfigVersion =
          await this.versionService.createVersion({
            db: tx,
            data: {
              configId: updatedConfig.id,
              projectId,
              commitMessage: newVersionData.commitMessage,
              configData: this.transformToDbFormat({
                ...latestVersion.configData,
                ...newVersionData,
              }) as LatestConfigVersionSchema["configData"],
              schemaVersion: LATEST_SCHEMA_VERSION,
              version: latestVersion.version + 1,
            },
          });

        return this.transformToVersionedPrompt({
          ...updatedConfig,
          latestVersion: updatedVersion,
        } as LlmConfigWithLatestVersion);
      },
    );

    return result;
  }

  /**
   * Restore a prompt version
   * Creates a new version with the same config data as the restored version
   */
  async restoreVersion(params: {
    versionId: string;
    projectId: string;
    authorId?: string | null;
    organizationId?: string;
  }): Promise<VersionedPrompt> {
    const organizationId =
      params.organizationId ??
      (await this.getOrganizationIdFromProjectId(params.projectId));

    const newVersion = await this.repository.versions.restoreVersion({
      id: params.versionId,
      authorId: params.authorId ?? null,
      projectId: params.projectId,
      organizationId,
    });

    const newPrompt = await this.getPromptByIdOrHandle({
      idOrHandle: newVersion.configId,
      projectId: params.projectId,
      organizationId,
    });

    if (!newPrompt) {
      throw new Error("Failed to restore version");
    }

    return newPrompt;
  }

  /**
   * Checks if a handle is unique for a project.
   * @param params - The parameters object
   * @param params.handle - The handle to check
   * @param params.projectId - The project ID to check
   * @param params.organizationId - The organization ID to check
   * @param params.excludeId - The ID of the config to exclude from the check
   * @returns True if the handle is unique, false otherwise
   */
  async checkHandleUniqueness(params: {
    handle: string;
    projectId: string;
    organizationId?: string;
    scope: PromptScope;
    excludeId?: string;
  }): Promise<boolean> {
    const organizationId =
      params.organizationId ??
      (await this.getOrganizationIdFromProjectId(params.projectId));
    // Check if handle exists (excluding current config if editing)
    const existingConfig = await this.prisma.llmPromptConfig.findUnique({
      where: {
        scope: params.scope,
        handle: this.repository.createHandle({
          handle: params.handle,
          scope: params.scope,
          projectId: params.projectId,
          organizationId,
        }),
        // Double check just to make sure the prompt belongs to the project or organization the user is from
        OR: [
          {
            projectId: params.projectId,
          },
          {
            organizationId: params.organizationId,
            scope: "ORGANIZATION",
          },
        ],
      },
    });

    // Return true if unique (no existing config or it's the same config being edited)
    return !existingConfig || existingConfig.id === params.excludeId;
  }

  /**
   * Syncs a prompt from local source.
   * If the local version is the same as the remote version, it will be skipped.
   * If the local version is newer than the remote version, it will be updated.
   * If the local version is older than the remote version, it will be conflict.
   *
   * @param params - The parameters object
   * @param params.idOrHandle - The ID or handle of the prompt
   * @param params.localConfigData - The local config data
   * @param params.localVersion - The local version number
   * @param params.projectId - The project ID
   * @param params.organizationId - The organization ID
   * @param params.authorId - The author ID
   */
  async syncPrompt(params: {
    idOrHandle: string;
    localConfigData: ConfigData;
    localVersion?: number;
    projectId: string;
    organizationId: string;
    authorId?: string;
    commitMessage?: string;
  }): Promise<{
    action: "created" | "updated" | "conflict" | "up_to_date";
    prompt?: VersionedPrompt;
    conflictInfo?: {
      localVersion: number;
      remoteVersion: number;
      differences: string[];
      remoteConfigData: ConfigData;
    };
  }> {
    const {
      idOrHandle,
      localConfigData,
      localVersion,
      projectId,
      organizationId,
      authorId,
      commitMessage,
    } = params;

    // Check if prompt exists on server
    const existingPrompt = await this.getPromptByIdOrHandle({
      idOrHandle,
      projectId,
      organizationId,
    });

    // Case 1: Prompt doesn't exist on server - create new
    if (!existingPrompt) {
      const createdPrompt = await this.createPrompt({
        handle: idOrHandle,
        projectId,
        organizationId,
        scope: "PROJECT" as PromptScope,
        authorId,
        commitMessage: commitMessage ?? "Synced from local file",
        ...this.transformToDbFormat(localConfigData),
      });

      return {
        action: "created",
        prompt: createdPrompt,
      };
    }

    // Check modify permissions
    const permission = await this.repository.checkModifyPermission({
      idOrHandle,
      projectId,
      organizationId,
    });

    if (!permission.hasPermission) {
      throw new Error(
        permission.reason ?? "No permission to modify this prompt",
      );
    }

    const remoteVersion = existingPrompt.version;
    const remoteConfigData: LatestConfigVersionSchema["configData"] = {
      model: existingPrompt.model,
      temperature: existingPrompt.temperature,
      prompt: existingPrompt.prompt,
      messages: existingPrompt.messages.filter((msg) => msg.role !== "system"),
      inputs: existingPrompt.inputs,
      outputs: existingPrompt.outputs,
      response_format: existingPrompt.responseFormat,
    };

    // Case 2: Same version - check content
    if (localVersion === remoteVersion) {
      const comparison = this.repository.compareConfigContent(
        localConfigData,
        remoteConfigData,
      );

      if (comparison.isEqual) {
        // Content is the same - up to date
        return { action: "up_to_date", prompt: existingPrompt };
      } else {
        // Content differs - create new version
        const updatedPrompt = await this.updatePrompt({
          idOrHandle: existingPrompt.id,
          projectId,
          data: {
            authorId,
            commitMessage: commitMessage ?? "Updated from local file",
            ...this.transformToDbFormat(localConfigData),
            schemaVersion: SchemaVersion.V1_0,
          },
        });

        return {
          action: "updated",
          prompt: updatedPrompt,
        };
      }
    }

    // Case 3: Different versions
    if (localVersion && localVersion < remoteVersion) {
      // Local is behind - check if local content differs from the version it's based on
      const localBaseVersion = await this.repository.getConfigVersionByNumber({
        idOrHandle,
        versionNumber: localVersion,
        projectId,
        organizationId,
      });

      if (localBaseVersion) {
        const baseComparison = this.repository.compareConfigContent(
          localConfigData,
          localBaseVersion.configData as Record<string, unknown>,
        );

        if (baseComparison.isEqual) {
          // Local hasn't changed since base version - can safely update
          return { action: "up_to_date", prompt: existingPrompt };
        }
      }

      // Local has changes and is behind - conflict
      return {
        action: "conflict",
        conflictInfo: {
          localVersion,
          remoteVersion,
          differences:
            this.repository.compareConfigContent(
              localConfigData,
              remoteConfigData,
            ).differences ?? [],
          remoteConfigData,
        },
      };
    }

    // Case 4: Local version is newer or unknown - assume conflict
    return {
      action: "conflict",
      conflictInfo: {
        localVersion: localVersion ?? 0,
        remoteVersion,
        differences:
          this.repository.compareConfigContent(
            localConfigData,
            remoteConfigData,
          ).differences ?? [],
        remoteConfigData,
      },
    };
  }

  /**
   * Delete a prompt
   */
  async deletePrompt(params: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<{ success: boolean }> {
    const organizationId =
      params.organizationId ??
      (await this.getOrganizationIdFromProjectId(params.projectId));
    const result = await this.repository.deleteConfig(
      params.idOrHandle,
      params.projectId,
      organizationId,
    );
    return result;
  }

  /**
   * Transforms a config from repository format to the VersionedPrompt shape
   * expected by the API and service layer.
   */
  private transformToVersionedPrompt(
    config: Omit<LlmConfigWithLatestVersion, "deletedAt">,
  ): VersionedPrompt {
    const prompt = config.latestVersion.configData.prompt;

    return {
      id: config.id,
      name: config.name,
      handle: config.handle,
      scope: config.scope,
      version: config.latestVersion.version ?? 0,
      versionId: config.latestVersion.id ?? "",
      versionCreatedAt: config.latestVersion.createdAt ?? new Date(),
      model: config.latestVersion.configData.model,
      temperature: config.latestVersion.configData.temperature,
      maxTokens: config.latestVersion.configData.max_tokens,
      prompt,
      projectId: config.projectId,
      organizationId: config.organizationId,
      // The VersionedPrompt contains the system message,
      // but in the database, we only have the prompt field above
      messages: [
        { role: "system", content: prompt },
        ...(config.latestVersion.configData.messages ?? []),
      ],
      inputs: config.latestVersion.configData.inputs,
      outputs: config.latestVersion.configData.outputs,
      responseFormat: config.latestVersion.configData.response_format,
      authorId: config.latestVersion.authorId ?? null,
      author: config.latestVersion.author
        ? {
            id: config.latestVersion.author.id,
            name: config.latestVersion.author.name,
          }
        : null,
      updatedAt: config.updatedAt,
      createdAt: config.createdAt,
      demonstrations: config.latestVersion.configData.demonstrations,
      promptingTechnique: config.latestVersion.configData.prompting_technique,
      commitMessage: config.latestVersion.commitMessage,
    };
  }

  private async getOrganizationIdFromProjectId(
    projectId: string,
  ): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        team: {
          include: { organization: true },
        },
      },
    });

    if (!project?.team?.organizationId) {
      throw new Error(`Organization not found for project ${projectId}`);
    }

    return project.team.organizationId;
  }

  /**
   * Transforms camelCase service params to snake_case for repository/database
   * Single Responsibility: Handle naming convention conversion at data boundary
   *
   * TODO: Move to repository layer - the repository should handle this transformation
   * to properly isolate database schema concerns from service business logic.
   */
  private transformToDbFormat(data: any): any {
    const { maxTokens, promptingTechnique, responseFormat, ...rest } = data;
    return {
      ...rest,
      ...(maxTokens !== undefined && { max_tokens: maxTokens }),
      ...(promptingTechnique !== undefined && {
        prompting_technique: promptingTechnique,
      }),
      ...(responseFormat !== undefined && { response_format: responseFormat }),
    };
  }
}
