import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";
import { type InternalConfig } from "@/client-sdk/types";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import type { components, paths } from "@/internal/generated/openapi/api-client";

export type AnnotationResponse = components["schemas"]["Annotation"];

export type CreateAnnotationBody = NonNullable<
  paths["/api/v1/annotations/trace/{id}"]["post"]["requestBody"]
>["content"]["application/json"];

export type DeleteAnnotationResponse = { status?: string; message?: string };

/**
 * The delete endpoint's `application/json` content is `unknown` in the
 * document (the generator no longer names it as a component schema), so
 * the shape this service promises is verified at runtime, not assumed.
 */
function isDeleteAnnotationResponse(value: unknown): value is DeleteAnnotationResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.status === undefined || typeof record.status === "string") &&
    (record.message === undefined || typeof record.message === "string")
  );
}

export class AnnotationsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "AnnotationsApiError";
  }
}

export class AnnotationsApiService {
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
    throw new AnnotationsApiError(message, operation, error);
  }

  async getAll(): Promise<AnnotationResponse[]> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/annotations");
    return unwrapApiResult({
      operation: "fetch all annotations",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }).data;
  }

  async get(id: string): Promise<AnnotationResponse> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/annotations/{id}", {
      params: { path: { id } },
    });
    return unwrapApiResult({
      operation: `fetch annotation with ID "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }).data;
  }

  async getByTrace(traceId: string): Promise<AnnotationResponse[]> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/annotations/trace/{id}", {
      params: { path: { id: traceId } },
    });
    return unwrapApiResult({
      operation: `fetch annotations for trace "${traceId}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }).data;
  }

  async create(traceId: string, params: CreateAnnotationBody): Promise<AnnotationResponse> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/annotations/trace/{id}", {
      params: { path: { id: traceId } },
      body: params,
    });
    return unwrapApiResult({
      operation: "create annotation",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }).data;
  }

  async delete(id: string): Promise<DeleteAnnotationResponse> {
    const { data, error, response } = await this.apiClient.DELETE("/api/v1/annotations/{id}", {
      params: { path: { id } },
    });
    const operation = `delete annotation with ID "${id}"`;
    const result = unwrapApiResult({
      operation,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
    if (!isDeleteAnnotationResponse(result)) {
      this.handleApiError(
        operation,
        new Error("Delete annotation response has an unexpected shape"),
      );
    }
    return result;
  }
}
