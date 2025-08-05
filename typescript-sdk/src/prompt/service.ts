import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "../internal/api/client";
import type { paths } from "../internal/generated/openapi/api-client";
import { Prompt, type PromptResponse } from "./prompt";
import { PromptConverter } from "./converter";
import type {
  CreatePromptBodyV2,
  UpdatePromptBody,
  CreateVersionBody,
} from "./types";

/**
 * Custom error class for Prompts API operations.
 * Provides context about the failed operation and the original error.
 */
export class PromptsError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: any,
  ) {
    super(message);
    this.name = "PromptsError";
  }
}

export type SyncAction = "created" | "updated" | "conflict" | "up_to_date";

export type ConfigData = NonNullable<
  paths["/api/prompts/{id}/sync"]["post"]["requestBody"]
>["content"]["application/json"]["configData"];

export interface SyncResult {
  action: SyncAction;
  prompt?: PromptResponse;
  conflictInfo?: {
    localVersion: number;
    remoteVersion: number;
    differences: string[];
    remoteConfigData: ConfigData;
  };
}

interface PromptServiceOptions {
  client?: LangwatchApiClient;
}

/**
 * Service for managing prompt resources via the Langwatch API.
 *
 * Responsibilities:
 * - CRUD operations for prompts
 * - Creating prompt versions
 * - Error handling with contextual information
 *
 * All methods return Prompt instances, which encapsulate prompt data and template logic.
 */
export class PromptService {
  private client: LangwatchApiClient;
  private static instance: PromptService | null = null;

  constructor(opts?: PromptServiceOptions) {
    this.client = opts?.client ?? createLangWatchApiClient();
  }

  /**
   * Gets the singleton instance of PromptService.
   * Creates the instance lazily on first access.
   */
  public static getInstance(): PromptService {
    if (!PromptService.instance) {
      PromptService.instance = new PromptService();
    }
    return PromptService.instance;
  }

  /**
   * Resets the singleton instance. Primarily used for testing.
   */
  public static resetInstance(): void {
    PromptService.instance = null;
  }

  /**
   * Handles API errors by throwing a PromptsError with operation context.
   * @param operation Description of the operation being performed.
   * @param error The error object returned from the API client.
   * @throws {PromptsError}
   */
  private handleApiError(operation: string, error: any): never {
    const errorMessage =
      typeof error === "string"
        ? error
        : error?.error ?? error?.message ?? "Unknown error occurred";
    throw new PromptsError(
      `Failed to ${operation}: ${errorMessage}`,
      operation,
      error,
    );
  }

  /**
   * Fetches all prompts from the API.
   * @returns Array of Prompt instances.
   * @throws {PromptsError} If the API call fails.
   */
  async getAll(): Promise<Prompt[]> {
    const { data, error } = await this.client.GET("/api/prompts");
    if (error) this.handleApiError("fetch all prompts", error);
    return data.map((promptData) => new Prompt(promptData));
  }

  /**
   * Fetches a single prompt by its ID.
   * @param id The prompt's unique identifier.
   * @returns The Prompt instance or null if not found.
   * @throws {PromptsError} If the API call fails.
   */
  async get(
    id: string,
    options?: { version?: string },
  ): Promise<Prompt | null> {
    const { data, error } = await this.client.GET("/api/prompts/{id}", {
      params: { path: { id } },
      query: {
        version: options?.version,
      },
    });

    if (error) {
      this.handleApiError(`fetch prompt with ID "${id}"`, error);
    }
    return new Prompt(data);
  }

  /**
   * Validates if a prompt exists.
   * @param id The prompt's unique identifier.
   * @returns True if prompt exists, false otherwise.
   * @throws {PromptsError} If the API call fails (not 404).
   */
  async exists(id: string): Promise<boolean> {
    try {
      const prompt = await this.get(id);
      return prompt !== null;
    } catch (error) {
      throw error; // Re-throw non-404 errors
    }
  }

  /**
   * Creates a new prompt.
   * @param params The prompt creation payload, matching the OpenAPI schema.
   * @returns The created Prompt instance.
   * @throws {PromptsError} If the API call fails.
   */
  async create(params: CreatePromptBodyV2): Promise<Prompt> {
    const { data, error } = await this.client.POST("/api/prompts/v2", {
      body: params,
    });
    if (error) this.handleApiError("create prompt", error);
    return new Prompt(data);
  }

  /**
   * Updates an existing prompt.
   * @param id The prompt's unique identifier.
   * @param params The update payload, matching the OpenAPI schema.
   * @returns The updated Prompt instance.
   * @throws {PromptsError} If the API call fails.
   * @remarks
   *   The API does not return the updated prompt directly, so this method fetches it after updating.
   */
  async update(id: string, params: UpdatePromptBody): Promise<Prompt> {
    const { error } = await this.client.PUT("/api/prompts/{id}", {
      params: { path: { id } },
      body: params,
    });
    if (error) this.handleApiError(`update prompt with ID "${id}"`, error);
    // TODO: This is a workaround to get the updated prompt. It would be better to return the updated prompt directly.
    const updatedPrompt = await this.get(id);
    if (!updatedPrompt) {
      throw new PromptsError(
        "Prompt not found after update",
        "update prompt",
        null,
      );
    }
    return updatedPrompt;
  }

