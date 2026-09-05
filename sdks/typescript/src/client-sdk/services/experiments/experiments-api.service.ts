import type { paths } from "@/internal/generated/openapi/api-client";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";

export interface ExperimentRunStartResponse {
  runId: string;
  status: "running";
  total: number;
  runUrl?: string;
}

/**
 * Optional body for `POST /api/evaluations/v3/{slug}/run`. `data` and
 * `dataset_id` are mutually exclusive on the server (400 if both are sent).
 */
export interface ExperimentRunStartRequest {
  data?: Array<Record<string, unknown>>;
  dataset_id?: string;
  parameters?: Record<string, string | number | boolean>;
  row_indices?: number[];
}

/**
 * Build the snake_case run-start request body from camelCase options.
 */
export const toRunStartRequest = ({
  data,
  datasetId,
  parameters,
  rowIndices,
}: {
  data?: Array<Record<string, unknown>>;
  datasetId?: string;
  parameters?: Record<string, string | number | boolean>;
  rowIndices?: number[];
}): ExperimentRunStartRequest | undefined => {
  const body: ExperimentRunStartRequest = {};
  if (data !== undefined) body.data = data;
  if (datasetId !== undefined) body.dataset_id = datasetId;
  if (parameters !== undefined) body.parameters = parameters;
  if (rowIndices !== undefined) body.row_indices = rowIndices;
  return Object.keys(body).length > 0 ? body : undefined;
};

export type ExperimentRunStatusResponse =
  paths["/api/v1/experiments/runs/{runId}"]["get"]["responses"]["200"]["content"]["application/json"];

/**
 * Status payload for `GET /api/evaluations/v3/runs/{runId}` (polling).
 */
export interface ExperimentV3RunStatusResponse {
  runId: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  /** Number of cells completed */
  progress: number;
  /** Total number of cells */
  total: number;
  /** Unix timestamp when run started */
  startedAt?: number;
  /** Unix timestamp when run finished (completed/failed/stopped only) */
  finishedAt?: number;
  /** Execution summary (present when completed) */
  summary?: {
    runId?: string;
    totalCells?: number;
    completedCells?: number;
    failedCells?: number;
    /** Total execution time in milliseconds */
    duration?: number;
    /** URL to view the run in LangWatch */
    runUrl?: string;
  };
  /** Error message (present when failed) */
  error?: string;
}

/**
 * Summary entry returned by `GET /api/v1/experiments`. Mirrors
 * `experimentSummarySchema` from the control-plane Hono route. Hand-written
 * because the route is not yet exposed via the generated OpenAPI types.
 */
export interface ExperimentSummary {
  id: string;
  slug: string;
  name: string | null;
  type: string;
  workflowId: string | null;
  createdAt: string;
  updatedAt: string;
  runsCount: number;
  lastRunAt: string | null;
}

export interface ExperimentListPagination {
  page: number;
  pageSize: number;
  totalHits: number;
  hasMore: boolean;
}

export interface ExperimentListResponse {
  experiments: ExperimentSummary[];
  pagination: ExperimentListPagination;
}

/**
 * Per-run entry returned by `GET /api/v1/experiments/runs?experimentSlug=...`.
 * Mirrors `ExperimentRun` from the control plane.
 */
export interface ExperimentRunSummaryEntry {
  experimentId: string;
  runId: string;
  workflowVersion: {
    id: string;
    version: string;
    commitMessage: string;
    author: { name: string | null; image: string | null } | null;
  } | null;
  timestamps: {
    createdAt: number;
    updatedAt: number;
    finishedAt?: number | null;
    stoppedAt?: number | null;
  };
  progress?: number | null;
  total?: number | null;
  summary: {
    datasetCost?: number;
    evaluationsCost?: number;
    datasetAverageCost?: number;
    datasetAverageDuration?: number;
    evaluationsAverageCost?: number;
    evaluationsAverageDuration?: number;
    evaluations: Record<
      string,
      { name: string; averageScore: number | null; averagePassed?: number }
    >;
  };
}

export interface ExperimentRunsListResponse {
  experimentId: string;
  experimentSlug: string;
  runs: ExperimentRunSummaryEntry[];
  pagination: ExperimentListPagination;
}

/**
 * Per-row results for a completed experiment run.
 */
