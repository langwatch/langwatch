import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "../internal/api/client";
import type { paths } from "../internal/generated/openapi/api-client";
import { Prompt } from "./prompt";

// Extract types directly from OpenAPI schema for strong type safety.
type CreatePromptBody = NonNullable<
  paths["/api/prompts"]["post"]["requestBody"]
>["content"]["application/json"];
type UpdatePromptBody = NonNullable<
  paths["/api/prompts/{id}"]["put"]["requestBody"]
>["content"]["application/json"];
type CreateVersionBody = NonNullable<
  paths["/api/prompts/{id}/versions"]["post"]["requestBody"]
>["content"]["application/json"];

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
   * @returns The Prompt instance.
   * @throws {PromptsError} If the API call fails.
   */
  async get(id: string): Promise<Prompt> {
    const { data, error } = await this.client.GET("/api/prompts/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`fetch prompt with ID "${id}"`, error);
    return new Prompt(data);
  }

  /**
   * Creates a new prompt.
   * @param params The prompt creation payload, matching the OpenAPI schema.
   * @returns The created Prompt instance.
   * @throws {PromptsError} If the API call fails.
   */
  async create(params: CreatePromptBody): Promise<Prompt> {
    const { data, error } = await this.client.POST("/api/prompts", {
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
    return await this.get(id);
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
  async getVersions(
    id: string,
  ): Promise<Record<string, Prompt>> {
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
    return await this.get(id);
  }
}
