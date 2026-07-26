import type { paths, components } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";

export type AnnotationResponse = components["schemas"]["Annotation"];

export type CreateAnnotationBody = NonNullable<
  paths["/api/annotations/trace/{id}"]["post"]["requestBody"]
>["content"]["application/json"];

function unwrapEnvelope(payload: unknown): unknown {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

function unwrapList(payload: unknown): AnnotationResponse[] {
  const unwrapped = unwrapEnvelope(payload);
  return Array.isArray(unwrapped) ? (unwrapped as AnnotationResponse[]) : [];
}

function unwrapOne(payload: unknown): AnnotationResponse {
  return (unwrapEnvelope(payload) ?? {}) as AnnotationResponse;
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

  /**
   * The annotation routes answer `{ data: ... }`, but the OpenAPI document
   * declares the bare payload, so the generated types disagree with the server
   * and the mismatch type-checks. Unwrapping here keeps `get`/`create` from
   * returning an object whose every field reads as `undefined` — `list.ts`
   * already carried its own copy of this workaround.
   *
   * Both helpers tolerate an un-enveloped payload, so correcting the OpenAPI
   * document later is not a breaking change for these callers.
   */
  private handleApiError(operation: string, error: unknown): never {
    const message = formatApiErrorForOperation({ operation: operation, error: error, options: {
      status: extractStatusFromResponse(error),
    } });
    throw new AnnotationsApiError(message, operation, error);
  }

  async getAll(): Promise<AnnotationResponse[]> {
    const { data, error } = await this.apiClient.GET("/api/annotations");
    if (error) this.handleApiError("fetch all annotations", error);
    return unwrapList(data);
  }

  async get(id: string): Promise<AnnotationResponse> {
    const { data, error } = await this.apiClient.GET("/api/annotations/{id}", {
      params: { path: { id } },
    });
    if (error)
      this.handleApiError(`fetch annotation with ID "${id}"`, error);
    return unwrapOne(data);
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
    return unwrapList(data);
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
    return unwrapOne(data);
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
