import type { paths } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";

export type AnalyticsTimeseriesBody = NonNullable<
  paths["/api/analytics/timeseries"]["post"]["requestBody"]
>["content"]["application/json"];

export type AnalyticsTimeseriesResponse =
  paths["/api/analytics/timeseries"]["post"]["responses"]["200"]["content"]["application/json"];

export class AnalyticsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "AnalyticsApiError";
  }
}

export class AnalyticsApiService {
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

    throw new AnalyticsApiError(
      `Failed to ${operation}: ${errorMessage}`,
      operation,
      error,
    );
  }

  async timeseries(params: AnalyticsTimeseriesBody): Promise<AnalyticsTimeseriesResponse> {
    const { data, error } = await this.apiClient.POST(
      "/api/analytics/timeseries",
      { body: params },
    );
    if (error) this.handleApiError("query analytics", error);
    return data;
  }
}
