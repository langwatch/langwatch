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
import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";
import {
  pollExperimentRun,
  rebaseUrlToEndpoint,
  fetchResultsWithRetry,
} from "@/client-sdk/services/experiments/run-status";
import { mapRunResultsToRows } from "@/client-sdk/services/experiments/mapResults";
import type {
  RunWithResultsOptions,
  ExperimentRunWithResults,
} from "@/client-sdk/services/experiments/platformTypes";

export type WorkflowResponse = NonNullable<
  paths["/api/workflows"]["get"]["responses"]["200"]["content"]["application/json"]
>[number];

export type WorkflowDeleteResponse =
  paths["/api/workflows/{id}"]["delete"]["responses"]["200"]["content"]["application/json"];

/**
 * Body for `POST /api/workflows/{workflowId}/evaluate`. `data` and `dataset_id`
 * are mutually exclusive on the server (400 if both are sent).
 */
interface WorkflowEvaluateRequest {
  version_id?: string;
  data?: Array<Record<string, unknown>>;
  dataset_id?: string;
  parameters?: Record<string, string | number | boolean>;
  row_indices?: number[];
}

/**
 * Response from `POST /api/workflows/{workflowId}/evaluate`. Hand-written
 * because the route is not yet exposed via the generated OpenAPI types.
 */
interface WorkflowEvaluateResponse {
  run_id: string;
  run_url: string;
  workflow_version_id: string;
  version: string;
}

export class WorkflowsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "WorkflowsApiError";
  }
}

export class WorkflowsApiService {
  private readonly apiClient: LangwatchApiClient;
  private readonly experimentsApiService: ExperimentsApiService;
  private readonly endpoint: string;

  constructor(
    config?: Pick<InternalConfig, "langwatchApiClient"> & { endpoint?: string },
  ) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
    this.endpoint =
      config?.endpoint ??
      process.env.LANGWATCH_ENDPOINT ??
      "https://app.langwatch.ai";
    this.experimentsApiService = new ExperimentsApiService({
      langwatchApiClient: this.apiClient,
    });
  }

  private handleApiError(operation: string, error: unknown): never {
    const message = formatApiErrorForOperation({ operation: operation, error: error, options: {
      status: extractStatusFromResponse(error),
    } });
    throw new WorkflowsApiError(message, operation, error);
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

  async getAll(): Promise<WorkflowResponse[]> {
    const { data, error } = await this.apiClient.GET("/api/workflows");
    if (error) this.handleApiError("list workflows", error);
    return data;
  }

  async get(id: string): Promise<WorkflowResponse> {
    const { data, error } = await this.apiClient.GET("/api/workflows/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`get workflow "${id}"`, error);
    return data;
  }

  async delete(id: string): Promise<WorkflowDeleteResponse> {
    const { data, error } = await this.apiClient.DELETE("/api/workflows/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`delete workflow "${id}"`, error);
    return data;
  }

  /**
   * Run a studio workflow evaluation and return per-row structured results.
   *
   * Starts the evaluation through the unified evaluations-v3 backend
   * (`POST /api/workflows/{workflowId}/evaluate`), polls to completion, fetches
   * the per-row results, and maps them to the same row structure as the python
   * SDK's results DataFrame.
   *
   * @param workflowId - The studio workflow id
   * @param options - Optional inputs, committed version override, and polling
   *                   configuration. `data` and `datasetId` are mutually
   *                   exclusive.
   * @returns The run id, results URL, status, summary, and per-row results
   *
   * @example
   * ```typescript
   * const langwatch = new LangWatch();
   * const { rows, runUrl } = await langwatch.workflows.run("workflow_123", {
   *   data: [{ question: "What is 2 + 2?" }],
   * });
   * ```
   */
  async run(
    workflowId: string,
    options: RunWithResultsOptions & { versionId?: string } = {},
  ): Promise<ExperimentRunWithResults> {
    const body: WorkflowEvaluateRequest = {};
    if (options.versionId !== undefined) body.version_id = options.versionId;
    if (options.data !== undefined) body.data = options.data;
    if (options.datasetId !== undefined) body.dataset_id = options.datasetId;
    if (options.parameters !== undefined) body.parameters = options.parameters;
    if (options.rowIndices !== undefined) body.row_indices = options.rowIndices;

    const startResponse = await this.postUndeclaredEndpoint<WorkflowEvaluateResponse>(
      {
        path: `/api/workflows/${encodeURIComponent(workflowId)}/evaluate`,
        body,
        operation: `run workflow evaluation for "${workflowId}"`,
      },
    );

    const runId = startResponse.run_id;

    const { status, summary } = await pollExperimentRun({
      runId,
      getStatus: (id) => this.experimentsApiService.getV3RunStatus(id),
      pollInterval: options.pollInterval,
      timeout: options.timeout,
      onProgress: options.onProgress,
    });

    // ClickHouse can lag right after completion: retry the results read through
    // the brief 404 / empty-dataset window when the run reported rows. Mirrors
    // the experiment path and the python SDK.
    const results = await fetchResultsWithRetry({
      getResults: () => this.experimentsApiService.getV3RunResults({ runId }),
      isEmpty: (r) => (r.dataset?.length ?? 0) === 0,
      expectsRows: (summary.totalCells ?? 0) > 0,
      delay: options.pollInterval,
    });

    // Rebase the run URL onto the configured endpoint so a self-hosted run does
    // not surface a cloud (app.langwatch.ai) link.
    const rawRunUrl = startResponse.run_url ?? summary.runUrl;
    const runUrl = rawRunUrl ? rebaseUrlToEndpoint(rawRunUrl, this.endpoint) : "";

    return {
      runId,
      runUrl,
      status,
      summary,
      rows: mapRunResultsToRows(results),
    };
  }
}
