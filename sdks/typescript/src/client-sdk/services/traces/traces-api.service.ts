import type { paths } from "@/internal/generated/openapi/api-client";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";

export type TraceSearchBody = NonNullable<
  paths["/api/v1/traces/search"]["post"]["requestBody"]
>["content"]["application/json"];

export type TraceSearchResponse =
  paths["/api/v1/traces/search"]["post"]["responses"]["200"]["content"]["application/json"];

type TraceGetResponseRaw =
  paths["/api/v1/traces/{traceId}"]["get"]["responses"]["200"]["content"]["application/json"];

export type TraceGetResponse = TraceGetResponseRaw extends string
  ? TraceGetResponseRaw
  : TraceGetResponseRaw extends object
    ? TraceGetResponseRaw & {
        /** URL to view this trace on the LangWatch platform */
        platformUrl?: string;
      }
    : TraceGetResponseRaw;

export class TracesApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
    /**
     * The HTTP status the platform answered with.
     */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "TracesApiError";
  }
}

export class TracesApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
  }

  private handleApiError(operation: string, error: unknown, response?: Response): never {
    const status = response?.status ?? extractStatusFromResponse(error);
    const message = formatApiErrorForOperation({
      operation: operation,
      error: error,
      options: {
        status,
      },
    });
    throw new TracesApiError(message, operation, error, status);
  }

  async search(params: TraceSearchBody): Promise<TraceSearchResponse> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/traces/search", {
      body: params,
    });
    return unwrapApiResult({
      operation: "search traces",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async get(traceId: string, options?: { format?: "digest" | "json" }): Promise<TraceGetResponse> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/traces/{traceId}", {
      params: {
        path: { traceId },
        query: options,
      },
    });
    return unwrapApiResult({
      operation: `get trace "${traceId}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }
}
