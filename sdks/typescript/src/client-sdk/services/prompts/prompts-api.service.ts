import { z } from "zod";
import type { paths, operations } from "@/internal/generated/openapi/api-client";
import { type PromptResponse, type TagDefinition, type CreatedTag } from "./types";
import { PromptConverter } from "@/cli/utils/promptConverter";
import { PromptServiceTracingDecorator, tracer } from "./tracing";
import { createTracingProxy } from "@/client-sdk/tracing/create-tracing-proxy";
import { type InternalConfig } from "@/client-sdk/types";
import { type CreatePromptBody, type UpdatePromptBody } from "./types";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import { isLangWatchHandledError } from "@/internal/api/errors";
import { PromptsApiError } from "./errors";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
  formatApiErrorMessage,
} from "@/client-sdk/services/_shared/format-api-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";
import type { RuntimeParameters } from "@/cli/types";

const syncActionSchema = z.enum(["created", "updated", "conflict", "up_to_date"]);

export type SyncAction = z.infer<typeof syncActionSchema>;

const syncResultSchema = z.object({
  action: syncActionSchema,
  // `prompt` and `conflictInfo` are passed through untyped — they come from
  // the OpenAPI-derived shape which is already validated on the server side.
  prompt: z.unknown().optional(),
  conflictInfo: z
    .object({
      localVersion: z.number(),
      remoteVersion: z.number(),
      differences: z.array(z.string()),
      remoteConfigData: z.unknown(),
    })
    .passthrough()
    .optional(),
});

export type AssignTagResult = NonNullable<
  operations["putApiPromptsByIdTagsByTag"]["responses"]["200"]["content"]["application/json"]
>;

export type ConfigData = NonNullable<
  paths["/api/v1/prompts/{id}/sync"]["post"]["requestBody"]
>["content"]["application/json"]["configData"];

export interface SyncResult {
  action: SyncAction;
  prompt?: PromptResponse;
  conflictInfo?: {
    localVersion: number;
    remoteVersion: number;
    differences: string[];
    remoteConfigData: ConfigData;
    remoteParameters?: RuntimeParameters;
  };
}

/**
 * Service for managing prompt resources via the Langwatch API. Constructor creates a proxy
 * that wraps the service and traces all methods.
 */
