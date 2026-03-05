import type { CreateEvaluatorBody, EvaluatorResponse } from "./types";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import { EvaluatorsApiError } from "./errors";

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

    throw new EvaluatorsApiError(
      `Failed to ${operation}: ${errorMessage}`,
      operation,
      error,
    );
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
}
