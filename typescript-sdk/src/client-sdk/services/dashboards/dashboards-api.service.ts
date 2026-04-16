import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";

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

  private handleApiError(operation: string, error: unknown): never {
    const message = formatApiErrorForOperation(operation, error, {
      status: extractStatusFromResponse(error),
    });
    throw new DashboardsApiError(message, operation, error);
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