  /**
   * Deletes a prompt by its ID.
   * @param id The prompt's unique identifier.
   * @throws {PromptsError} If the API call fails.
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.client.DELETE("/api/prompts/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`delete prompt with ID "${id}"`, error);
  }

  /**
   * Fetches all versions for a given prompt.
   * @param id The prompt's unique identifier.
   * @throws {PromptsError} If the API call fails.
   */
  async getVersions(id: string): Promise<Record<string, Prompt>> {
    const { data, error } = await this.client.GET(
      "/api/prompts/{id}/versions",
      {
        params: { path: { id } },
      },
    );
    if (error)
      this.handleApiError(`fetch versions for prompt with ID "${id}"`, error);

    const prompts: Record<string, Prompt> = {};
    const dataTypeCorrected = data as unknown as NonNullable<
      paths["/api/prompts/{id}/versions"]["get"]["responses"]["200"]["content"]["application/json"]
    >[];

    for (const version of dataTypeCorrected) {
      prompts[version.id] = new Prompt({
        id: version.configId,
        handle: version.handle,
        scope: version.scope,
        messages: version.configData.messages,
        model: version.configData.model,
        prompt: version.configData.prompt,
        response_format: null,
        name: `Prompt ${version.configId}@${version.id}`,
        updatedAt: version.createdAt,
        version: version.configData.version ?? 0,
        versionCreatedAt: version.createdAt,
        versionId: version.id,
      });
    }

    return prompts;
  }

  /**
   * Creates a new version for a given prompt.
   * @param id The prompt's unique identifier.
   * @param params The version creation payload, matching the OpenAPI schema.
   * @returns The updated Prompt instance.
   * @throws {PromptsError} If the API call fails.
   * @remarks
   *   The API does not return the updated prompt directly, so this method fetches it after creation.
   */
  async createVersion(id: string, params: CreateVersionBody): Promise<Prompt> {
    const { error } = await this.client.POST("/api/prompts/{id}/versions", {
      params: { path: { id } },
      body: params,
    });
    if (error)
      this.handleApiError(`create version for prompt with ID "${id}"`, error);
    // TODO: This is a workaround to get the updated prompt. It would be better to return the updated prompt directly.
    const updatedPrompt = await this.get(id);
    if (!updatedPrompt) {
      throw new PromptsError(
        "Prompt not found after version creation",
        "create version",
        null,
      );
    }
    return updatedPrompt;
  }

  /**
   * Upserts a prompt with local configuration - creates if doesn't exist, updates version if exists.
   * @param name The prompt's name/identifier.
   * @param config Local prompt configuration.
   * @returns Object with created flag and the prompt instance.
   * @throws {PromptsError} If the API call fails.
   */
  async upsert(
    name: string,
    config: {
      model: string;
      modelParameters?: {
        temperature?: number;
        max_tokens?: number;
      };
      messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }>;
    },
  ): Promise<{ created: boolean; prompt: Prompt }> {
    let prompt = await this.get(name);
    let created = false;

    if (!prompt) {
      prompt = await this.create({ name });
      created = true;
    }

    // Create a new version with the updated config using the converter
    const versionData = {
      configData: {
        version: 1,
        model: config.model,
        prompt: PromptConverter.extractSystemPrompt(config.messages),
        messages: PromptConverter.filterNonSystemMessages(config.messages),
        temperature: config.modelParameters?.temperature,
        max_tokens: config.modelParameters?.max_tokens,
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
      },
      commitMessage: `Updated via CLI sync`,
      projectId: "placeholder", // Will be overridden by the API
      configId: prompt.id,
      schemaVersion: "1.0" as const,
      version: 1, // Will be auto-incremented by the API
    } as any; // Type assertion to bypass strict typing for now

    const updatedPrompt = await this.createVersion(prompt.id, versionData);

    return {
      created,
      prompt: updatedPrompt,
    };
  }

  /**
   * Sync a prompt with local content, handling conflicts and version management
   */
  async sync(params: {
    name: string;
    configData: ConfigData;
    localVersion?: number;
    commitMessage?: string;
  }): Promise<SyncResult> {
    try {
      const response = await this.client.POST("/api/prompts/{id}/sync", {
        params: { path: { id: params.name } },
        body: {
          configData: params.configData,
          localVersion: params.localVersion,
          commitMessage: params.commitMessage,
        },
      });

      if (response.error) {
        const errorMessage =
          response.error?.error ?? JSON.stringify(response.error);
        throw new Error(`Failed to sync prompt: ${errorMessage}`);
      }

      return {
        action: response.data.action as SyncAction,
        prompt: response.data.prompt,
        conflictInfo: response.data.conflictInfo,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      throw new PromptsError(message, "sync", error);
    }
  }
}
