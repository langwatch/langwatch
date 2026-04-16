import type { paths } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import type { InternalConfig } from "@/client-sdk/types";

export type GraphResponse = NonNullable<
  paths["/api/graphs"]["get"]["responses"]["200"]["content"]["application/json"]
>[number];

export type CreateGraphBody = NonNullable<
  paths["/api/graphs"]["post"]["requestBody"]
>["content"]["application/json"];

export type UpdateGraphBody = NonNullable<
  paths["/api/graphs/{id}"]["patch"]["requestBody"]
>["content"]["application/json"];

export type GraphDeleteResponse =
  paths["/api/graphs/{id}"]["delete"]["responses"]["200"]["content"]["application/json"];

export class GraphsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "GraphsApiError";
  }
}

export class GraphsApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
  }

  private handleApiError(operation: string, error: unknown): never {
    const errorMessage =
      typeof error === "string"
        ? error
        : error != null &&
            typeof error === "object" &&
            "error" in error &&
            error.error != null
          ? typeof error.error === "string"
            ? error.error
            : (error.error as { message?: string }).message ??
              JSON.stringify(error.error)
          : error instanceof Error
            ? error.message
            : "Unknown error occurred";

    throw new GraphsApiError(
      `Failed to ${operation}: ${errorMessage}`,
      operation,
      error,
    );
  }

  async getAll(dashboardId?: string): Promise<GraphResponse[]> {
    const { data, error } = await this.apiClient.GET("/api/graphs", {
      params: { query: { dashboardId } },
    });
    if (error) this.handleApiError("list graphs", error);
    return data;
  }

  async get(id: string): Promise<GraphResponse> {
    const { data, error } = await this.apiClient.GET("/api/graphs/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`get graph "${id}"`, error);
    return data;
  }

  async create(params: CreateGraphBody): Promise<GraphResponse> {
    const { data, error } = await this.apiClient.POST("/api/graphs", {
      body: params,
    });
    if (error) this.handleApiError("create graph", error);
    return data;
  }

  async update(id: string, params: UpdateGraphBody): Promise<GraphResponse> {
    const { data, error } = await this.apiClient.PATCH("/api/graphs/{id}", {
      params: { path: { id } },
      body: params,
    });
    if (error) this.handleApiError(`update graph "${id}"`, error);
    return data;
  }

  async delete(id: string): Promise<GraphDeleteResponse> {
    const { data, error } = await this.apiClient.DELETE("/api/graphs/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`delete graph "${id}"`, error);
    return data;
  }
}
