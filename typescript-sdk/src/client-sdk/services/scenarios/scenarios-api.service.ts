import type {
  CreateScenarioBody,
  DeleteScenarioResponse,
  ScenarioResponse,
  UpdateScenarioBody,
} from "./types";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import { ScenariosApiError } from "./errors";

export class ScenariosApiService {
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

    throw new ScenariosApiError(
      `Failed to ${operation}: ${errorMessage}`,
      operation,
      error,
    );
  }

  async getAll(): Promise<ScenarioResponse[]> {
    const { data, error } = await this.apiClient.GET("/api/scenarios");
    if (error) this.handleApiError("fetch all scenarios", error);
    return data;
  }

  async get(id: string): Promise<ScenarioResponse> {
    const { data, error } = await this.apiClient.GET("/api/scenarios/{id}", {
      params: { path: { id } },
    });
    if (error)
      this.handleApiError(`fetch scenario with ID "${id}"`, error);
    return data;
  }

  async create(params: CreateScenarioBody): Promise<ScenarioResponse> {
    const { data, error } = await this.apiClient.POST("/api/scenarios", {
      body: params,
    });
    if (error) this.handleApiError("create scenario", error);
    return data;
  }

  async update(id: string, params: UpdateScenarioBody): Promise<ScenarioResponse> {
    const { data, error } = await this.apiClient.PUT("/api/scenarios/{id}", {
      params: { path: { id } },
      body: params,
    });
    if (error)
      this.handleApiError(`update scenario with ID "${id}"`, error);
    return data;
  }

  async delete(id: string): Promise<DeleteScenarioResponse> {
    const { data, error } = await this.apiClient.DELETE(
      "/api/scenarios/{id}",
      {
        params: { path: { id } },
      },
    );
    if (error)
      this.handleApiError(`delete scenario with ID "${id}"`, error);
    return data;
  }
}
