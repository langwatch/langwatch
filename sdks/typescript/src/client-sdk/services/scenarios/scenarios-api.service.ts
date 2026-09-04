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
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";

export class ScenariosApiService {
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
    throw new ScenariosApiError(message, operation, error);
  }

  async getAll(): Promise<ScenarioResponse[]> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/scenarios");
    return unwrapApiResult({
      operation: "fetch all scenarios",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async get(id: string): Promise<ScenarioResponse> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/scenarios/{id}", {
      params: { path: { id } },
    });
    return unwrapApiResult({
      operation: `fetch scenario with ID "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async create(params: CreateScenarioBody): Promise<ScenarioResponse> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/scenarios", {
      body: params,
    });
    return unwrapApiResult({
      operation: "create scenario",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async update(id: string, params: UpdateScenarioBody): Promise<ScenarioResponse> {
    const { data, error, response } = await this.apiClient.PUT("/api/v1/scenarios/{id}", {
      params: { path: { id } },
      body: params,
    });
    return unwrapApiResult({
      operation: `update scenario with ID "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
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
    const { data, error, response } = await this.apiClient.GET("/api/v1/scenarios/{id}/versions", {
      params: { path: { id }, query },
    });
    return unwrapApiResult({
      operation: `list versions of scenario "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /** One saved version of a scenario, with the content it saved. */
  async getVersion(id: string, version: number): Promise<ScenarioVersionDetail> {
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/scenarios/{id}/versions/{version}",
      {
        params: { path: { id, version } },
      },
    );
    return unwrapApiResult({
      operation: `get version ${version} of scenario "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async delete(id: string): Promise<DeleteScenarioResponse> {
    const { data, error, response } = await this.apiClient.DELETE("/api/v1/scenarios/{id}", {
      params: { path: { id } },
    });
    return unwrapApiResult({
      operation: `delete scenario with ID "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }
}