export class PromptsApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();

    /**
     * Wraps the service in a tracing proxy via the decorator.
     */
    return createTracingProxy(this as PromptsApiService, tracer, PromptServiceTracingDecorator);
  }

  /**
   * Handles API errors by throwing a PromptsApiError with operation context. @throws
   * @param operation Description of the operation being performed.
   * @param error The error object returned from the API client.
   */
  private handleApiError(operation: string, error: unknown, response?: Response): never {
    const resolvedStatus = response?.status ?? extractStatusFromResponse(error);
    const message = formatApiErrorForOperation({
      operation: operation,
      error: error,
      options: {
        status: resolvedStatus,
      },
    });

    throw new PromptsApiError(message, operation, error);
  }

  /**
   * Fetches all prompts from the API.
   * @returns Array of raw PromptResponse data.
   * @throws {PromptsApiError} If the API call fails.
   */
  async getAll(): Promise<PromptResponse[]> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/prompts");
    return unwrapApiResult({
      operation: "fetch all prompts",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * Fetches a single prompt by its ID.
   * @param id The prompt's unique identifier.
   * @param options Optional version or tag to fetch.
   */
  get = async (
    id: string,
    options?: { version?: string; tag?: string },
  ): Promise<PromptResponse> => {
    // Parse version to number, skip for "latest" or invalid values
    const versionNumber =
      options?.version && options.version !== "latest" ? parseInt(options.version, 10) : undefined;

    const { data, error, response } = await this.apiClient.GET("/api/v1/prompts/{id}", {
      params: {
        path: { id },
        query: {
          version: Number.isNaN(versionNumber) ? undefined : versionNumber,
          tag: options?.tag,
        },
      },
    });

    return unwrapApiResult({
      operation: `fetch prompt with ID "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  };

  /**
   * Validates if a prompt exists. @throws {PromptsApiError} If the API call fails (not 404).
   * @param id The prompt's unique identifier.
   * @returns True if prompt exists, false otherwise.
   */
  async exists(id: string): Promise<boolean> {
    try {
      await this.get(id);
      return true;
    } catch (error) {
      // A named 404 from the platform ("prompt_not_found") now arrives typed, so
      // read the status off the domain error first. Without this, the very thing
      // that makes the failure legible — the platform naming it — would stop
      // `exists()` recognising a missing prompt and turn a `false` into a throw.
      if (isLangWatchHandledError(error) && error.httpStatus === 404) {
        return false;
      }

      const originalError = error instanceof PromptsApiError ? error.originalError : null;
      const statusCode =
        originalError != null && typeof originalError === "object" && "statusCode" in originalError
          ? (originalError as { statusCode: unknown }).statusCode
          : null;

      if (statusCode === 404) {
        return false;
      }

      throw error;
    }
  }

  /**
   * Creates a new prompt. @throws {PromptsApiError} If the API call fails.
   * @param params The prompt creation payload, matching the OpenAPI schema.
   * @returns Raw PromptResponse data of the created prompt.
   */
  async create(params: CreatePromptBody): Promise<PromptResponse> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/prompts", {
      body: params,
    });
    return unwrapApiResult({
      operation: "create prompt",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * @param id The prompt's unique identifier.
   * @param params The update payload, matching the OpenAPI schema.
   * @returns Raw PromptResponse data of the updated prompt.
   */
  async update(id: string, params: UpdatePromptBody): Promise<PromptResponse> {
    const { error, data, response } = await this.apiClient.PUT("/api/v1/prompts/{id}", {
      params: { path: { id } },
      body: params,
    });
    return unwrapApiResult({
      operation: `update prompt with ID "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * Lists all prompt tags (built-in and custom) for the organization.
   * @returns Array of tag definitions.
   * @throws {PromptsApiError} If the API call fails.
   */
  async listTags(): Promise<TagDefinition[]> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/prompts/tags");
    return unwrapApiResult({
      operation: "list tags",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * Creates a custom prompt tag for the organization. @throws {PromptsApiError} If the API
   * @param params.name The tag name (must match /^[a-z][a-z0-9_-]*$/).
   * @returns The created tag.
   */
  async createTag({ name }: { name: string }): Promise<CreatedTag> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/prompts/tags", {
      body: { name },
    });
    return unwrapApiResult({
      operation: "create tag",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * Deletes a custom prompt tag by name.
   * @param tagName The tag name to delete.
   * @throws {PromptsApiError} If the API call fails.
   */
  async deleteTag(tagName: string): Promise<void> {
    const { data, error, response } = await this.apiClient.DELETE(
      "/api/v1/prompts/tags/{tag}" as any,
      { params: { path: { tag: tagName } } } as any,
    );
    unwrapApiResult({
      operation: `delete tag "${tagName}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
      allowEmpty: true,
    });
  }

  /**
   * Renames an existing prompt tag. @throws {PromptsApiError} If the API call fails.
   * @param tag The current tag name.
   * @param name The new tag name.
   */
  async renameTag({ tag, name }: { tag: string; name: string }): Promise<void> {
    const { data, error, response } = await this.apiClient.PUT("/api/v1/prompts/tags/{tag}", {
      params: { path: { tag } },
      body: { name },
    });
    unwrapApiResult({
      operation: `rename tag "${tag}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
      allowEmpty: true,
    });
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
    const { data, error, response } = await this.apiClient.PUT("/api/v1/prompts/{id}/tags/{tag}", {
      params: { path: { id, tag } },
      body: { versionId },
    });
    return unwrapApiResult({
      operation: `assign tag "${tag}" to prompt "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * Deletes a prompt by its ID.
   * @param id The prompt's unique identifier.
   * @throws {PromptsApiError} If the API call fails.
   */
  async delete(id: string): Promise<{ success: boolean }> {
    const { data, error, response } = await this.apiClient.DELETE("/api/v1/prompts/{id}", {
      params: { path: { id } },
    });
    return unwrapApiResult({
      operation: `delete prompt with ID "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * Fetches all versions for a given prompt. @throws {PromptsApiError} If the API call
   * @param id The prompt's unique identifier.
   * @returns Array of raw PromptResponse data for each version.
   */
  async getVersions(id: string): Promise<PromptResponse[]> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/prompts/{id}/versions", {
      params: { path: { id } },
    });
    return unwrapApiResult({
      operation: `fetch versions for prompt with ID "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * @param handle The prompt's handle/identifier.
   * @param config Local prompt configuration.
   * @returns Object with created flag and raw PromptResponse data.
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
      parameters?: RuntimeParameters;
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
      parameters: config.parameters ?? {},
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
    parameters?: RuntimeParameters;
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
      response = await this.apiClient.POST("/api/v1/prompts/{id}/sync", {
        params: { path: { id: params.name } },
        body: {
          configData: params.configData,
          parameters: params.parameters ?? {},
          localVersion: params.localVersion,
          commitMessage: params.commitMessage,
        },
      });
    } catch (error) {
      // Transport-level failures (network errors, timeouts, unresolved DNS)
      // surface here. Preserve the underlying message so the user knows
      // whether the API is reachable.
      const message = formatApiErrorForOperation({
        operation: "sync prompt",
        error: error,
      });
      throw new PromptsApiError(message, "sync", error);
    }

    if (response?.error) {
      const err: unknown = response.error;
      const status = response.response?.status ?? extractStatusFromResponse(err);
      const message = formatApiErrorMessage({ error: err, options: { status } });
      throw new PromptsApiError(`Failed to sync prompt: ${message}`, "sync", err);
    }

    // Validate the shape at the boundary so a malformed 2xx payload
    // (e.g. `{ action: undefined }`) surfaces as a PromptsApiError here
    // instead of crashing downstream code with a confusing stack trace.
    const parsed = syncResultSchema.safeParse(response?.data);
    if (!parsed.success) {
      throw new PromptsApiError(
        "Failed to sync prompt: server returned an invalid response body",
        "sync",
        response?.data ?? response,
      );
    }
    return {
      action: parsed.data.action,
      prompt: parsed.data.prompt as SyncResult["prompt"],
      conflictInfo: parsed.data.conflictInfo as SyncResult["conflictInfo"],
    };
  }
}
