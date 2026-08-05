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
    /**
     * The HTTP status the platform answered with.
     *
     * The client returns the `Response` alongside the error body and this used to
     * be dropped, which meant a caller could recover WHAT went wrong (the body's
     * error kind) but never whether the platform had declined the request (4xx) or
     * fallen over (5xx) — a distinction the CLI's live error events, and anything
     * else deciding whether to blame the user, depend on.
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

  private handleApiError(
    operation: string,
    error: unknown,
    response?: Response,
  ): never {
    const status = response?.status ?? extractStatusFromResponse(error);
    const message = formatApiErrorForOperation({ operation: operation, error: error, options: {
      status,
    } });
    throw new TracesApiError(message, operation, error, status);
  }

  async search(params: TraceSearchBody): Promise<TraceSearchResponse> {
    const { data, error, response } = await this.apiClient.POST("/api/traces/search", {
      body: params,
    });
    if (error) this.handleApiError("search traces", error, response);
    return data;
  }

  async get(traceId: string, options?: { format?: "digest" | "json" }): Promise<TraceGetResponse> {
    const { data, error, response } = await this.apiClient.GET(
      "/api/traces/{traceId}",
      {
        params: {
          path: { traceId },
          query: options,
        },
      },
    );
    if (error) this.handleApiError(`get trace "${traceId}"`, error, response);
    return data;
  }
}
