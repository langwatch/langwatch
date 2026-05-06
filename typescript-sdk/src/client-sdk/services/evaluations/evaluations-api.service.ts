import type { paths } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { buildAuthHeaders } from "@/internal/api/auth";
import { DEFAULT_ENDPOINT } from "@/internal/constants";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";

export interface EvaluationRunStartResponse {
  runId: string;
  status: "running";
  total: number;
  runUrl?: string;
}

export type EvaluationRunStatusResponse =
  paths["/api/evaluations/v3/runs/{runId}"]["get"]["responses"]["200"]["content"]["application/json"];

/**
 * Per-row results for a completed evaluation run.
 *
 * Mirrors `ExperimentRunWithItems` from the control plane
 * (`langwatch/src/server/evaluations-v3/services/types.ts`). Hand-written
 * because the `/runs/{runId}/results` route is not yet exposed via the
 * generated OpenAPI types.
 */
export interface EvaluationRunDatasetEntry {
  index: number;
  targetId?: string | null;
  entry: Record<string, unknown>;
  predicted?: Record<string, unknown>;
  cost?: number | null;
  duration?: number | null;
  error?: string | null;
  traceId?: string | null;
}

export interface EvaluationRunEvaluation {
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

export interface EvaluationRunResultsResponse {
  experimentId: string;
  runId: string;
  projectId: string;
  workflowVersionId?: string | null;
  progress?: number | null;
  total?: number | null;
  dataset: EvaluationRunDatasetEntry[];
  evaluations: EvaluationRunEvaluation[];
  timestamps: {
    createdAt: number;
    updatedAt: number;
    finishedAt?: number | null;
    stoppedAt?: number | null;
  };
}

export class EvaluationsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "EvaluationsApiError";
  }
}

export class EvaluationsApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
  }

  private handleApiError(operation: string, error: unknown): never {
    const message = formatApiErrorForOperation({ operation: operation, error: error, options: {
      status: extractStatusFromResponse(error),
    } });
    throw new EvaluationsApiError(message, operation, error);
  }

  async startRun(slug: string): Promise<EvaluationRunStartResponse> {
    const { data, error } = await this.apiClient.POST(
      "/api/evaluations/v3/{slug}/run",
      {
        params: { path: { slug } },
      },
    );
    if (error) this.handleApiError(`start evaluation run for "${slug}"`, error);
    return data as unknown as EvaluationRunStartResponse;
  }

  async getRunStatus(runId: string): Promise<EvaluationRunStatusResponse> {
    const { data, error } = await this.apiClient.GET(
      "/api/evaluations/v3/runs/{runId}",
      {
        params: { path: { runId } },
      },
    );
    if (error) this.handleApiError(`get run status for "${runId}"`, error);
    return data;
  }

  /**
   * Fetch per-row results for a completed evaluation run.
   *
   * Hits `GET /api/evaluations/v3/runs/{runId}/results` directly via fetch
   * (not the typed `apiClient`) because the route is not yet declared in
   * the generated OpenAPI `paths`.
   */
  async getRunResults({
    runId,
  }: {
    runId: string;
  }): Promise<EvaluationRunResultsResponse> {
    const apiKey = process.env.LANGWATCH_API_KEY ?? "";
    const endpoint =
      process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT;
    const projectId = process.env.LANGWATCH_PROJECT_ID;
    const url = `${endpoint}/api/evaluations/v3/runs/${encodeURIComponent(runId)}/results`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          ...buildAuthHeaders({ apiKey, projectId }),
          "content-type": "application/json",
        },
      });
    } catch (error) {
      this.handleApiError(`get run results for "${runId}"`, error);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep raw text
      }
      const fauxError = {
        response: { status: response.status },
        data: parsed,
      };
      this.handleApiError(`get run results for "${runId}"`, fauxError);
    }

    return (await response.json()) as EvaluationRunResultsResponse;
  }
}
