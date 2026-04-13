import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";

export interface DashboardSummary {
  id: string;
  name: string;
  order: number;
  graphCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardDetail {
  id: string;
  name: string;
  order: number;
  graphs: unknown[];
  createdAt: string;
  updatedAt: string;
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

    throw new DashboardsApiError(
      `Failed to ${operation}: ${errorMessage}`,
      operation,
      error,
    );
  }

  async list(): Promise<{ data: DashboardSummary[] }> {
    const { data, error } = await this.apiClient.GET("/api/dashboards");
    if (error) this.handleApiError("list dashboards", error);
    return data as unknown as { data: DashboardSummary[] };
  }

  async get(id: string): Promise<DashboardDetail> {
    const { data, error } = await this.apiClient.GET("/api/dashboards/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`get dashboard "${id}"`, error);
    return data as unknown as DashboardDetail;
  }

  async create(params: { name: string }): Promise<DashboardDetail> {
    const { data, error } = await this.apiClient.POST("/api/dashboards", {
      body: params,
    });
    if (error) this.handleApiError("create dashboard", error);
    return data as unknown as DashboardDetail;
  }

  async rename(id: string, params: { name: string }): Promise<DashboardDetail> {
    const { data, error } = await this.apiClient.PATCH("/api/dashboards/{id}", {
      params: { path: { id } },
      body: params,
    });
    if (error) this.handleApiError(`rename dashboard "${id}"`, error);
    return data as unknown as DashboardDetail;
  }

  async delete(id: string): Promise<{ id: string; name: string }> {
    const { data, error } = await this.apiClient.DELETE("/api/dashboards/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`delete dashboard "${id}"`, error);
    return data as unknown as { id: string; name: string };
  }
}
