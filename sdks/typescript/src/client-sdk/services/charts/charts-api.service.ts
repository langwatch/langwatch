import type { paths } from "@/internal/generated/openapi/api-client";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import { scopedProjectId } from "@/internal/credentialContext";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";
import {
  QueryApiService,
  type QueryRunParams,
  type QueryRunResult,
  type QuerySchemaResult,
} from "@/client-sdk/services/query/query-api.service";

/** A saved workbench chart, exactly as the REST surface answers it. */
export type SavedChart =
  paths["/api/v1/projects/{projectId}/analytics/charts/{chartId}"]["get"]["responses"]["200"]["content"]["application/json"];

/** A scalar value a chart parameter may carry — the platform's own contract. */
export type ChartParameterValue = string | number | boolean | null;

/** The definition a create or update submits. */
export interface SavedChartDefinitionInput {
  version: 1;
  sql: string;
  parameters: Record<string, ChartParameterValue>;
  vegaLiteSpec?: Record<string, unknown>;
}

/**
 * The LangWatchQL analytics schema, as `GET /api/v1/query/schema` on the query door
 * answers it — the discovery endpoint this used to derive from (`GET
 * /api/v1/projects/{projectId}/analytics/schema`) was removed in favor of that door (issue
 */
export type AnalyticsSchema = QuerySchemaResult;

/**
 * The result of running a chart's statement through the LangWatchQL query door.
 */
export type ChartRunResult = QueryRunResult;

export class ChartsApiError extends Error {
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
    this.name = "ChartsApiError";
  }
}

/**
 * Typed client for the saved workbench chart family
 * (`/api/v1/projects/{projectId}/analytics/charts`).
 */
export class ChartsApiService {
  private readonly apiClient: LangwatchApiClient;
  private readonly configuredProjectId: string | undefined;
  /**
   * `schema()` and `runQuery()` delegate to the shared query door rather than a dedicated
   * chart-family route (issue #7565).
   */
  private readonly queryApi: QueryApiService;

  constructor(
    config?: Partial<Pick<InternalConfig, "langwatchApiClient">> & {
      projectId?: string;
    },
  ) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
    this.configuredProjectId = config?.projectId;
    this.queryApi = new QueryApiService({
      langwatchApiClient:
        config?.langwatchApiClient ??
        createLangWatchApiClient(undefined, undefined, this.resolvedProjectId()),
    });
  }

  private handleApiError(operation: string, error: unknown, response?: Response): never {
    const status = response?.status ?? extractStatusFromResponse(error);
    const message = formatApiErrorForOperation({
      operation: operation,
      error: error,
      options: { status },
    });
    // A failure the platform NAMED (a code, a status, a meta bag) is raised as
    // the typed `LangWatchHandledError`, so the CLI's error output carries the
    // real code instead of degrading everything to `network_error`.
    throwIfHandledError({ operation, error, response, message });
    throw new ChartsApiError(message, operation, error, status);
  }

  /**
   * The same `configuredProjectId ?? scopedProjectId() ?? env` chain `projectId()` throws
   * on, without the throw — for the one caller that must tolerate "no project" rather than
   * refuse on it: the query-door client build in the constructor above, which has to keep
   */
  private resolvedProjectId(): string | undefined {
    return this.configuredProjectId ?? scopedProjectId() ?? process.env.LANGWATCH_PROJECT_ID;
  }

  private projectId(operation: string): string {
    const projectId = this.resolvedProjectId();
    if (!projectId) {
      throw new ChartsApiError(
        "No project is in scope. Pass --project <slug-or-id>, or set LANGWATCH_PROJECT_ID.",
        operation,
      );
    }
    return projectId;
  }

  async list(): Promise<{ data: SavedChart[] }> {
    const projectId = this.projectId("list charts");
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/projects/{projectId}/analytics/charts",
      { params: { path: { projectId } } },
    );
    return unwrapApiResult({
      operation: "list charts",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as { data: SavedChart[] };
  }

  async get(id: string): Promise<SavedChart> {
    const projectId = this.projectId(`get chart "${id}"`);
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/projects/{projectId}/analytics/charts/{chartId}",
      { params: { path: { projectId, chartId: id } } },
    );
    return unwrapApiResult({
      operation: `get chart "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as SavedChart;
  }

  async create(params: {
    name: string;
    definition: SavedChartDefinitionInput;
  }): Promise<SavedChart> {
    const projectId = this.projectId("create chart");
    const { data, error, response } = await this.apiClient.POST(
      "/api/v1/projects/{projectId}/analytics/charts",
      { params: { path: { projectId } }, body: params },
    );
    return unwrapApiResult({
      operation: "create chart",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as SavedChart;
  }

  async update(
    id: string,
    params: { name?: string; definition?: SavedChartDefinitionInput },
  ): Promise<SavedChart> {
    const projectId = this.projectId(`update chart "${id}"`);
    const { data, error, response } = await this.apiClient.PATCH(
      "/api/v1/projects/{projectId}/analytics/charts/{chartId}",
      { params: { path: { projectId, chartId: id } }, body: params },
    );
    return unwrapApiResult({
      operation: `update chart "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as SavedChart;
  }

  /** Deletes a chart. The route answers `204` with no body, like `unplace`. */
  async delete(id: string): Promise<void> {
    const projectId = this.projectId(`delete chart "${id}"`);
    const { data, error, response } = await this.apiClient.DELETE(
      "/api/v1/projects/{projectId}/analytics/charts/{chartId}",
      { params: { path: { projectId, chartId: id } } },
    );
    unwrapApiResult({
      operation: `delete chart "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
      allowEmpty: true,
    });
  }

  async place(
    id: string,
    params: {
      dashboardId: string;
      gridColumn?: number;
      gridRow?: number;
      colSpan?: number;
      rowSpan?: number;
    },
  ): Promise<SavedChart> {
    const projectId = this.projectId(`place chart "${id}"`);
    const { data, error, response } = await this.apiClient.PUT(
      "/api/v1/projects/{projectId}/analytics/charts/{chartId}/placement",
      { params: { path: { projectId, chartId: id } }, body: params },
    );
    return unwrapApiResult({
      operation: `place chart "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as SavedChart;
  }

  async unplace(id: string): Promise<void> {
    const projectId = this.projectId(`unplace chart "${id}"`);
    const { data, error, response } = await this.apiClient.DELETE(
      "/api/v1/projects/{projectId}/analytics/charts/{chartId}/placement",
      { params: { path: { projectId, chartId: id } } },
    );
    unwrapApiResult({
      operation: `unplace chart "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
      allowEmpty: true,
    });
  }

  /**
   * The datasets and columns this key may write chart SQL against.
   */
  async schema(): Promise<AnalyticsSchema> {
    return this.queryApi.schema();
  }

  /**
   * Runs a saved chart's statement through the LangWatchQL query door — the same governed
   * execution path the workbench uses.
   */
  async runQuery(params: {
    sql: string;
    parameters?: Record<string, ChartParameterValue>;
    timeWindow?: { start: string; end: string };
    /**
     * Narrowed to the steps the door actually offers, straight from the
     * generated request body — an off-list number is a compile error here
     * rather than a `validation_error` from the platform at run time.
     */
    granularitySeconds?: QueryRunParams["granularitySeconds"];
  }): Promise<ChartRunResult> {
    return this.queryApi.query(params);
  }
}
