import type { paths } from "@/internal/generated/openapi/api-client";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import type { InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";

/** One run plan, exactly as the REST surface answers it. */
export type RunPlan =
  paths["/api/v1/run-plans/{id}"]["get"]["responses"]["200"]["content"]["application/json"];

/** What a run plan covers. A dynamic scope is resolved again at every run. */
export type RunPlanScope = RunPlan["scope"];

/** What a run goes against. */
export type RunPlanTarget = RunPlan["targets"][number];

/** The body `POST /api/v1/run-plans/run` takes. */
export type RunPlanRunBody = NonNullable<
  paths["/api/v1/run-plans/run"]["post"]["requestBody"]
>["content"]["application/json"];

/** The configuration half of a run request. */
export type RunPlanConfig = RunPlanRunBody["config"];

/** What a scheduled run answers with. */
export type RunPlanRunResult =
  paths["/api/v1/run-plans/run"]["post"]["responses"]["200"]["content"]["application/json"];

/** The body `POST /api/v1/run-plans/{id}/run` takes. */
export type RunPlanRerunBody = NonNullable<
  paths["/api/v1/run-plans/{id}/run"]["post"]["requestBody"]
>["content"]["application/json"];

export class RunPlansApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
    /**
     * The HTTP status the platform answered with, when the response was kept,
     * so the CLI's error reader does not degrade a named failure to
     * `network_error`.
     */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "RunPlansApiError";
  }
}

/**
 * Typed client for the run plan family (`/api/v1/run-plans`).
 *
 * A run plan is identified by its NAME. Posting a configuration under a name
 * already in use replaces that plan's configuration and joins its history;
 * posting under a new name creates the plan; posting no name lets the platform
 * derive one from what the run covers and what it runs against.
 *
 * @see specs/typescript-sdk/run-plans-and-test-suites.feature
 */
export class RunPlansApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
  }

  private handleApiError(operation: string, error: unknown, response?: Response): never {
    const status = response?.status ?? extractStatusFromResponse(error);
    const message = formatApiErrorForOperation({
      operation,
      error,
      options: { status },
    });
    throwIfHandledError({ operation, error, response, message });
    throw new RunPlansApiError(message, operation, error, status);
  }

  /** The project's run plans. Archived plans are left out unless asked for. */
  async list(options?: { includeArchived?: boolean }): Promise<RunPlan[]> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/run-plans", {
      ...(options?.includeArchived ? { params: { query: { includeArchived: "true" } } } : {}),
    });
    if (error) this.handleApiError("list run plans", error, response);
    return data as unknown as RunPlan[];
  }

  async get(id: string): Promise<RunPlan> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/run-plans/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`get run plan "${id}"`, error, response);
    return data as unknown as RunPlan;
  }

  /**
   * Runs a configuration under a name.
   *
   * A note of only spaces is no note: sending an empty string would store a
   * value every reader then has to filter out.
   */
  async run(body: RunPlanRunBody): Promise<RunPlanRunResult> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/run-plans/run", {
      body: withTrimmedNote(body),
    });
    if (error) this.handleApiError("run a run plan", error, response);
    return data as unknown as RunPlanRunResult;
  }

  /** Runs a plan again with the configuration it already holds. */
  async rerun(id: string, body: RunPlanRerunBody = {}): Promise<RunPlanRunResult> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/run-plans/{id}/run", {
      params: { path: { id } },
      body: withTrimmedNote(body),
    });
    if (error) this.handleApiError(`rerun run plan "${id}"`, error, response);
    return data as unknown as RunPlanRunResult;
  }

  async archive(id: string): Promise<{ id: string; archived: true }> {
    const { data, error, response } = await this.apiClient.DELETE("/api/v1/run-plans/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`archive run plan "${id}"`, error, response);
    return data as unknown as { id: string; archived: true };
  }
}

/** Drops a note that holds only spaces, and trims the rest. */
function withTrimmedNote<T extends { note?: string }>(body: T): T {
  const note = body.note?.trim();
  if (note) return { ...body, note };
  const { note: _dropped, ...rest } = body;
  return rest as T;
}
