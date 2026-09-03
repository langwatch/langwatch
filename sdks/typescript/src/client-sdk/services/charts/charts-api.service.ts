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
 * The LangWatchQL analytics schema, as `GET /api/v1/query/schema` on the query
 * door answers it — the discovery endpoint this used to derive from
 * (`GET /api/v1/projects/{projectId}/analytics/schema`) was removed in favor
 * of that door (issue #7565). Re-exported under this family's own name so
 * existing imports keep working.
 */
export type AnalyticsSchema = QuerySchemaResult;

/**
 * The result of running a chart's statement through the LangWatchQL query
 * door. Re-exported from `QueryApiService`, which is what this now delegates
 * to — the dedicated REST endpoint this used to derive from
 * (`POST /api/v1/projects/{projectId}/analytics/query/clickhouse`) was
 * removed in favor of the shared query door (issue #7565).
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
 *
 * The chart routes carry the project id in the path, unlike the older
 * project-implicit families, so the service resolves one once — the CLI's
 * request-scoped project first, then `LANGWATCH_PROJECT_ID` — and refuses
 * loudly when none is known rather than guessing.
 */
export class ChartsApiService {
  private readonly apiClient: LangwatchApiClient;
  private readonly configuredProjectId: string | undefined;
  /**
   * `schema()` and `runQuery()` delegate to the shared query door rather
   * than a dedicated chart-family route (issue #7565). That door is
   * project-implicit (no path/body slot — see `QueryApiService`'s own doc
   * comment), so it only learns this family's project from the client it is
   * given: when the caller supplied their own `langwatchApiClient`, this
   * reuses it verbatim (that client's auth is the caller's to own);
   * otherwise a client is built fresh, scoped to the same
   * `configuredProjectId` CRUD resolves through `projectId()`, so a
   * `ChartsApiService` configured for one project cannot leak a chart's
   * query to a different project via ambient scope (issue #7565 follow-up).
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
        createLangWatchApiClient(
          undefined,
          undefined,
          this.resolvedProjectId(),
        ),
    });
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

  /**
   * The same `configuredProjectId ?? scopedProjectId() ?? env` chain
   * `projectId()` throws on, without the throw — for the one caller that
   * must tolerate "no project" rather than refuse on it: the query-door
   * client build in the constructor above, which has to keep working for
   * legacy project-scoped keys that carry no project in any of those three
   * places (see `QueryApiService`'s own doc comment).
   */
  private resolvedProjectId(): string | undefined {
    return (
      this.configuredProjectId ??
      scopedProjectId() ??
      process.env.LANGWATCH_PROJECT_ID
    );
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

  /**
   * The datasets and columns this key may write chart SQL against.
   *
   * Delegates to the shared query door's `GET /api/v1/query/schema` — the
   * dedicated discovery route this used to call
   * (`GET /api/v1/projects/{projectId}/analytics/schema`) was removed in
   * favor of it (issue #7565). That door is project-implicit (the project is
   * resolved into the underlying api client's auth, not a path segment), so
   * this family's own `projectId()` resolution does not apply here.
   */
  async schema(): Promise<AnalyticsSchema> {
    return this.queryApi.schema();
  }

  /**
   * Runs a saved chart's statement through the LangWatchQL query door — the
   * same governed execution path the workbench uses. The caller supplies the
   * chart's own SQL and stored parameter values (from `get`), plus the
   * surface's time window and granularity for statements that declare the
   * reserved `period_*` parameters.
   *
   * Delegates to the shared query door's `POST /api/v1/query` — the
   * dedicated execution route this used to call
   * (`POST /api/v1/projects/{projectId}/analytics/query/clickhouse`) was
   * removed in favor of it (issue #7565).
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
