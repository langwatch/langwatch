import type { paths, operations } from "@/internal/generated/openapi/api-client";
import { type PromptResponse, type TagDefinition, type CreatedTag } from "./types";
import { PromptConverter } from "@/cli/utils/promptConverter";
import { PromptServiceTracingDecorator, tracer } from "./tracing";
import { createTracingProxy } from "@/client-sdk/tracing/create-tracing-proxy";
import { type InternalConfig } from "@/client-sdk/types";
import { type CreatePromptBody, type UpdatePromptBody } from "./types";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import { PromptsApiError } from "./errors";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
  formatApiErrorMessage,
} from "@/client-sdk/services/_shared/format-api-error";

export type SyncAction = "created" | "updated" | "conflict" | "up_to_date";

export type AssignTagResult = NonNullable<
  operations["putApiPromptsByIdTagsByTag"]["responses"]["200"]["content"]["application/json"]
>;

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
   * Handles API errors by throwing a PromptsApiError with operation context.
   * @param operation Description of the operation being performed.
   * @param error The error object returned from the API client.
   * @throws {PromptsApiError}
   */
  private handleApiError(operation: string, error: any, status?: number): never {
    const message = formatApiErrorForOperation({ operation: operation, error: error, options: {
      status: status ?? extractStatusFromResponse(error),
    } });

    throw new PromptsApiError(message, operation, error);
  }

  /**
   * Fetches all prompts from the API.
   * @returns Array of raw PromptResponse data.
   * @throws {PromptsApiError} If the API call fails.
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
   * @param options Optional parameters for the request.
   * @param options.version Specific version to fetch (numeric string or "latest").
   * @param options.tag Tag to fetch (e.g., "production", "staging", or a custom tag).
   * @returns Raw PromptResponse data.
   * @throws {PromptsApiError} If the API call fails.
   */
  get = async (id: string, options?: { version?: string; tag?: string }): Promise<PromptResponse> => {
    // Parse version to number, skip for "latest" or invalid values
    const versionNumber = options?.version && options.version !== "latest"
      ? parseInt(options.version, 10)
      : undefined;

    const { data, error } = await this.apiClient.GET(
      "/api/prompts/{id}",
      {
        params: {
          path: { id },
          query: {
            version: Number.isNaN(versionNumber) ? undefined : versionNumber,
            tag: options?.tag,
          },
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
   * @throws {PromptsApiError} If the API call fails (not 404).
   */
  async exists(id: string): Promise<boolean> {
    try {
      await this.get(id);
      return true;
    } catch (error) {
      const originalError = error instanceof PromptsApiError ? error.originalError : null;
      const statusCode = originalError != null && typeof originalError === "object" && "statusCode" in originalError
        ? (originalError as { statusCode: unknown }).statusCode
        : null;

      if (statusCode === 404) {
        return false;
      }

      throw error;
    }
  }

  /**
   * Creates a new prompt.
   * @param params The prompt creation payload, matching the OpenAPI schema.
   * @returns Raw PromptResponse data of the created prompt.
   * @throws {PromptsApiError} If the API call fails.
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
   * @throws {PromptsApiError} If the API call fails.
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
   * Lists all prompt tags (built-in and custom) for the organization.
   * @returns Array of tag definitions.
   * @throws {PromptsApiError} If the API call fails.
   */
  async listTags(): Promise<TagDefinition[]> {
    const { data, error } = await this.apiClient.GET("/api/prompts/tags");
    if (error) this.handleApiError("list tags", error);
    return data;
  }

  /**
   * Creates a custom prompt tag for the organization.
   * @param params.name The tag name (must match /^[a-z][a-z0-9_-]*$/).
   * @returns The created tag.
   * @throws {PromptsApiError} If the API call fails.
   */
  async createTag({ name }: { name: string }): Promise<CreatedTag> {
    const { data, error } = await this.apiClient.POST("/api/prompts/tags", {
      body: { name },
    });
    if (error) this.handleApiError("create tag", error);
    return data;
  }

  /**
   * Deletes a custom prompt tag by name.
   * @param tagName The tag name to delete.
   * @throws {PromptsApiError} If the API call fails.
   */
  async deleteTag(tagName: string): Promise<void> {
    const { error } = await this.apiClient.DELETE(
      "/api/prompts/tags/{tag}" as any,
      { params: { path: { tag: tagName } } } as any,
    );
    if (error) this.handleApiError(`delete tag "${tagName}"`, error);
  }

  /**
   * Renames an existing prompt tag.
   * @param tag The current tag name.
   * @param name The new tag name.
   * @throws {PromptsApiError} If the API call fails.
   */
  async renameTag({ tag, name }: { tag: string; name: string }): Promise<void> {
    const { error } = await this.apiClient.PUT(
      "/api/prompts/tags/{tag}",
      { params: { path: { tag } }, body: { name } },
    );
    if (error) this.handleApiError(`rename tag "${tag}"`, error);
  }

  async assignTag({
    id,
    tag,
    versionId,
  }: {
    id: string;
    tag: string;
    versionId: string;
  }): Promise<AssignTagResult> {
    const { data, error } = await this.apiClient.PUT(
      "/api/prompts/{id}/tags/{tag}",
      {
        params: { path: { id, tag } },
        body: { versionId },
      },
    );
    if (error) this.handleApiError(`assign tag "${tag}" to prompt "${id}"`, error);
    return data;
  }

  /**
   * Deletes a prompt by its ID.
   * @param id The prompt's unique identifier.
   * @throws {PromptsApiError} If the API call fails.
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
   * @throws {PromptsApiError} If the API call fails.
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
   * @throws {PromptsApiError} If the API call fails.
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
   * You probably don't need to use this method directly.
   */
  async sync(params: {
    name: string;
    configData: ConfigData;
    localVersion?: number;
    commitMessage?: string;
  }): Promise<SyncResult> {
    // openapi-fetch returns `{ data?, error?, response }`; we only need
    // these fields from the response so an explicit shape keeps the
    // no-redundant-type-constituents lint happy (the generic POST return is
    // widened to `any` by the generated types).
    interface SyncApiResponse {
      data?: unknown;
      error?: unknown;
      response?: { status?: number };
    }
    let response: SyncApiResponse | undefined;
    try {
      response = await this.apiClient.POST(
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
    } catch (error) {
      // Transport-level failures (network errors, timeouts, unresolved DNS)
      // surface here. Preserve the underlying message so the user knows
      // whether the API is reachable.
      const message = formatApiErrorForOperation({ operation: "sync prompt", error: error });
      throw new PromptsApiError(message, "sync", error);
    }

    if (response?.error) {
      const err: unknown = response.error;
      const status =
        response.response?.status ?? extractStatusFromResponse(err);
      const message = formatApiErrorMessage({ error: err, options: { status } });
      throw new PromptsApiError(
        `Failed to sync prompt: ${message}`,
        "sync",
        err,
      );
    }

    const data = response?.data as SyncResult | undefined;
    if (!data) {
      throw new PromptsApiError(
        "Failed to sync prompt: server returned no data",
        "sync",
        response,
      );
    }
    return {
      action: data.action,
      prompt: data.prompt,
      conflictInfo: data.conflictInfo,
    };
  }
}
