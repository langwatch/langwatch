import type { paths } from "@/internal/generated/openapi/api-client";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import type { InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";

export type SimulationRunsListResponse =
  paths["/api/v1/simulation-runs"]["get"]["responses"]["200"]["content"]["application/json"];

export type SimulationRunResponse =
  paths["/api/v1/simulation-runs/{scenarioRunId}"]["get"]["responses"]["200"]["content"]["application/json"];

export type SimulationRunsBatchesListResponse =
  paths["/api/v1/simulation-runs/batches/list"]["get"]["responses"]["200"]["content"]["application/json"];

export type SimulationRunsListParams = NonNullable<
  paths["/api/v1/simulation-runs"]["get"]["parameters"]["query"]
>;

export type SimulationRunsBatchesListParams =
  paths["/api/v1/simulation-runs/batches/list"]["get"]["parameters"]["query"];

export class SimulationRunsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "SimulationRunsApiError";
  }
}

export class SimulationRunsApiService {
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
    throw new SimulationRunsApiError(message, operation, error);
  }

  async getAll(params?: SimulationRunsListParams): Promise<SimulationRunsListResponse> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/simulation-runs", {
      params: { query: params },
    });
    return unwrapApiResult({
      operation: "list simulation runs",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async get(scenarioRunId: string): Promise<SimulationRunResponse> {
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/simulation-runs/{scenarioRunId}",
      {
        params: { path: { scenarioRunId } },
      },
    );
    return unwrapApiResult({
      operation: `get simulation run "${scenarioRunId}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async listBatches(
    params: SimulationRunsBatchesListParams,
  ): Promise<SimulationRunsBatchesListResponse> {
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/simulation-runs/batches/list",
      {
        params: { query: params },
      },
    );
    return unwrapApiResult({
      operation: "list simulation run batches",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }
}
