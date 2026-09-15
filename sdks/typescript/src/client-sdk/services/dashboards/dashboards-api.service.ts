import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";

export interface DashboardSummary {
  id: string;
  name: string;
  order: number;
  graphCount: number;
  createdAt: string;
  updatedAt: string;
  platformUrl?: string;
}

export interface DashboardDetail {
  id: string;
  name: string;
  order: number;
  graphs: unknown[];
  createdAt: string;
  updatedAt: string;
  platformUrl?: string;
}

export class DashboardsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "DashboardsApiError";
  }
}

export class DashboardsApiService {
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
    throw new DashboardsApiError(message, operation, error);
  }

  async list(): Promise<{ data: DashboardSummary[] }> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/dashboards");
    return unwrapApiResult({
      operation: "list dashboards",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as { data: DashboardSummary[] };
  }

  async get(id: string): Promise<DashboardDetail> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/dashboards/{id}", {
      params: { path: { id } },
    });
    return unwrapApiResult({
      operation: `get dashboard "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as DashboardDetail;
  }

  async create(params: { name: string }): Promise<DashboardDetail> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/dashboards", {
      body: params,
    });
    return unwrapApiResult({
      operation: "create dashboard",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as DashboardDetail;
  }

  async rename(id: string, params: { name: string }): Promise<DashboardDetail> {
    const { data, error, response } = await this.apiClient.PATCH("/api/v1/dashboards/{id}", {
      params: { path: { id } },
      body: params,
    });
    return unwrapApiResult({
      operation: `rename dashboard "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as DashboardDetail;
  }

  async delete(id: string): Promise<{ id: string; name: string }> {
    const { data, error, response } = await this.apiClient.DELETE("/api/v1/dashboards/{id}", {
      params: { path: { id } },
    });
    return unwrapApiResult({
      operation: `delete dashboard "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as { id: string; name: string };
  }
}
