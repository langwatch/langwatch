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

export type ExperimentRunStatusResponse =
  paths["/api/experiments/runs/{runId}"]["get"]["responses"]["200"]["content"]["application/json"];

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
 * (`langwatch/src/server/experiments-v3/services/types.ts`). Hand-written
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

  async startRun(slug: string): Promise<ExperimentRunStartResponse> {
    const { data, error } = await this.apiClient.POST(
      "/api/experiments/{slug}/run",
      {
        params: { path: { slug } },
      },
    );
    if (error) this.handleApiError(`start experiment run for "${slug}"`, error);
    return data as unknown as ExperimentRunStartResponse;
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
}