export interface ExperimentRunDatasetEntry {
  index: number;
  targetId?: string | null;
  entry: Record<string, unknown>;
  predicted?: Record<string, unknown>;
  cost?: number | null;
  duration?: number | null;
  error?: string | null;
  traceId?: string | null;
}

export interface ExperimentRunEvaluation {
  evaluator: string;
  name?: string | null;
  targetId?: string | null;
  status: "processed" | "skipped" | "error";
  index: number;
  score?: number | null;
  label?: string | null;
  passed?: boolean | null;
  details?: string | null;
  cost?: number | null;
  duration?: number | null;
  inputs?: Record<string, unknown> | null;
}

export interface ExperimentRunResultsResponse {
  experimentId: string;
  runId: string;
  projectId: string;
  workflowVersionId?: string | null;
  progress?: number | null;
  total?: number | null;
  dataset: ExperimentRunDatasetEntry[];
  evaluations: ExperimentRunEvaluation[];
  timestamps: {
    createdAt: number;
    updatedAt: number;
    finishedAt?: number | null;
    stoppedAt?: number | null;
  };
}

/**
 * The workbench types below are projections of the generated OpenAPI `paths`, never
 * hand-written copies of them.
 */

/**
 * The experiment setup as the API carries it: datasets, targets and evaluators. Read it,
 * change it, send it back whole.
 */
export type ExperimentWorkbenchState =
  paths["/api/v1/experiments/{slug}/workbench-state"]["put"]["requestBody"]["content"]["application/json"]["state"];

export type ExperimentCreateResponse =
  paths["/api/v1/experiments"]["post"]["responses"]["200"]["content"]["application/json"];

/**
 * The read answers one of two documents, chosen by the `fields` query. The
 * full setup is the one carrying `state`, so that field is what splits the
 * union into the two shapes the overloads promise.
 */
type WorkbenchStateReadResponse =
  paths["/api/v1/experiments/{slug}/workbench-state"]["get"]["responses"]["200"]["content"]["application/json"];

export type ExperimentWorkbenchStateResponse = Extract<
  WorkbenchStateReadResponse,
  { state: unknown }
>;

/** What `fields: "version"` answers: the staleness probe without the setup. */
export type ExperimentWorkbenchVersionProbe = Exclude<
  WorkbenchStateReadResponse,
  { state: unknown }
>;

export type ExperimentSaveWorkbenchStateResponse =
  paths["/api/v1/experiments/{slug}/workbench-state"]["put"]["responses"]["200"]["content"]["application/json"];

export type ExperimentRestoreVersionResponse =
  paths["/api/v1/experiments/{slug}/versions/{version}/restore"]["post"]["responses"]["200"]["content"]["application/json"];

export type ExperimentVersionsResponse =
  paths["/api/v1/experiments/{slug}/versions"]["get"]["responses"]["200"]["content"]["application/json"];

export type ExperimentVersionSummary = ExperimentVersionsResponse["versions"][number];

export class ExperimentsApiServiceError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "ExperimentsApiServiceError";
  }
}

