/** Every change a caller makes to a prompt, and the permission each of them asks for first. */
import {
  type PromptScope,
  type UpdatePromptCommand,
  SystemPromptRequiredError,
  LATEST_SCHEMA_VERSION,
  type LatestConfigVersionSchema,
  type inputsSchema,
  type messageSchema,
  type outputsSchema,
  type promptingTechniqueSchema,
  parseLlmConfigVersion,
  parseRuntimeParameters,
} from "@langwatch/prompt-contract";
import type { z } from "zod";
import { transformCamelToSnake } from "../ports/prompt-transform-db.port.ts";
import type {
  LlmConfigRepository,
  LlmConfigWithLatestVersion,
} from "../repositories/prompt.repository.ts";
import { normalizeSystemMessage, withLatestTag } from "../rules/prompt-shape.rules.ts";
import type { PromptReadService } from "./prompt-read.service.ts";
import type { PromptTagLookupService } from "./prompt-tag-lookup.service.ts";
import type { PromptVersionService } from "./prompt-version.service.ts";
import type { VersionedPrompt } from "./prompt.service.ts";

export type PromptUpdateInput = Omit<UpdatePromptCommand, "data"> & {
  data: UpdatePromptCommand["data"] & {
    handle?: string;
    scope?: PromptScope;
  };
};

type VersionedPromptMapper = (
  config: Omit<LlmConfigWithLatestVersion, "deletedAt">,
  tags: Array<{ name: string; versionId: string }>,
) => VersionedPrompt;

export type CreatePromptParams = {
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
  // Traditional sampling parameters
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  // Other sampling parameters
  seed?: number;
  topK?: number;
  minP?: number;
  repetitionPenalty?: number;
  // Reasoning parameter (canonical/unified field)
  reasoning?: string;
  verbosity?: string;
  promptingTechnique?: z.infer<typeof promptingTechniqueSchema>;
  demonstrations?: LatestConfigVersionSchema["configData"]["demonstrations"];
  commitMessage?: string | null;
  parameters?: Record<string, unknown>;
};

export class PromptWriteService {
  private readonly repository: LlmConfigRepository;
  private readonly versionService: PromptVersionService;
  private readonly read: PromptReadService;
  private readonly tagLookup: PromptTagLookupService;
  private readonly toVersionedPrompt: VersionedPromptMapper;

  static create(options: {
    repository: LlmConfigRepository;
    versionService: PromptVersionService;
    read: PromptReadService;
    tagLookup: PromptTagLookupService;
    toVersionedPrompt: VersionedPromptMapper;
  }): PromptWriteService {
    return new PromptWriteService(options);
  }

  private constructor(options: {
    repository: LlmConfigRepository;
    versionService: PromptVersionService;
    read: PromptReadService;
    tagLookup: PromptTagLookupService;
    toVersionedPrompt: VersionedPromptMapper;
  }) {
    this.repository = options.repository;
    this.versionService = options.versionService;
    this.read = options.read;
    this.tagLookup = options.tagLookup;
    this.toVersionedPrompt = options.toVersionedPrompt;
  }

  /**
   * Creates a new prompt configuration with an initial version, defaulting
   * the version data when none is provided.
   */
  async createPrompt(params: CreatePromptParams): Promise<VersionedPrompt> {
    const organizationId =
      params.organizationId ?? (await this.getOrganizationIdFromProjectId(params.projectId));
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
      params.demonstrations !== undefined,
    );

    if (shouldCreateVersion) {
      this.versionService.assertNoSystemPromptConflict({
        prompt: params.prompt,
        messages: params.messages,
      });
    }

