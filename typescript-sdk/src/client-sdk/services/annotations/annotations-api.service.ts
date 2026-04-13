import type { paths, components } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";

export type AnnotationResponse = components["schemas"]["Annotation"];

export type CreateAnnotationBody = NonNullable<
  paths["/api/annotations/trace/{id}"]["post"]["requestBody"]
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

    throw new AnnotationsApiError(
      `Failed to ${operation}: ${errorMessage}`,
      operation,
      error,
    );
  }

  async getAll(): Promise<AnnotationResponse[]> {
    const { data, error } = await this.apiClient.GET("/api/annotations");
    if (error) this.handleApiError("fetch all annotations", error);
    return data;
  }

  async get(id: string): Promise<AnnotationResponse> {
    const { data, error } = await this.apiClient.GET("/api/annotations/{id}", {
      params: { path: { id } },
    });
    if (error)
      this.handleApiError(`fetch annotation with ID "${id}"`, error);
    return data;
  }

  async getByTrace(traceId: string): Promise<AnnotationResponse[]> {
    const { data, error } = await this.apiClient.GET(
      "/api/annotations/trace/{id}",
      {
        params: { path: { id: traceId } },
      },
    );
    if (error)
      this.handleApiError(`fetch annotations for trace "${traceId}"`, error);
    return data;
  }

  async create(traceId: string, params: CreateAnnotationBody): Promise<AnnotationResponse> {
    const { data, error } = await this.apiClient.POST(
      "/api/annotations/trace/{id}",
      {
        params: { path: { id: traceId } },
        body: params,
      },
    );
    if (error) this.handleApiError("create annotation", error);
    return data;
  }

  async delete(id: string): Promise<{ status?: string; message?: string }> {
    const { data, error } = await this.apiClient.DELETE(
      "/api/annotations/{id}",
      {
        params: { path: { id } },
      },
    );
    if (error)
      this.handleApiError(`delete annotation with ID "${id}"`, error);
    return data;
  }
}
