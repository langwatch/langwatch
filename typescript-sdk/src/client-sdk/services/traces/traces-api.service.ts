import type { paths } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";

export type TraceSearchBody = NonNullable<
  paths["/api/traces/search"]["post"]["requestBody"]
>["content"]["application/json"];

export type TraceSearchResponse =
  paths["/api/traces/search"]["post"]["responses"]["200"]["content"]["application/json"];

type TraceGetResponseRaw =
  paths["/api/traces/{traceId}"]["get"]["responses"]["200"]["content"]["application/json"];

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

    throw new TracesApiError(
      `Failed to ${operation}: ${errorMessage}`,
      operation,
      error,
    );
  }

  async search(params: TraceSearchBody): Promise<TraceSearchResponse> {
    const { data, error } = await this.apiClient.POST("/api/traces/search", {
      body: params,
    });
    if (error) this.handleApiError("search traces", error);
    return data;
  }

  async get(traceId: string, options?: { format?: "digest" | "json" }): Promise<TraceGetResponse> {
    const { data, error } = await this.apiClient.GET(
      "/api/traces/{traceId}",
      {
        params: {
          path: { traceId },
          query: options,
        },
      },
    );
    if (error) this.handleApiError(`get trace "${traceId}"`, error);
    return data;
  }
}
