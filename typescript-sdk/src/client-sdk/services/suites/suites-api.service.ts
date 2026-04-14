import type { paths } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import type { InternalConfig } from "@/client-sdk/types";

export type SuiteResponse = NonNullable<
  paths["/api/suites"]["get"]["responses"]["200"]["content"]["application/json"]
>[number];

export type CreateSuiteBody = NonNullable<
  paths["/api/suites"]["post"]["requestBody"]
>["content"]["application/json"];

export type UpdateSuiteBody = NonNullable<
  paths["/api/suites/{id}"]["patch"]["requestBody"]
>["content"]["application/json"];

export type SuiteRunResult =
  paths["/api/suites/{id}/run"]["post"]["responses"]["200"]["content"]["application/json"];

export interface SuiteTarget {
  type: "prompt" | "http" | "code" | "workflow";
  referenceId: string;
}

export class SuitesApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "SuitesApiError";
  }
}

export class SuitesApiService {
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

    throw new SuitesApiError(
      `Failed to ${operation}: ${errorMessage}`,
      operation,
      error,
    );
  }

  async getAll(): Promise<SuiteResponse[]> {
    const { data, error } = await this.apiClient.GET("/api/suites");
    if (error) this.handleApiError("list suites", error);
    return data;
  }

  async get(id: string): Promise<SuiteResponse> {
    const { data, error } = await this.apiClient.GET("/api/suites/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`get suite "${id}"`, error);
    return data;
  }

  async create(params: CreateSuiteBody): Promise<SuiteResponse> {
    const { data, error } = await this.apiClient.POST("/api/suites", {
      body: params,
    });
    if (error) this.handleApiError("create suite", error);
    return data;
  }

  async update(id: string, params: UpdateSuiteBody): Promise<SuiteResponse> {
    const { data, error } = await this.apiClient.PATCH("/api/suites/{id}", {
      params: { path: { id } },
      body: params,
    });
    if (error) this.handleApiError(`update suite "${id}"`, error);
    return data;
  }

  async duplicate(id: string): Promise<SuiteResponse> {
    const { data, error } = await this.apiClient.POST("/api/suites/{id}/duplicate", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`duplicate suite "${id}"`, error);
    return data;
  }

  async run(id: string, idempotencyKey?: string): Promise<SuiteRunResult> {
    const { data, error } = await this.apiClient.POST("/api/suites/{id}/run", {
      params: { path: { id } },
      body: {
        idempotencyKey: idempotencyKey ?? `cli-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    if (error) this.handleApiError(`run suite "${id}"`, error);
    return data;
  }

  async delete(id: string): Promise<{ id: string; archived: boolean }> {
    const { data, error } = await this.apiClient.DELETE("/api/suites/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`delete suite "${id}"`, error);
    return data as unknown as { id: string; archived: boolean };
  }
}
