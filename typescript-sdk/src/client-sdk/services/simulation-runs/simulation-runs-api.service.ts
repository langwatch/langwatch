import type { paths } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import type { InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";

export type SimulationRunsListResponse =
  paths["/api/simulation-runs"]["get"]["responses"]["200"]["content"]["application/json"];

export type SimulationRunResponse =
  paths["/api/simulation-runs/{scenarioRunId}"]["get"]["responses"]["200"]["content"]["application/json"];

export type SimulationRunsBatchesListResponse =
  paths["/api/simulation-runs/batches/list"]["get"]["responses"]["200"]["content"]["application/json"];

export type SimulationRunsListParams = NonNullable<
  paths["/api/simulation-runs"]["get"]["parameters"]["query"]
>;

export type SimulationRunsBatchesListParams =
  paths["/api/simulation-runs/batches/list"]["get"]["parameters"]["query"];

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

  private handleApiError(operation: string, error: unknown): never {
    const message = formatApiErrorForOperation(operation, error, {
      status: extractStatusFromResponse(error),
    });
    throw new SimulationRunsApiError(message, operation, error);
  }

  async getAll(params?: SimulationRunsListParams): Promise<SimulationRunsListResponse> {
    const { data, error } = await this.apiClient.GET("/api/simulation-runs", {
      params: { query: params },
    });
    if (error) this.handleApiError("list simulation runs", error);
    return data;
  }

  async get(scenarioRunId: string): Promise<SimulationRunResponse> {
    const { data, error } = await this.apiClient.GET(
      "/api/simulation-runs/{scenarioRunId}",
      {
        params: { path: { scenarioRunId } },
      },
    );
    if (error)
      this.handleApiError(`get simulation run "${scenarioRunId}"`, error);
    return data;
  }

  async listBatches(
    params: SimulationRunsBatchesListParams,
  ): Promise<SimulationRunsBatchesListResponse> {
    const { data, error } = await this.apiClient.GET(
      "/api/simulation-runs/batches/list",
      {
        params: { query: params },
      },
    );
    if (error) this.handleApiError("list simulation run batches", error);
    return data;
  }
}
