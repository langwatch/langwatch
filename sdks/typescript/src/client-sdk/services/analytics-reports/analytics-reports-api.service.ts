import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";
import { type InternalConfig } from "@/client-sdk/types";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";

/** One Analytics Report in the list, with how many graphs it holds. */
export interface AnalyticsReportSummary {
  id: string;
  name: string;
  order: number;
  graphCount: number;
  createdAt: string;
  updatedAt: string;
  platformUrl?: string;
}

/** One Analytics Report with its graphs. */
export interface AnalyticsReportDetail {
  id: string;
  name: string;
  order: number;
  graphs: unknown[];
  createdAt: string;
  updatedAt: string;
  platformUrl?: string;
}

export class AnalyticsReportsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
    /** The HTTP status the platform answered with, when the response was kept. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AnalyticsReportsApiError";
  }
}

/**
 * Typed client for the Analytics Reports at `/api/v1/analytics/reports`, deprecated by the
 * platform in favour of the Dashboards API (`DashboardsApiService`, `/api/v1/dashboards`).
 */
export class AnalyticsReportsApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
  }

  private handleApiError(operation: string, error: unknown, response?: Response): never {
    const status = response?.status ?? extractStatusFromResponse(error);
    const message = formatApiErrorForOperation({
      operation: operation,
      error: error,
      options: { status },
    });
    throwIfHandledError({ operation, error, response, message });
    throw new AnalyticsReportsApiError(message, operation, error, status);
  }

  async list(): Promise<{ data: AnalyticsReportSummary[] }> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/analytics/reports");
    return unwrapApiResult({
      operation: "list analytics reports",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as { data: AnalyticsReportSummary[] };
  }

  async get(id: string): Promise<AnalyticsReportDetail> {
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/analytics/reports/{reportId}",
      {
        params: { path: { reportId: id } },
      },
    );
    return unwrapApiResult({
      operation: `get analytics report "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as AnalyticsReportDetail;
  }

  async create(params: { name: string }): Promise<AnalyticsReportDetail> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/analytics/reports", {
      body: params,
    });
    return unwrapApiResult({
      operation: "create analytics report",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as AnalyticsReportDetail;
  }

  async rename(id: string, params: { name: string }): Promise<AnalyticsReportDetail> {
    const { data, error, response } = await this.apiClient.PATCH(
      "/api/v1/analytics/reports/{reportId}",
      {
        params: { path: { reportId: id } },
        body: params,
      },
    );
    return unwrapApiResult({
      operation: `rename analytics report "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as AnalyticsReportDetail;
  }

  async delete(id: string): Promise<{ id: string; name: string }> {
    const { data, error, response } = await this.apiClient.DELETE(
      "/api/v1/analytics/reports/{reportId}",
      {
        params: { path: { reportId: id } },
      },
    );
    return unwrapApiResult({
      operation: `delete analytics report "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as { id: string; name: string };
  }
}
