import type {
  CreateEvaluatorBody,
  DeleteEvaluatorResponse,
  EvaluatorResponse,
  UpdateEvaluatorBody,
} from "./types";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import { EvaluatorsApiError } from "./errors";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";

/**
 * Service for retrieving evaluator resources via the LangWatch API.
 *
 * Provides read-only access to project evaluators with computed fields.
 */
export class EvaluatorsApiService {
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
    throw new EvaluatorsApiError(message, operation, error);
  }

  /**
   * Fetches all evaluators for the project.
   */
  async getAll(): Promise<EvaluatorResponse[]> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/evaluators");
    return unwrapApiResult({
      operation: "fetch all evaluators",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * Fetches a single evaluator by its ID or slug.
   */
  async get(idOrSlug: string): Promise<EvaluatorResponse> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/evaluators/{idOrSlug}", {
      params: { path: { idOrSlug } },
    });
    return unwrapApiResult({
      operation: `fetch evaluator with ID or slug "${idOrSlug}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * Creates a new evaluator.
   */
  async create(params: CreateEvaluatorBody): Promise<EvaluatorResponse> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/evaluators", {
      body: params,
    });
    return unwrapApiResult({
      operation: "create evaluator",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * Updates an evaluator by its ID.
   */
  async update(id: string, params: UpdateEvaluatorBody): Promise<EvaluatorResponse> {
    const { data, error, response } = await this.apiClient.PUT("/api/v1/evaluators/{id}", {
      params: { path: { id } },
      body: params,
    });
    return unwrapApiResult({
      operation: `update evaluator with ID "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /**
   * Deletes (archives) an evaluator by its ID.
   */
  async delete(id: string): Promise<DeleteEvaluatorResponse> {
    const { data, error, response } = await this.apiClient.DELETE("/api/v1/evaluators/{id}", {
      params: { path: { id } },
    });
    return unwrapApiResult({
      operation: `delete evaluator with ID "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }
}
