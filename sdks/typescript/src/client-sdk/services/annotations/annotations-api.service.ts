import type { paths, components } from "@/internal/generated/openapi/api-client";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";

export type AnnotationResponse = components["schemas"]["Annotation"];

export type CreateAnnotationBody = NonNullable<
  paths["/api/v1/annotations/trace/{id}"]["post"]["requestBody"]
>["content"]["application/json"];

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

  async delete(id: string): Promise<{ status?: string; message?: string }> {
    const { data, error, response } = await this.apiClient.DELETE("/api/v1/annotations/{id}", {
      params: { path: { id } },
    });
    return unwrapApiResult({
      operation: `delete annotation with ID "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }
}
