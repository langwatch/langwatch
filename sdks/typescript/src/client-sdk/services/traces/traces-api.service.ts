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

/**
 * What `GET /api/traces/facets` takes.
 *
 * `field` is what splits the two answers: without it the endpoint describes
 * every facet the project has, with it one field's values.
 */
export type TraceFacetsQuery = NonNullable<
  paths["/api/traces/facets"]["get"]["parameters"]["query"]
>;

export type TraceFacetsResponse =
  paths["/api/traces/facets"]["get"]["responses"]["200"]["content"]["application/json"];

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

  /**
   * What the trace filter fields actually hold in this project.
   *
   * The values the query reference deliberately omits: they are tenant data
   * that moves under the caller, so they live here and the reference names this
   * door instead of inlining a snapshot of it.
   */
  async facets(query?: TraceFacetsQuery): Promise<TraceFacetsResponse> {
    const { data, error, response } = await this.apiClient.GET(
      "/api/traces/facets",
      { params: { query: query ?? {} } },
    );
    if (error) this.handleApiError("read trace facets", error, response);
    return data;
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
