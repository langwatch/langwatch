import type { paths } from "@/internal/generated/openapi/api-client";
import { type PromptResponse } from "./types";
import { PromptConverter } from "@/cli/utils/promptConverter";
import { PromptServiceTracingDecorator, tracer } from "./tracing";
import { createTracingProxy } from "@/client-sdk/tracing/create-tracing-proxy";
import { type InternalConfig } from "@/client-sdk/types";
import { type CreatePromptBody, type UpdatePromptBody } from "./types";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";

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

/**
 * Service for managing prompt resources via the Langwatch API.
 * Constructor creates a proxy that wraps the service and traces all methods.
 *
 * Responsibilities:
 * - CRUD operations for prompts
 * - Creating prompt versions
 * - Error handling with contextual information
 *
 * All methods return raw PromptResponse data from the API.
 */
export class PromptsApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();

    /**
     * Wraps the service in a tracing proxy via the decorator.
     */
    return createTracingProxy(
      this as PromptsApiService,
      tracer,
      PromptServiceTracingDecorator,
    );
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
   * @returns Array of raw PromptResponse data.
   * @throws {PromptsError} If the API call fails.
   */
  async getAll(): Promise<PromptResponse[]> {
    const { data, error } =
      await this.apiClient.GET("/api/prompts");
    if (error) this.handleApiError("fetch all prompts", error);
    return data;
  }

  /**
   * Fetches a single prompt by its ID.
   * @param id The prompt's unique identifier.
   * @returns Raw PromptResponse data.
   * @throws {PromptsError} If the API call fails.
   */
  async get(id: string, options?: { version?: string }): Promise<PromptResponse> {
    const { data, error } = await this.apiClient.GET(
      "/api/prompts/{id}",
      {
        params: { path: { id } },
        query: {
          version: options?.version,
        },
      },
    );

    if (error) {
      this.handleApiError(`fetch prompt with ID "${id}"`, error);
    }

    return data;
  }

  /**
   * Validates if a prompt exists.
   * @param id The prompt's unique identifier.
   * @returns True if prompt exists, false otherwise.
   * @throws {PromptsError} If the API call fails (not 404).
   */
  async exists(id: string): Promise<boolean> {
    try {
      await this.get(id);
      return true;
    } catch (error) {
      if (
        error instanceof PromptsError &&
        error.originalError?.statusCode === 404
      ) {
        return false;
      }

      throw error;
    }
  }

  /**
   * Creates a new prompt.
   * @param params The prompt creation payload, matching the OpenAPI schema.
   * @returns Raw PromptResponse data of the created prompt.
   * @throws {PromptsError} If the API call fails.
   */
  async create(params: CreatePromptBody): Promise<PromptResponse> {
    const { data, error } = await this.apiClient.POST(
      "/api/prompts",
      {
        body: params,
      },
    );
    if (error) this.handleApiError("create prompt", error);
    return data;
  }

  /**
   * Updates an existing prompt.
   * @param id The prompt's unique identifier.
   * @param params The update payload, matching the OpenAPI schema.
   * @returns Raw PromptResponse data of the updated prompt.
   * @throws {PromptsError} If the API call fails.
   */
  async update(id: string, params: UpdatePromptBody): Promise<PromptResponse> {
    const { error, data: updatedPrompt } =
      await this.apiClient.PUT("/api/prompts/{id}", {
        params: { path: { id } },
        body: params,
      });
    if (error) this.handleApiError(`update prompt with ID "${id}"`, error);
    return updatedPrompt;
  }

  /**
   * Deletes a prompt by its ID.
   * @param id The prompt's unique identifier.
   * @throws {PromptsError} If the API call fails.
   */
  async delete(id: string): Promise<{ success: boolean }> {
    const { data, error } = await this.apiClient.DELETE(
      "/api/prompts/{id}",
      {
        params: { path: { id } },
      },
    );
    if (error) this.handleApiError(`delete prompt with ID "${id}"`, error);

    return data;
  }

  /**
   * Fetches all versions for a given prompt.
   * @param id The prompt's unique identifier.
   * @returns Array of raw PromptResponse data for each version.
   * @throws {PromptsError} If the API call fails.
   */
  async getVersions(id: string): Promise<PromptResponse[]> {
    const { data, error } = await this.apiClient.GET(
      "/api/prompts/{id}/versions",
      {
        params: { path: { id } },
      },
    );
    if (error)
      this.handleApiError(`fetch versions for prompt with ID "${id}"`, error);

    return data;
  }

  /**
   * Upserts a prompt with local configuration - creates if doesn't exist, updates version if exists.
   * @param handle The prompt's handle/identifier.
   * @param config Local prompt configuration.
   * @returns Object with created flag and raw PromptResponse data.
   * @throws {PromptsError} If the API call fails.
   */
  async upsert(
    handle: string,
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
  ): Promise<{ created: boolean; prompt: PromptResponse }> {
    const payload = {
      handle,
      model: config.model,
      prompt: PromptConverter.extractSystemPrompt(config.messages),
      messages: PromptConverter.filterNonSystemMessages(config.messages),
      temperature: config.modelParameters?.temperature,
      maxTokens: config.modelParameters?.max_tokens,
      inputs: [{ identifier: "input", type: "str" as const }],
      outputs: [{ identifier: "output", type: "str" as const }],
      commitMessage: `Updated via CLI sync`,
      schemaVersion: "1.0" as const,
    };

    // Creating a prompt with the same handle will fail, so we try to update instead
    try {
      const prompt = await this.create(payload);
      return {
        created: true,
        prompt,
      };
    } catch {
      const prompt = await this.update(handle, payload);

      return {
        created: false,
        prompt,
      };
    }
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
      const response = await this.apiClient.POST(
        "/api/prompts/{id}/sync",
        {
          params: { path: { id: params.name } },
          body: {
            configData: params.configData,
            localVersion: params.localVersion,
            commitMessage: params.commitMessage,
          },
        },
      );

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
