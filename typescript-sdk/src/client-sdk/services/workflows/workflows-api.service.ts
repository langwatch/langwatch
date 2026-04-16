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

export type WorkflowResponse = NonNullable<
  paths["/api/workflows"]["get"]["responses"]["200"]["content"]["application/json"]
>[number];

export type WorkflowDeleteResponse =
  paths["/api/workflows/{id}"]["delete"]["responses"]["200"]["content"]["application/json"];

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

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
  }

  private handleApiError(operation: string, error: unknown): never {
    const message = formatApiErrorForOperation(operation, error, {
      status: extractStatusFromResponse(error),
    });
    throw new WorkflowsApiError(message, operation, error);
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
}
