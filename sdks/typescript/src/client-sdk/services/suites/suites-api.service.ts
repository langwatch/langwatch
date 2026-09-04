import type { paths } from "@/internal/generated/openapi/api-client";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import type { InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";

export type SuiteResponse = NonNullable<
  paths["/api/v1/suites"]["get"]["responses"]["200"]["content"]["application/json"]
>[number] & {
  /** URL to view this suite on the LangWatch platform */
  platformUrl?: string;
};

export type CreateSuiteBody = NonNullable<
  paths["/api/v1/suites"]["post"]["requestBody"]
>["content"]["application/json"];

export type UpdateSuiteBody = NonNullable<
  paths["/api/v1/suites/{id}"]["patch"]["requestBody"]
>["content"]["application/json"];

export type SuiteRunResult =
  paths["/api/v1/suites/{id}/run"]["post"]["responses"]["200"]["content"]["application/json"];

export interface SuiteTarget {
  type: "prompt" | "http" | "code" | "workflow";
  referenceId: string;
}

/** Options for `POST /api/v1/suites/{id}/run`. */
export interface SuiteRunOptions {
  /**
   * Key that makes the request safe to retry. Generated per call when omitted,
   * so two retries of the same command schedule two runs unless the caller
   * pins one.
   */
  idempotencyKey?: string;
  /**
   * Constant values applied to every scenario in the run, e.g. a fixture id or
   * a tenant. A value supplied here overrides the scenario's own default for
   * that name.
   */
  parameters?: Record<string, string | number | boolean>;
  /**
   * One short line saying why this batch was run, e.g. a commit hash or what
   * changed. Every run of the batch carries it. Spaces around it are removed,
   * and a note of only spaces is sent as no note at all.
   */
  note?: string;
}

/** Which kind of suite `getAll` returns. Defaults to run plans. */
export type SuiteKind = "custom" | "folder";

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

/**
 * @deprecated Use runPlans and testSuites; /api/v1/suites is a frozen alias.
 */
export class SuitesApiService {
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
    throw new SuitesApiError(message, operation, error);
  }

  async getAll(options?: { kind?: SuiteKind }): Promise<SuiteResponse[]> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/suites", {
      ...(options?.kind !== undefined && {
        params: { query: { kind: options.kind } },
      }),
    });
    return unwrapApiResult({
      operation: "list suites",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async get(id: string): Promise<SuiteResponse> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/suites/{id}", {
      params: { path: { id } },
    });
    return unwrapApiResult({
      operation: `get suite "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async create(params: CreateSuiteBody): Promise<SuiteResponse> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/suites", {
      body: params,
    });
    return unwrapApiResult({
      operation: "create suite",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async update(id: string, params: UpdateSuiteBody): Promise<SuiteResponse> {
    const { data, error, response } = await this.apiClient.PATCH("/api/v1/suites/{id}", {
      params: { path: { id } },
      body: params,
    });
    return unwrapApiResult({
      operation: `update suite "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async duplicate(id: string): Promise<SuiteResponse> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/suites/{id}/duplicate", {
      params: { path: { id } },
    });
    return unwrapApiResult({
      operation: `duplicate suite "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async run(id: string, options?: SuiteRunOptions): Promise<SuiteRunResult>;
  /**
   * @deprecated Pass `{ idempotencyKey }` instead. The options object is what
   * carries run parameters, and a positional key cannot reach them.
   */
  async run(id: string, idempotencyKey: string): Promise<SuiteRunResult>;
  async run(
    id: string,
    optionsOrIdempotencyKey?: SuiteRunOptions | string,
  ): Promise<SuiteRunResult> {
    const options: SuiteRunOptions =
      typeof optionsOrIdempotencyKey === "string"
        ? { idempotencyKey: optionsOrIdempotencyKey }
        : (optionsOrIdempotencyKey ?? {});

    const body: {
      idempotencyKey: string;
      parameters?: Record<string, string | number | boolean>;
      note?: string;
    } = {
      idempotencyKey:
        options.idempotencyKey ?? `cli-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    if (options.parameters !== undefined) body.parameters = options.parameters;
    // A note of only spaces is no note: sending "" would store an empty string
    // every reader then has to filter out.
    const note = options.note?.trim();
    if (note) body.note = note;

    const { data, error, response } = await this.apiClient.POST("/api/v1/suites/{id}/run", {
      params: { path: { id } },
      body,
    });
    return unwrapApiResult({
      operation: `run suite "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async delete(id: string): Promise<{ id: string; archived: boolean }> {
    const { data, error, response } = await this.apiClient.DELETE("/api/v1/suites/{id}", {
      params: { path: { id } },
    });
    return unwrapApiResult({
      operation: `delete suite "${id}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    }) as unknown as { id: string; archived: boolean };
  }
}
