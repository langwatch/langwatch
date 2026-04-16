import type { paths } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";

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
    const message = formatApiErrorForOperation(operation, error, {
      status: extractStatusFromResponse(error),
    });
    throw new AnalyticsApiError(message, operation, error);
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
