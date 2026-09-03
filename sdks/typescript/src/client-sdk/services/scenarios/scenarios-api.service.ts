import type {
  CreateScenarioBody,
  DeleteScenarioResponse,
  ScenarioResponse,
  ScenarioVersionDetail,
  ScenarioVersionListResponse,
  UpdateScenarioBody,
} from "./types";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import { ScenariosApiError } from "./errors";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";

export class ScenariosApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
  }

  private handleApiError(operation: string, error: unknown): never {
    const message = formatApiErrorForOperation({
      operation: operation,
      error: error,
      options: {
        status: extractStatusFromResponse(error),
      },
    });
    throw new ScenariosApiError(message, operation, error);
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
    if (error) this.handleApiError(`fetch scenario with ID "${id}"`, error);
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
    if (error) this.handleApiError(`update scenario with ID "${id}"`, error);
    return data;
  }

  /** The saved versions of a scenario, newest first. */
  async listVersions(
    id: string,
    options?: { limit?: number; cursor?: number },
  ): Promise<ScenarioVersionListResponse> {
    const query = {
      ...(options?.limit !== undefined && { limit: options.limit }),
      ...(options?.cursor !== undefined && { cursor: options.cursor }),
    };
    const { data, error } = await this.apiClient.GET(
      "/api/scenarios/{id}/versions",
      {
        params: { path: { id }, query },
      },
    );
    if (error)
      this.handleApiError(`list versions of scenario "${id}"`, error);
    return data;
  }

  /** One saved version of a scenario, with the content it saved. */
  async getVersion(
    id: string,
    version: number,
  ): Promise<ScenarioVersionDetail> {
    const { data, error } = await this.apiClient.GET(
      "/api/scenarios/{id}/versions/{version}",
      {
        params: { path: { id, version } },
      },
    );
    if (error)
      this.handleApiError(
        `get version ${version} of scenario "${id}"`,
        error,
      );
    return data;
  }

  async delete(id: string): Promise<DeleteScenarioResponse> {
    const { data, error } = await this.apiClient.DELETE("/api/scenarios/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`delete scenario with ID "${id}"`, error);
    return data;
  }
}
