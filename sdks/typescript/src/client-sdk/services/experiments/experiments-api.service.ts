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
 *
 * Returns `undefined` when no overrides are provided so the caller can send a
 * body-less request (the server then uses the configured inputs).
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
  paths["/api/experiments/runs/{runId}"]["get"]["responses"]["200"]["content"]["application/json"];

/**
 * Status payload for `GET /api/evaluations/v3/runs/{runId}` (polling).
 *
 * Hand-written because the v3 path is served via a legacy-alias that rewrites
 * to `/api/experiments/...`, so only the legacy path is declared in the
 * generated OpenAPI types. Kept structurally aligned with that legacy schema.
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
 * Summary entry returned by `GET /api/experiments`. Mirrors
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
 * Per-run entry returned by `GET /api/experiments/runs?experimentSlug=...`.
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
 *
 * Mirrors `ExperimentRunWithItems` from the control plane
 * (`platform/app/src/server/experiments-v3/services/types.ts`). Hand-written
 * because the `/runs/{runId}/results` route is not yet exposed via the
 * generated OpenAPI types.
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
 * The workbench types below are projections of the generated OpenAPI `paths`,
 * never hand-written copies of them. The control plane owns these shapes, so a
 * restated interface can only drift out of date, and a cast onto it would hide
 * the drift instead of failing the build.
 */

/**
 * The experiment setup as the API carries it: datasets, targets and
 * evaluators. Read it, change it, send it back whole. The canonical shape is
 * the control plane's `persistedEvaluationsV3StateSchema`, which validates
 * every write, so this stays open rather than restating it here.
 */
export type ExperimentWorkbenchState =
  paths["/api/experiments/{slug}/workbench-state"]["put"]["requestBody"]["content"]["application/json"]["state"];

export type ExperimentCreateResponse =
  paths["/api/experiments"]["post"]["responses"]["200"]["content"]["application/json"];

/**
 * The read answers one of two documents, chosen by the `fields` query. The
 * full setup is the one carrying `state`, so that field is what splits the
 * union into the two shapes the overloads promise.
 */
type WorkbenchStateReadResponse =
  paths["/api/experiments/{slug}/workbench-state"]["get"]["responses"]["200"]["content"]["application/json"];

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
  paths["/api/experiments/{slug}/workbench-state"]["put"]["responses"]["200"]["content"]["application/json"];

export type ExperimentRestoreVersionResponse =
  paths["/api/experiments/{slug}/versions/{version}/restore"]["post"]["responses"]["200"]["content"]["application/json"];

export type ExperimentVersionsResponse =
  paths["/api/experiments/{slug}/versions"]["get"]["responses"]["200"]["content"]["application/json"];