    // Normalize system message into prompt
    const normalizedCreate = normalizeSystemMessage({
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
      throw new SystemPromptRequiredError();
    }

    const config = await this.repository.createConfigWithInitialVersion({
      configData: {
        name: params.handle,
        handle: params.handle ?? null,
        projectId: params.projectId,
        organizationId,
        scope: params.scope ?? "PROJECT",
        authorId: params.authorId,
        copiedFromPromptId: null,
      },
      versionData: shouldCreateVersion ? this.initialVersionData(params) : undefined,
    });

    // A freshly created prompt's only version is also the latest; no custom
    // tag assignments exist yet (those are attached by the route in a second
    // step), so the only tag to surface is the built-in "latest".
    const newVersionId = config.latestVersion.id ?? "";

    return this.toVersionedPrompt(
      config,
      newVersionId ? [{ name: "latest", versionId: newVersionId }] : [],
    );
  }

  /** The first version a new prompt is created with, in the snake_case shape the database takes. */
  private initialVersionData(params: CreatePromptParams) {
    return {
      configData: this.transformToDbFormat({
        prompt: params.prompt,
        messages: params.messages,
        inputs: params.inputs ?? [{ identifier: "input", type: "str" }],
        outputs: params.outputs ?? [{ identifier: "output", type: "str" }],
        model: params.model,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        // Traditional sampling parameters
        topP: params.topP,
        frequencyPenalty: params.frequencyPenalty,
        presencePenalty: params.presencePenalty,
        // Other sampling parameters
        seed: params.seed,
        topK: params.topK,
        minP: params.minP,
        repetitionPenalty: params.repetitionPenalty,
        // Reasoning parameter (canonical/unified field)
        reasoning: params.reasoning,
        verbosity: params.verbosity,
        promptingTechnique: params.promptingTechnique,
        demonstrations: params.demonstrations,
      }) as LatestConfigVersionSchema["configData"],
      schemaVersion: LATEST_SCHEMA_VERSION,
      commitMessage: params.commitMessage ?? "Initial version",
      authorId: params.authorId ?? null,
      version: 1,
      runtimeParameters: params.parameters ?? {},
    };
  }

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

    await this.assertModifyPermission({
      idOrHandle,
      projectId,
    });

    const updatedConfig = await this.repository.updateConfig(idOrHandle, projectId, data);

    // Get the latest version to return complete prompt
    const latestVersionRaw = await this.repository.versions.getLatestVersion(
      updatedConfig.id,
      projectId,
    );
    const latestVersion = {
      ...parseLlmConfigVersion(latestVersionRaw),
      runtimeParameters: parseRuntimeParameters(latestVersionRaw.runtimeParameters),
    };

    const latestVersionId = latestVersion.id ?? "";
    const tagsByVersionId = await this.tagLookup.getTagsByVersionIds({
      versionIds: latestVersionId ? [latestVersionId] : [],
      projectId,
    });

