import type { paths } from "@/internal/generated/openapi/api-client";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";

/** The typed columns/rows/statistics payload `POST /api/v1/query` answers with. */
export type QueryRunResult =
  paths["/api/v1/query"]["post"]["responses"]["200"]["content"]["application/json"];

/** The queryable dataset/column catalog `GET /api/v1/query/schema` answers with. */
export type QuerySchemaResult =
  paths["/api/v1/query/schema"]["get"]["responses"]["200"]["content"]["application/json"];

/**
 * The body a query request sends.
 */
export type QueryRunParams = NonNullable<
  paths["/api/v1/query"]["post"]["requestBody"]
>["content"]["application/json"];

export class QueryApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
    /**
     * The HTTP status the platform answered with, when the response was kept.
     * Without it the CLI's error reader can only guess `network_error` for a
     * failure the platform named precisely — same rationale as `TracesApiError`.
     */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "QueryApiError";
  }
}

/**
 * Typed client for the LangWatchQL query doors (`POST /api/v1/query` and `GET
 * /api/v1/query/schema`) — the same governed query surface the workbench and saved charts
 * run through, exposed directly rather than only via a saved chart's statement.
 */
export class QueryApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
  }

  private handleApiError(operation: string, error: unknown, response?: Response): never {
    const status = response?.status ?? extractStatusFromResponse(error);
    const message = formatApiErrorForOperation({
      operation: operation,
      error,
      options: { status },
    });
    // A failure the platform NAMED (a code, a status, a meta bag) is raised as the typed
    // `LangWatchHandledError`, so the CLI's error output carries the real code instead of
    // degrading everything to `network_error`. The canonical envelope arrives at the top level
    // of the body here, exactly where the shared reader looks — this family publishes the same
    // error shape as every other one.
    throwIfHandledError({ operation, error, response, message });
    throw new QueryApiError(message, operation, error, status);
  }

  /**
   * Runs one read-only LangWatchQL `SELECT` over the analytics datasets and
   * returns typed columns, rows, execution statistics, truncation state and
   * diagnostics, scoped to the caller's project.
   */
  async query(params: QueryRunParams): Promise<QueryRunResult> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/query", { body: params });
    return unwrapApiResult({
      operation: "run query",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * Lists the LangWatchQL analytics datasets this key may query, with each column's type,
   * description, the permissions that unlock it, and whether this caller holds them — plus
   * each dataset's grain, join keys, partition-pruning time column, freshness and a runnable
   */
  async schema(): Promise<QuerySchemaResult> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/query/schema", {});
    return unwrapApiResult({
      operation: "discover query schema",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }
}