export type ExperimentVersionSummary =
  ExperimentVersionsResponse["versions"][number];

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

  private handleApiError(operation: string, error: unknown): never {
    const message = formatApiErrorForOperation({ operation: operation, error: error, options: {
      status: extractStatusFromResponse(error),
    } });
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

    if (result.error) this.handleApiError(operation, result.error);
    return result.data as T;
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

    if (result.error) this.handleApiError(operation, result.error);
    return result.data as T;
  }

  /**
   * Start a saved experiment by slug.
   *
   * The body stays off the wire entirely when no overrides are given, so the
   * run uses the inputs the experiment is configured with.
   */
  async startRun(
    slug: string,
    options: {
      parameters?: Record<string, string | number | boolean>;
    } = {},
  ): Promise<ExperimentRunStartResponse> {
    const body = toRunStartRequest({ parameters: options.parameters });
    const { data, error } = await this.apiClient.POST(
      "/api/experiments/{slug}/run",
      {
        params: { path: { slug } },
        ...(body !== undefined ? { body } : {}),
      },
    );
    if (error) this.handleApiError(`start experiment run for "${slug}"`, error);
    return data as unknown as ExperimentRunStartResponse;
  }

  /**
   * Create an experiment.
   *
   * Sending no state creates a blank workbench with one inline dataset, so a
   * caller that only wants somewhere to put its setup does not have to build
   * one first.
   */
  async create({
    name,
    state,
  }: {
    name?: string;
    state?: ExperimentWorkbenchState;
  } = {}): Promise<ExperimentCreateResponse> {
    const { data, error } = await this.apiClient.POST("/api/experiments", {
      body: {
        ...(name !== undefined ? { name } : {}),
        ...(state !== undefined ? { state } : {}),
      },
    });
    if (error) this.handleApiError("create experiment", error);
    return data;
  }

  /**
   * Read an experiment's setup, with the version to send back when saving.
   *
   * `fields: "version"` answers with the version and timestamp only, which is
   * what a poller checking for changes wants: it costs the same round trip and
   * none of the payload.
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
    const { data, error } = await this.apiClient.GET(
      "/api/experiments/{slug}/workbench-state",
      {
        params: {
          path: { slug },
          ...(fields !== undefined ? { query: { fields } } : {}),
        },
      },
    );
    if (error) {
      this.handleApiError(`get workbench state for "${slug}"`, error);
    }
    return data;
  }

  /**
   * Save an experiment's setup.
   *
   * Send `expectedVersion` with the version you read and the platform refuses
   * the save with a 409 when someone else wrote first, instead of overwriting
   * their work.
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
    const { data, error } = await this.apiClient.PUT(
      "/api/experiments/{slug}/workbench-state",
      {
        params: { path: { slug } },
        body: {
          state,
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
          ...(commitMessage !== undefined ? { commitMessage } : {}),
        },
      },
    );
    if (error) {
      this.handleApiError(`save workbench state for "${slug}"`, error);
    }
    return data;
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
    const { data, error } = await this.apiClient.GET(
      "/api/experiments/{slug}/versions",
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
    if (error) {
      this.handleApiError(`list versions for experiment "${slug}"`, error);
    }
    return data;
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
    const { data, error } = await this.apiClient.POST(
      "/api/experiments/{slug}/versions/{version}/restore",
      { params: { path: { slug, version } } },
    );
    if (error) {
      this.handleApiError(
        `restore version ${version} of experiment "${slug}"`,
        error,
      );
    }
    return data;
  }

  async getRunStatus(runId: string): Promise<ExperimentRunStatusResponse> {
    const { data, error } = await this.apiClient.GET(
      "/api/experiments/runs/{runId}",
      {
        params: { path: { runId } },
      },
    );
    if (error) this.handleApiError(`get run status for "${runId}"`, error);
    return data;
  }

  /**
   * List experiments for the current project.
   *
   * Hits `GET /api/experiments` through the configured API client transport.
   * The route is not yet declared in generated OpenAPI types, so the path is
   * dispatched through a narrow untyped helper.
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
      path: `/api/experiments${qs ? `?${qs}` : ""}`,
      operation: "list experiments",
    });
  }

  /**
   * List experiment runs for an experiment slug.
   *
   * Hits `GET /api/experiments/runs?experimentSlug=...` through the
   * configured API client transport because the route is not yet declared in
   * the generated OpenAPI.
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
      path: `/api/experiments/runs?${search.toString()}`,
      operation: `list runs for experiment "${experimentSlug}"`,
    });
  }

  /**
   * Fetch per-row results for a completed experiment run.
   *
   * Hits `GET /api/experiments/runs/{runId}/results` through the
   * configured API client transport because the route is not yet declared in
   * the generated OpenAPI `paths`.
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
    const body = await this.getUndeclaredEndpoint<
      ExperimentRunResultsResponse | null
    >({
      path: `/api/experiments/runs/${encodeURIComponent(runId)}/results${qs}`,
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
   * Start a saved Evaluations V3 experiment by slug through the unified
   * evaluations-v3 backend.
   *
   * Hits `POST /api/evaluations/v3/{slug}/run`. The optional body overrides
   * the configured inputs (`data` / `dataset_id` are mutually exclusive on the
   * server). The route accepts a body, but the generated OpenAPI types declare
   * it body-less, so the call is dispatched through a narrow untyped helper.
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
   *
   * Hits `GET /api/evaluations/v3/runs/{runId}/results`. `experimentSlug` is
   * optional for runs created in the last 24h and required afterwards.
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
    const body = await this.getUndeclaredEndpoint<
      ExperimentRunResultsResponse | null
    >({
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
