import type { paths } from "@/internal/generated/openapi/api-client";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import type { InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";

export type GraphResponse = NonNullable<
  paths["/api/v1/graphs"]["get"]["responses"]["200"]["content"]["application/json"]
>[number];

export type CreateGraphBody = NonNullable<
  paths["/api/v1/graphs"]["post"]["requestBody"]
>["content"]["application/json"];

export type UpdateGraphBody = NonNullable<
  paths["/api/v1/graphs/{id}"]["patch"]["requestBody"]
>["content"]["application/json"];

export type GraphDeleteResponse =
  paths["/api/v1/graphs/{id}"]["delete"]["responses"]["200"]["content"]["application/json"];

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

  private handleApiError(operation: string, error: unknown, response?: Response): never {
    const message = formatApiErrorForOperation({
      operation: operation,
      error: error,
      options: {
        status: response?.status ?? extractStatusFromResponse(error),
      },
    });
    throw new GraphsApiError(message, operation, error);
  }

  async getAll(dashboardId?: string): Promise<GraphResponse[]> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/graphs", {
      params: { query: { dashboardId } },
    });
    return unwrapApiResult({
      operation: "list graphs",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async get(id: string): Promise<GraphResponse> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/graphs/{id}", {
      params: { path: { id } },
    });
    return unwrapApiResult({
      operation: `get graph "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async create(params: CreateGraphBody): Promise<GraphResponse> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/graphs", {
      body: params,
    });
    return unwrapApiResult({
      operation: "create graph",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async update(id: string, params: UpdateGraphBody): Promise<GraphResponse> {
    const { data, error, response } = await this.apiClient.PATCH("/api/v1/graphs/{id}", {
      params: { path: { id } },
      body: params,
    });
    return unwrapApiResult({
      operation: `update graph "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async delete(id: string): Promise<GraphDeleteResponse> {
    const { data, error, response } = await this.apiClient.DELETE("/api/v1/graphs/{id}", {
      params: { path: { id } },
    });
    return unwrapApiResult({
      operation: `delete graph "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }
}
