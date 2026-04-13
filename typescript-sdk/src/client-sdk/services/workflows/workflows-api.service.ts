import type { paths } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";

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
    const errorMessage =
      typeof error === "string"
        ? error
        : error != null &&
            typeof error === "object" &&
            "error" in error &&
            error.error != null
          ? typeof error.error === "string"
            ? error.error
            : (error.error as { message?: string }).message ??
              JSON.stringify(error.error)
          : error instanceof Error
            ? error.message
            : "Unknown error occurred";

    throw new WorkflowsApiError(
      `Failed to ${operation}: ${errorMessage}`,
      operation,
      error,
    );
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