export class ExperimentsApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
  }

  private handleApiError(operation: string, error: unknown, response?: Response): never {
    const message = formatApiErrorForOperation({
      operation: operation,
      error: error,
      options: {
        status: response?.status ?? extractStatusFromResponse(error),
      },
    });
    throw new ExperimentsApiServiceError(message, operation, error);
  }

  private async getUndeclaredEndpoint<T>({
    path,
    operation,
  }: {
    path: string;
    operation: string;
  }): Promise<T> {
    type UntypedClient = {
      GET: (
        path: string,
        init?: { parseAs?: "json" },
      ) => Promise<{ data?: unknown; error?: unknown; response: Response }>;
    };

    let result: { data?: unknown; error?: unknown; response: Response };
    try {
      result = await (this.apiClient as unknown as UntypedClient).GET(path, {
        parseAs: "json",
      });
    } catch (error) {
      this.handleApiError(operation, error);
    }

    return unwrapApiResult({
      operation,
      data: result.data,
      error: result.error,
      response: result.response,
      onError: this.handleApiError.bind(this),
    }) as T;
  }

  private async postUndeclaredEndpoint<T>({
    path,
    body,
    operation,
  }: {
    path: string;
    body?: unknown;
    operation: string;
  }): Promise<T> {
    type UntypedClient = {
      POST: (
        path: string,
        init?: { body?: unknown; parseAs?: "json" },
      ) => Promise<{ data?: unknown; error?: unknown; response: Response }>;
    };

    let result: { data?: unknown; error?: unknown; response: Response };
    try {
      result = await (this.apiClient as unknown as UntypedClient).POST(path, {
        ...(body !== undefined ? { body } : {}),
        parseAs: "json",
      });
    } catch (error) {
      this.handleApiError(operation, error);
    }

    return unwrapApiResult({
      operation,
      data: result.data,
      error: result.error,
      response: result.response,
      onError: this.handleApiError.bind(this),
    }) as T;
  }

  /**
   * Start a saved experiment by slug.
   */
  async startRun(
    slug: string,
    options: {
      parameters?: Record<string, string | number | boolean>;
    } = {},
  ): Promise<ExperimentRunStartResponse> {
    const body = toRunStartRequest({ parameters: options.parameters });
    const { data, error, response } = await this.apiClient.POST("/api/v1/experiments/{slug}/run", {
      params: { path: { slug } },
      ...(body !== undefined ? { body } : {}),
    });
    return unwrapApiResult({
      operation: `start experiment run for "${slug}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as ExperimentRunStartResponse;
  }

  /**
   * Create an experiment.
   */
  async create({
    name,
    state,
  }: {
    name?: string;
    state?: ExperimentWorkbenchState;
  } = {}): Promise<ExperimentCreateResponse> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/experiments", {
      body: {
        ...(name !== undefined ? { name } : {}),
        ...(state !== undefined ? { state } : {}),
      },
    });
    return unwrapApiResult({
      operation: "create experiment",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * Read an experiment's setup, with the version to send back when saving.
   */
  async getWorkbenchState(options: {
    slug: string;
    fields: "version";
  }): Promise<ExperimentWorkbenchVersionProbe>;
  async getWorkbenchState(options: {
    slug: string;
    fields?: undefined;
  }): Promise<ExperimentWorkbenchStateResponse>;
  async getWorkbenchState({
    slug,
    fields,
  }: {
    slug: string;
    fields?: "version";
  }): Promise<ExperimentWorkbenchStateResponse | ExperimentWorkbenchVersionProbe> {
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/experiments/{slug}/workbench-state",
      {
        params: {
          path: { slug },
          ...(fields !== undefined ? { query: { fields } } : {}),
        },
      },
    );
    return unwrapApiResult({
      operation: `get workbench state for "${slug}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * Save an experiment's setup.
   */
  async setWorkbenchState({
    slug,
    state,
    expectedVersion,
    commitMessage,
  }: {
    slug: string;
    state: ExperimentWorkbenchState;
    expectedVersion?: number;
    commitMessage?: string;
  }): Promise<ExperimentSaveWorkbenchStateResponse> {
    const { data, error, response } = await this.apiClient.PUT(
      "/api/v1/experiments/{slug}/workbench-state",
      {
        params: { path: { slug } },
        body: {
          state,
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
          ...(commitMessage !== undefined ? { commitMessage } : {}),
        },
      },
    );
    return unwrapApiResult({
      operation: `save workbench state for "${slug}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /** The experiment's saved versions, newest first. */
  async listVersions({
    slug,
    limit,
    cursor,
  }: {
    slug: string;
    limit?: number;
    cursor?: number;
  }): Promise<ExperimentVersionsResponse> {
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/experiments/{slug}/versions",
      {
        params: {
          path: { slug },
          query: {
            ...(limit !== undefined ? { limit } : {}),
            ...(cursor !== undefined ? { cursor } : {}),
          },
        },
      },
    );
    return unwrapApiResult({
      operation: `list versions for experiment "${slug}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * Bring an old version back by writing it forward as a new save. History is
   * never rewritten: the version restored from stays in the list.
   */
  async restoreVersion({
    slug,
    version,
  }: {
    slug: string;
    version: number;
  }): Promise<ExperimentRestoreVersionResponse> {
    const { data, error, response } = await this.apiClient.POST(
      "/api/v1/experiments/{slug}/versions/{version}/restore",
      { params: { path: { slug, version } } },
    );
    return unwrapApiResult({
      operation: `restore version ${version} of experiment "${slug}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async getRunStatus(runId: string): Promise<ExperimentRunStatusResponse> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/experiments/runs/{runId}", {
      params: { path: { runId } },
    });
    return unwrapApiResult({
      operation: `get run status for "${runId}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * List experiments for the current project.
   */
  async listExperiments({
    pageSize,
    page,
  }: {
    pageSize?: number;
    page?: number;
  } = {}): Promise<ExperimentListResponse> {
    const search = new URLSearchParams();
    if (pageSize !== undefined) search.set("pageSize", String(pageSize));
    if (page !== undefined) search.set("page", String(page));
    const qs = search.toString();
    return this.getUndeclaredEndpoint<ExperimentListResponse>({
      path: `/api/v1/experiments${qs ? `?${qs}` : ""}`,
      operation: "list experiments",
    });
  }

  /**
   * List experiment runs for an experiment slug.
   */
  async listRuns({
    experimentSlug,
    pageSize,
    page,
  }: {
    experimentSlug: string;
    pageSize?: number;
    page?: number;
  }): Promise<ExperimentRunsListResponse> {
    const search = new URLSearchParams();
    search.set("experimentSlug", experimentSlug);
    if (pageSize !== undefined) search.set("pageSize", String(pageSize));
    if (page !== undefined) search.set("page", String(page));
    return this.getUndeclaredEndpoint<ExperimentRunsListResponse>({
      path: `/api/v1/experiments/runs?${search.toString()}`,
      operation: `list runs for experiment "${experimentSlug}"`,
    });
  }

  /**
   * Fetch per-row results for a completed experiment run.
   */
  async getRunResults({
    runId,
    experimentSlug,
  }: {
    runId: string;
    experimentSlug?: string;
  }): Promise<ExperimentRunResultsResponse> {
    const search = new URLSearchParams();
    if (experimentSlug) search.set("experimentSlug", experimentSlug);
    const qs = search.toString() ? `?${search.toString()}` : "";
    const body = await this.getUndeclaredEndpoint<ExperimentRunResultsResponse | null>({
      path: `/api/v1/experiments/runs/${encodeURIComponent(runId)}/results${qs}`,
      operation: `get run results for "${runId}"`,
    });
    if (body === null) {
      this.handleApiError(`get run results for "${runId}"`, {
        response: { status: 404 },
        data: { error: `Run not found: ${runId}` },
      });
    }
    return body;
  }

  /**
   * Start a saved Evaluations V3 experiment by slug through the unified evaluations-v3
   * backend.
   */
  async startV3Run({
    slug,
    body,
  }: {
    slug: string;
    body?: ExperimentRunStartRequest;
  }): Promise<ExperimentRunStartResponse> {
    return this.postUndeclaredEndpoint<ExperimentRunStartResponse>({
      path: `/api/evaluations/v3/${encodeURIComponent(slug)}/run`,
      body,
      operation: `start evaluation run for "${slug}"`,
    });
  }

  /**
   * Poll the status of an Evaluations V3 run.
   *
   * Hits `GET /api/evaluations/v3/runs/{runId}`.
   */
  async getV3RunStatus(runId: string): Promise<ExperimentV3RunStatusResponse> {
    return this.getUndeclaredEndpoint<ExperimentV3RunStatusResponse>({
      path: `/api/evaluations/v3/runs/${encodeURIComponent(runId)}`,
      operation: `get run status for "${runId}"`,
    });
  }

  /**
   * Fetch per-row results for an Evaluations V3 run.
   */
  async getV3RunResults({
    runId,
    experimentSlug,
  }: {
    runId: string;
    experimentSlug?: string;
  }): Promise<ExperimentRunResultsResponse> {
    const search = new URLSearchParams();
    if (experimentSlug) search.set("experimentSlug", experimentSlug);
    const qs = search.toString() ? `?${search.toString()}` : "";
    const body = await this.getUndeclaredEndpoint<ExperimentRunResultsResponse | null>({
      path: `/api/evaluations/v3/runs/${encodeURIComponent(runId)}/results${qs}`,
      operation: `get run results for "${runId}"`,
    });
    if (body === null) {
      this.handleApiError(`get run results for "${runId}"`, {
        response: { status: 404 },
        data: { error: `Run not found: ${runId}` },
      });
    }
    return body;
  }
}
