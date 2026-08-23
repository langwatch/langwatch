import type { paths } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { scopedProjectId } from "@/internal/credentialContext";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";

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

/** The LangWatchQL analytics schema, as the discovery endpoint answers it. */
export type AnalyticsSchema =
  paths["/api/v1/projects/{projectId}/analytics/schema"]["get"]["responses"]["200"]["content"]["application/json"];

/** The result of running a chart's statement through the LangWatchQL query door. */
export type ChartRunResult =
  paths["/api/v1/projects/{projectId}/analytics/query/clickhouse"]["post"]["responses"]["200"]["content"]["application/json"];

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
 *
 * The chart routes carry the project id in the path, unlike the older
 * project-implicit families, so the service resolves one once — the CLI's
 * request-scoped project first, then `LANGWATCH_PROJECT_ID` — and refuses
 * loudly when none is known rather than guessing.
 */
export class ChartsApiService {
  private readonly apiClient: LangwatchApiClient;
  private readonly configuredProjectId: string | undefined;

  constructor(
    config?: Pick<InternalConfig, "langwatchApiClient"> & {
      projectId?: string;
    },
  ) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
    this.configuredProjectId = config?.projectId;
  }

  private handleApiError(
    operation: string,
    error: unknown,
    response?: Response,
  ): never {
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

  private projectId(operation: string): string {
    const projectId =
      this.configuredProjectId ??
      scopedProjectId() ??
      process.env.LANGWATCH_PROJECT_ID;
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
    if (error) this.handleApiError("list charts", error, response);
    return data as unknown as { data: SavedChart[] };
  }

  async get(id: string): Promise<SavedChart> {
    const projectId = this.projectId(`get chart "${id}"`);
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/projects/{projectId}/analytics/charts/{chartId}",
      { params: { path: { projectId, chartId: id } } },
    );
    if (error) this.handleApiError(`get chart "${id}"`, error, response);
    return data as unknown as SavedChart;
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
    if (error) this.handleApiError("create chart", error, response);
    return data as unknown as SavedChart;
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
    if (error) this.handleApiError(`update chart "${id}"`, error, response);
    return data as unknown as SavedChart;
  }

  /** Deletes a chart. The route answers `204` with no body, like `unplace`. */
  async delete(id: string): Promise<void> {
    const projectId = this.projectId(`delete chart "${id}"`);
    const { error, response } = await this.apiClient.DELETE(
      "/api/v1/projects/{projectId}/analytics/charts/{chartId}",
      { params: { path: { projectId, chartId: id } } },
    );
    if (error) this.handleApiError(`delete chart "${id}"`, error, response);
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
    if (error) this.handleApiError(`place chart "${id}"`, error, response);
    return data as unknown as SavedChart;
  }

  async unplace(id: string): Promise<void> {
    const projectId = this.projectId(`unplace chart "${id}"`);
    const { error, response } = await this.apiClient.DELETE(
      "/api/v1/projects/{projectId}/analytics/charts/{chartId}/placement",
      { params: { path: { projectId, chartId: id } } },
    );
    if (error) this.handleApiError(`unplace chart "${id}"`, error, response);
  }

  /** The datasets and columns this key may write chart SQL against. */
  async schema(): Promise<AnalyticsSchema> {
    const projectId = this.projectId("discover analytics schema");
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/projects/{projectId}/analytics/schema",
      { params: { path: { projectId } } },
    );
    if (error) this.handleApiError("discover analytics schema", error, response);
    return data as unknown as AnalyticsSchema;
  }

  /**
   * Runs a saved chart's statement through the LangWatchQL query door — the
   * same governed execution path the workbench uses. The caller supplies the
   * chart's own SQL and stored parameter values (from `get`), plus the
   * surface's time window and granularity for statements that declare the
   * reserved `period_*` parameters.
   */
  async runQuery(params: {
    sql: string;
    parameters?: Record<string, ChartParameterValue>;
    timeWindow?: { start: string; end: string };
    granularitySeconds?: number;
  }): Promise<ChartRunResult> {
    const projectId = this.projectId("run chart");
    const { data, error, response } = await this.apiClient.POST(
      "/api/v1/projects/{projectId}/analytics/query/clickhouse",
      {
        params: { path: { projectId } },
        body: {
          sql: params.sql,
          ...(params.parameters ? { parameters: params.parameters } : {}),
          ...(params.timeWindow ? { timeWindow: params.timeWindow } : {}),
          ...(params.granularitySeconds === undefined
            ? {}
            : { granularitySeconds: params.granularitySeconds }),
        },
      },
    );
    if (error) this.handleApiError("run chart", error, response);
    return data as unknown as ChartRunResult;
  }
}
