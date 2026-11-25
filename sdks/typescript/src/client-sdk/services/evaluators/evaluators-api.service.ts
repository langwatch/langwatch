import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";
import { type InternalConfig } from "@/client-sdk/types";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";

import { EvaluatorsApiError } from "./errors";
import type {
  CreateEvaluatorBody,
  DeleteEvaluatorResponse,
  EvaluatorLabelResponse,
  EvaluatorResponse,
  EvaluatorVersionSelector,
  EvaluatorVersionsResponse,
  UpdateEvaluatorBody,
} from "./types";

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
    throwIfHandledError({ operation, error, message });
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
   * Fetches a single evaluator by its ID or slug, at the latest version unless a `label` or a
   * `version` is asked for. The slug also takes a suffix: `toxicity:production` or `toxicity:2`.
   */
  async get(idOrSlug: string, selector: EvaluatorVersionSelector = {}): Promise<EvaluatorResponse> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/evaluators/{idOrSlug}", {
      params: { path: { idOrSlug }, query: selector },
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

  /** Every version of the evaluator, newest first, with the labels on each. */
  async listVersions(id: string): Promise<EvaluatorVersionsResponse> {
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/evaluators/{evaluatorId}/versions",
      { params: { path: { evaluatorId: id } } },
    );
    return unwrapApiResult({
      operation: `list versions of evaluator "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /** Points a deploy label, such as `production`, at one of the evaluator's versions. */
  async assignLabel(id: string, label: string, version: number): Promise<EvaluatorLabelResponse> {
    const { data, error, response } = await this.apiClient.PUT(
      "/api/v1/evaluators/{evaluatorId}/labels/{label}",
      { params: { path: { evaluatorId: id, label } }, body: { version } },
    );
    return unwrapApiResult({
      operation: `deploy label "${label}" of evaluator "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  /** Removes a deploy label from the evaluator. */
  async removeLabel(id: string, label: string): Promise<{ label: string; removed: true }> {
    const { data, error, response } = await this.apiClient.DELETE(
      "/api/v1/evaluators/{evaluatorId}/labels/{label}",
      { params: { path: { evaluatorId: id, label } } },
    );
    return unwrapApiResult({
      operation: `remove label "${label}" of evaluator "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as { label: string; removed: true };
  }
}