    return this.toVersionedPrompt(
      {
        ...updatedConfig,
        latestVersion,
      } as LlmConfigWithLatestVersion,
      withLatestTag({
        tags: tagsByVersionId.get(latestVersionId) ?? [],
        currentVersionId: latestVersionId,
        latestVersionId,
      }),
    );
  }

  /**
   * Updates a prompt configuration with the provided data, creating a new
   * version with a commit message tracking the changes. Only provided
   * fields are updated; a commit message is always required.
   */
  async updatePrompt(params: PromptUpdateInput): Promise<VersionedPrompt> {
    const { idOrHandle, projectId, data } = params;
    const {
      handle,
      scope,
      commitMessage,
      parameters: incomingParameters,
      ...configDataUpdates
    } = data;

    this.versionService.assertNoSystemPromptConflict(configDataUpdates);

    // Only normalize system messages if prompt or messages are being updated
    // This prevents undefined values from overwriting existing database values
    if (configDataUpdates.prompt !== undefined || configDataUpdates.messages !== undefined) {
      const normalizedUpdate = normalizeSystemMessage(configDataUpdates);
      configDataUpdates.prompt = normalizedUpdate.prompt;
      configDataUpdates.messages = normalizedUpdate.messages as unknown as
        | Array<{
            role: "user" | "assistant" | "system";
            content: string;
          }>
        | undefined;
    }

    const updatedConfig = await this.repository.updateConfigAndCreateVersion({
      idOrHandle,
      projectId,
      data: { handle, scope },
      commitMessage,
      configDataUpdates: this.transformToDbFormat(configDataUpdates) as Partial<
        LatestConfigVersionSchema["configData"]
      >,
      schemaVersion: LATEST_SCHEMA_VERSION,
      authorId: data.authorId,
      runtimeParameters: incomingParameters,
    });
    const newVersionId = updatedConfig.latestVersion.id ?? "";

    return this.toVersionedPrompt(
      updatedConfig,
      newVersionId ? [{ name: "latest", versionId: newVersionId }] : [],
    );
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
      params.organizationId ?? (await this.getOrganizationIdFromProjectId(params.projectId));

    const newVersion = await this.repository.versions.restoreVersion({
      id: params.versionId,
      authorId: params.authorId ?? null,
      projectId: params.projectId,
      organizationId,
    });

    const newPrompt = await this.read.tryGetPromptByIdOrHandle({
      idOrHandle: newVersion.configId,
      projectId: params.projectId,
      organizationId,
    });

    if (!newPrompt) {
      throw new Error("Failed to restore version");
    }

    return newPrompt;
  }

  /** Checks if a handle is unique for a project. */
  async checkHandleUniqueness(params: {
    handle: string;
    projectId: string;
    organizationId?: string;
    scope: PromptScope;
    excludeId?: string;
  }): Promise<boolean> {
    const organizationId =
      params.organizationId ?? (await this.getOrganizationIdFromProjectId(params.projectId));

    return this.repository.isHandleUnique({
      handle: params.handle,
      projectId: params.projectId,
      organizationId,
      organizationIdForScopeCheck: params.organizationId,
      scope: params.scope,
      excludeId: params.excludeId,
    });
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
      params.organizationId ?? (await this.getOrganizationIdFromProjectId(params.projectId));

    await this.assertModifyPermission({
      idOrHandle: params.idOrHandle,
      projectId: params.projectId,
      organizationId,
    });

    const result = await this.repository.deleteConfig({
      idOrHandle: params.idOrHandle,
      projectId: params.projectId,
      organizationId,
    });

    return result;
  }

  /**
   * Transforms camelCase service params to snake_case for repository/database Single
   * Responsibility: Handle naming convention conversion at data boundary
   */
  transformToDbFormat(data: Record<string, unknown>): Record<string, unknown> {
    return transformCamelToSnake(data);
  }

  /**
   * Assert permission to modify/delete a prompt
   */
  async assertModifyPermission(params: {
    idOrHandle: string;
    projectId: string;
    // Deduced from projectId if not provided
    organizationId?: string;
  }): Promise<void> {
    const organizationId =
      params.organizationId ?? (await this.getOrganizationIdFromProjectId(params.projectId));

    const permission = await this.repository.checkModifyPermission({
      idOrHandle: params.idOrHandle,
      projectId: params.projectId,
      organizationId,
    });

    if (!permission.hasPermission) {
      throw new Error(permission.reason ?? "You don't have permission to modify this prompt");
    }
  }

  /**
   * Check if user has permission to modify/delete a prompt
   * Single Responsibility: Delegate permission check to repository with proper context
   */
  async checkModifyPermission(params: {
    idOrHandle: string;
    projectId: string;
    organizationId?: string;
  }): Promise<{ hasPermission: boolean; reason?: string }> {
    const organizationId =
      params.organizationId ?? (await this.getOrganizationIdFromProjectId(params.projectId));

    return await this.repository.checkModifyPermission({
      idOrHandle: params.idOrHandle,
      projectId: params.projectId,
      organizationId,
    });
  }

  private async getOrganizationIdFromProjectId(projectId: string): Promise<string> {
    return this.repository.getOrganizationIdForProject(projectId);
  }
}
