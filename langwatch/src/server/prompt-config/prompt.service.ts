import {
  type LlmPromptConfig,
  type Prisma,
  type PrismaClient,
  type PromptScope,
} from "@prisma/client";
import { type z } from "zod";

import {
  type CreateLlmConfigParams,
  LlmConfigRepository,
  type LlmConfigWithLatestVersion,
} from "./repositories";
import {
  type getLatestConfigVersionSchema,
  SchemaVersion,
  LATEST_SCHEMA_VERSION,
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
 * Service layer for managing LLM prompt configurations.
 * Handles business logic for prompt operations including handle formatting.
 */
export class PromptService {
  readonly repository: LlmConfigRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = new LlmConfigRepository(prisma);
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
    organizationId: string;
  }): Promise<LlmConfigWithLatestVersion | null> {
    const { idOrHandle, projectId, organizationId } = params;

    return this.repository.getConfigByIdOrHandleWithLatestVersion({
      idOrHandle,
      projectId,
      organizationId,
    });
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
    organizationId: string;
    handle: string;
    scope?: PromptScope;
    name?: string;
    // Version data
    authorId?: string;
    prompt?: string;
    messages?: z.infer<typeof messageSchema>[];
    inputs?: z.infer<typeof inputsSchema>[];
    outputs?: z.infer<typeof outputsSchema>[];
    model?: string;
    temperature?: number;
    max_tokens?: number;
    prompting_technique?: z.infer<typeof promptingTechniqueSchema>;
  }): Promise<LlmConfigWithLatestVersion> {
    // If any of the version data is provided,
    // we should create a version from that data
    const shouldCreateVersion = Boolean(
      params.prompt ??
        params.messages ??
        params.inputs ??
        params.outputs ??
        params.model ??
        params.temperature ??
        params.max_tokens ??
        params.prompting_technique
    );

    return this.repository.createConfigWithInitialVersion({
      configData: {
        name: params.name ?? params.handle,
        handle: params.handle ?? null,
        projectId: params.projectId,
        organizationId: params.organizationId,
        scope: params.scope ?? "PROJECT",
        authorId: params.authorId,
      },
      versionData: shouldCreateVersion
        ? {
            configData: {
              prompt: params.prompt,
              messages: params.messages,
              inputs: params.inputs,
              outputs: params.outputs,
              model: params.model,
              temperature: params.temperature,
              max_tokens: params.max_tokens,
              prompting_technique: params.prompting_technique,
            } as Prisma.JsonValue,
            schemaVersion: LATEST_SCHEMA_VERSION,
            commitMessage: "Initial version",
            authorId: params.authorId ?? null,
            version: 0,
          }
        : undefined,
    });
  }

  /**
   * Updates a prompt configuration with the provided data.
   * If a handle is provided, it will be formatted with the organization and project context.
   *
   * @param params - The parameters object
   * @param params.id - The prompt configuration ID
   * @param params.projectId - The project ID for authorization and context
   * @param params.data - The update data containing name and optional handle
   * @returns The updated prompt configuration
   */
  async updatePrompt(params: {
    id: string;
    projectId: string;
    data: Partial<Pick<CreateLlmConfigParams, "handle" | "scope">>;
  }): Promise<LlmPromptConfig> {
    const { id, projectId, data } = params;

    return this.repository.updateConfig(id, projectId, {
      handle: data.handle,
      scope: data.scope,
    });
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
    organizationId: string;
    scope: PromptScope;
    excludeId?: string;
  }): Promise<boolean> {
    // Check if handle exists (excluding current config if editing)
    const existingConfig = await this.prisma.llmPromptConfig.findUnique({
      where: {
        scope: params.scope,
        handle: this.repository.createHandle({
          handle: params.handle,
          scope: params.scope,
          projectId: params.projectId,
          organizationId: params.organizationId,
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
   * Sync/upsert a prompt from local content with conflict resolution
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
    prompt?: LlmConfigWithLatestVersion;
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
      const newPrompt = await this.repository.createConfigWithInitialVersion({
        configData: {
          name: idOrHandle,
          handle: idOrHandle,
          projectId,
          organizationId,
          scope: "PROJECT" as PromptScope,
        },
      });

      // Create a new version with the local content
      const newVersion = await this.repository.versions.createVersion(
        {
          configId: newPrompt.id,
          projectId,
          authorId,
          commitMessage: commitMessage ?? "Synced from local file",
          configData: localConfigData,
          schemaVersion: SchemaVersion.V1_0,
        },
        organizationId
      );

      return {
        action: "created",
        prompt: {
          ...newPrompt,
          latestVersion: {
            ...newVersion,
            commitMessage: newVersion.commitMessage ?? "Synced from local file",
            version: newVersion.version,
            configData: localConfigData,
          },
        },
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
        permission.reason ?? "No permission to modify this prompt"
      );
    }

    const remoteVersion = existingPrompt.latestVersion.version;
    const remoteConfigData = existingPrompt.latestVersion.configData;

    // Case 2: Same version - check content
    if (localVersion === remoteVersion) {
      const comparison = this.repository.compareConfigContent(
        localConfigData,
        remoteConfigData
      );

      if (comparison.isEqual) {
        // Content is the same - up to date
        return { action: "up_to_date", prompt: existingPrompt };
      } else {
        // Content differs - create new version
        const newVersion = await this.repository.versions.createVersion(
          {
            configId: existingPrompt.id,
            projectId,
            authorId,
            commitMessage: commitMessage ?? "Updated from local file",
            configData: localConfigData,
            schemaVersion: SchemaVersion.V1_0,
          },
          organizationId
        );

        return {
          action: "updated",
          prompt: {
            ...existingPrompt,
            latestVersion: {
              ...newVersion,
              configData: localConfigData,
            } as any,
          },
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
          localBaseVersion.configData as Record<string, unknown>
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
              remoteConfigData
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
            remoteConfigData
          ).differences ?? [],
        remoteConfigData,
      },
    };
  }
}
