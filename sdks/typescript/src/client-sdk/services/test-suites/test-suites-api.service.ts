import type { paths } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import type { InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import type { RunPlanRunResult } from "@/client-sdk/services/run-plans/run-plans-api.service";

/** One test suite as the list answers it: a name and the cases filed in it. */
export type TestSuite = NonNullable<
  paths["/api/v1/test-suites"]["get"]["responses"]["200"]["content"]["application/json"]
>[number];

/** One test suite read on its own, with its scenarios named. */
export type TestSuiteDetail =
  paths["/api/v1/test-suites/{id}"]["get"]["responses"]["200"]["content"]["application/json"];

/** The body `POST /api/v1/test-suites` takes. */
export type CreateTestSuiteBody = NonNullable<
  paths["/api/v1/test-suites"]["post"]["requestBody"]
>["content"]["application/json"];

/** The body `PATCH /api/v1/test-suites/{id}` takes. */
export type RenameTestSuiteBody = NonNullable<
  paths["/api/v1/test-suites/{id}"]["patch"]["requestBody"]
>["content"]["application/json"];

/** The body `POST /api/v1/test-suites/{id}/run` takes. */
export type RunTestSuiteBody = NonNullable<
  paths["/api/v1/test-suites/{id}/run"]["post"]["requestBody"]
>["content"]["application/json"];

/** What a scheduled suite run answers with. It is a run plan run. */
export type TestSuiteRunResult = RunPlanRunResult;

export class TestSuitesApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
    /** The HTTP status the platform answered with, when the response was kept. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "TestSuitesApiError";
  }
}

/**
 * Typed client for the test suite family (`/api/v1/test-suites`).
 *
 * A test suite is a folder of scenarios: a name, and the cases filed in it. It
 * holds no targets and no configuration, so running one sends its targets with
 * the request and the platform files the run under a run plan.
 *
 * @see specs/typescript-sdk/run-plans-and-test-suites.feature
 */
export class TestSuitesApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
  }

  private handleApiError(
    operation: string,
    error: unknown,
    response?: Response,
  ): never {
    const status = response?.status ?? extractStatusFromResponse(error);
    const message = formatApiErrorForOperation({
      operation,
      error,
      options: { status },
    });
    throwIfHandledError({ operation, error, response, message });
    throw new TestSuitesApiError(message, operation, error, status);
  }

  /** The project's test suites. Archived suites are left out unless asked for. */
  async list(options?: { includeArchived?: boolean }): Promise<TestSuite[]> {
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/test-suites",
      {
        ...(options?.includeArchived
          ? { params: { query: { includeArchived: "true" } } }
          : {}),
      },
    );
    if (error) this.handleApiError("list test suites", error, response);
    return data as unknown as TestSuite[];
  }

  async create(params: CreateTestSuiteBody): Promise<TestSuite> {
    const { data, error, response } = await this.apiClient.POST(
      "/api/v1/test-suites",
      { body: params },
    );
    if (error) this.handleApiError("create test suite", error, response);
    return data as unknown as TestSuite;
  }

  async get(id: string): Promise<TestSuiteDetail> {
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/test-suites/{id}",
      { params: { path: { id } } },
    );
    if (error) this.handleApiError(`get test suite "${id}"`, error, response);
    return data as unknown as TestSuiteDetail;
  }

  /** Renames a suite. The slug is kept, so links and run history stay put. */
  async rename(id: string, params: RenameTestSuiteBody): Promise<TestSuite> {
    const { data, error, response } = await this.apiClient.PATCH(
      "/api/v1/test-suites/{id}",
      { params: { path: { id } }, body: params },
    );
    if (error) this.handleApiError(`rename test suite "${id}"`, error, response);
    return data as unknown as TestSuite;
  }

  /** Archives a suite. The scenarios filed in it are archived with it. */
  async archive(id: string): Promise<{ id: string; archived: true }> {
    const { data, error, response } = await this.apiClient.DELETE(
      "/api/v1/test-suites/{id}",
      { params: { path: { id } } },
    );
    if (error)
      this.handleApiError(`archive test suite "${id}"`, error, response);
    return data as unknown as { id: string; archived: true };
  }

  /**
   * Runs every scenario filed in the suite against the targets sent with the
   * request. A note of only spaces is no note.
   */
  async run(id: string, body: RunTestSuiteBody): Promise<TestSuiteRunResult> {
    const note = body.note?.trim();
    const { note: _dropped, ...rest } = body;
    const { data, error, response } = await this.apiClient.POST(
      "/api/v1/test-suites/{id}/run",
      {
        params: { path: { id } },
        body: note ? { ...rest, note } : rest,
      },
    );
    if (error) this.handleApiError(`run test suite "${id}"`, error, response);
    return data as unknown as TestSuiteRunResult;
  }
}
