import type {
  CreateEvaluatorBody,
  DeleteEvaluatorResponse,
  EvaluatorResponse,
  UpdateEvaluatorBody,
} from "./types";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import { EvaluatorsApiError } from "./errors";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";

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

  private handleApiError(operation: string, error: unknown): never {
    const message = formatApiErrorForOperation(operation, error, {
      status: extractStatusFromResponse(error),
    });
    throw new EvaluatorsApiError(message, operation, error);
  }

  /**
   * Fetches all evaluators for the project.
   */
  async getAll(): Promise<EvaluatorResponse[]> {
    const { data, error } = await this.apiClient.GET("/api/evaluators");
    if (error) this.handleApiError("fetch all evaluators", error);
    return data;
  }

  /**
   * Fetches a single evaluator by its ID or slug.
   */
  async get(idOrSlug: string): Promise<EvaluatorResponse> {
    const { data, error } = await this.apiClient.GET(
      "/api/evaluators/{idOrSlug}",
      {
        params: { path: { idOrSlug } },
      },
    );
    if (error)
      this.handleApiError(
        `fetch evaluator with ID or slug "${idOrSlug}"`,
        error,
      );
    return data;
  }

  /**
   * Creates a new evaluator.
   */
  async create(params: CreateEvaluatorBody): Promise<EvaluatorResponse> {
    const { data, error } = await this.apiClient.POST("/api/evaluators", {
      body: params,
    });
    if (error) this.handleApiError("create evaluator", error);
    return data;
  }

  /**
   * Updates an evaluator by its ID.
   */
  async update(id: string, params: UpdateEvaluatorBody): Promise<EvaluatorResponse> {
    const { data, error } = await this.apiClient.PUT(
      "/api/evaluators/{id}",
      {
        params: { path: { id } },
        body: params,
      },
    );
    if (error)
      this.handleApiError(`update evaluator with ID "${id}"`, error);
    return data;
  }

  /**
   * Deletes (archives) an evaluator by its ID.
   */
  async delete(id: string): Promise<DeleteEvaluatorResponse> {
    const { data, error } = await this.apiClient.DELETE(
      "/api/evaluators/{id}",
      {
        params: { path: { id } },
      },
    );
    if (error)
      this.handleApiError(`delete evaluator with ID "${id}"`, error);
    return data;
  }
}
