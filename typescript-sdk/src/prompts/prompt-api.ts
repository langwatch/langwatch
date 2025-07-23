import { client } from "../api-client/client";
import type { paths } from "../api-client/langwatch-openapi";

interface PromptsServiceDeps {
  client: typeof client;
}

// Extract types directly from OpenAPI schema
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
 */
export class PromptsError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = "PromptsError";
  }
}

/**
 * PromptsService handles prompt-related API operations with proper type safety.
 * Relies on TypeScript for type validation and API for business logic validation.
 */
export class PromptsService {
  private client: typeof client;

  constructor(options?: { deps: PromptsServiceDeps }) {
    this.client = options?.deps.client ?? client;
  }

  private handleApiError(operation: string, error: any): never {
    const errorMessage =
      typeof error === "string"
        ? error
        : error?.error ?? error?.message ?? "Unknown error occurred";
    throw new PromptsError(
      `Failed to ${operation}: ${errorMessage}`,
      operation,
      error
    );
  }

  async getAll() {
    const { data, error } = await this.client.GET("/api/prompts");
    if (error) this.handleApiError("fetch all prompts", error);
    return data;
  }

  async get(id: string) {
    const { data, error } = await this.client.GET("/api/prompts/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`fetch prompt with ID "${id}"`, error);
    return data;
  }

  async create(params: CreatePromptBody) {
    const { data, error } = await this.client.POST("/api/prompts", {
      body: params,
    });
    if (error) this.handleApiError("create prompt", error);
    return data;
  }

  async update(id: string, params: UpdatePromptBody) {
    const { data, error } = await this.client.PUT("/api/prompts/{id}", {
      params: { path: { id } },
      body: params,
    });
    if (error) this.handleApiError(`update prompt with ID "${id}"`, error);
    return data;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client.DELETE("/api/prompts/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`delete prompt with ID "${id}"`, error);
  }

  async getVersions(id: string) {
    const { data, error } = await this.client.GET(
      "/api/prompts/{id}/versions",
      {
        params: { path: { id } },
      }
    );
    if (error)
      this.handleApiError(`fetch versions for prompt with ID "${id}"`, error);
    return data;
  }

  async createVersion(id: string, params: CreateVersionBody) {
    const { data, error } = await this.client.POST(
      "/api/prompts/{id}/versions",
      {
        params: { path: { id } },
        body: params,
      }
    );
    if (error)
      this.handleApiError(`create version for prompt with ID "${id}"`, error);
    return data;
  }
}
