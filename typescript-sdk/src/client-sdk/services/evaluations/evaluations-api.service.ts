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

export interface EvaluationRunStartResponse {
  runId: string;
  status: "running";
  total: number;
  runUrl?: string;
}

export type EvaluationRunStatusResponse =
  paths["/api/evaluations/v3/runs/{runId}"]["get"]["responses"]["200"]["content"]["application/json"];

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
}
