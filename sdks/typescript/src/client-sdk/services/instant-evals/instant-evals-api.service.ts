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

/** One Instant Eval run, exactly as the REST surface answers it. */
export type InstantEvalRun =
  paths["/api/v1/instant-evals/{id}"]["get"]["responses"]["200"]["content"]["application/json"];

/** One question a run asks, named by the output column it lands in. */
export type InstantEvalQuestion = InstantEvalRun["questions"][number];

/** The body that starts a run, and the same body that prices one. */
export type InstantEvalRunBody = NonNullable<
  paths["/api/v1/instant-evals"]["post"]["requestBody"]
>["content"]["application/json"];

/** What a run would read and what judging it would cost. */
export type InstantEvalEstimate =
  paths["/api/v1/instant-evals/estimate"]["post"]["responses"]["200"]["content"]["application/json"];

/** One page of a run's judgements, and where the next one starts. */
export type InstantEvalResultsPage =
  paths["/api/v1/instant-evals/{id}/results"]["get"]["responses"]["200"]["content"]["application/json"];

/** One judgement the run recorded. */
export type InstantEvalJudgment = InstantEvalResultsPage["judgments"][number];

/** A few of a run's rows, with the judged text beside the verdict. */
export type InstantEvalSample =
  paths["/api/v1/instant-evals/{id}/sample"]["get"]["responses"]["200"]["content"]["application/json"];

export class InstantEvalsApiError extends Error {
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
    this.name = "InstantEvalsApiError";
  }
}

/**
 * Typed client for the Instant Evals family (`/api/v1/instant-evals`).
 *
 * A run judges one LangWatchQL statement across the project's history. The
 * statement is the same one the query door runs, so a working query is a
 * working run once it projects `TraceId` and at least one eval function
 * column. Starting one answers the queued run, and its progress is polled.
 *
 * The project comes from the credential, so no method takes a project id.
 *
 * @see specs/instant-evals/instant-eval-api.feature
 */
export class InstantEvalsApiService {
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
    throw new InstantEvalsApiError(message, operation, error, status);
  }

  /**
   * The body of a successful answer. A failed response can arrive with no body
   * at all (a proxy answering 502 while the platform restarts), which leaves
   * `error` empty, so the response status decides and not the error alone.
   */
  private unwrap<T>({
    operation,
    data,
    error,
    response,
  }: {
    operation: string;
    data: unknown;
    error: unknown;
    response?: Response;
  }): T {
    const failed = response !== undefined && !response.ok;
    if (error || failed || data === undefined) {
      this.handleApiError(operation, error ?? undefined, response);
    }
    return data as T;
  }

  /** Starts a run. The judging happens on the queue. */
  async create(body: InstantEvalRunBody): Promise<InstantEvalRun> {
    const { data, error, response } = await this.apiClient.POST(
      "/api/v1/instant-evals",
      { body },
    );
    return this.unwrap<InstantEvalRun>({
      operation: "start an instant eval run",
      data,
      error,
      response,
    });
  }

  /** Prices a run without starting it. Nothing is judged and nothing is charged. */
  async estimate(body: InstantEvalRunBody): Promise<InstantEvalEstimate> {
    const { data, error, response } = await this.apiClient.POST(
      "/api/v1/instant-evals/estimate",
      { body },
    );
    return this.unwrap<InstantEvalEstimate>({
      operation: "estimate an instant eval run",
      data,
      error,
      response,
    });
  }

  /** The project's runs, newest first. */
  async list(options?: {
    limit?: number;
    before?: string;
    beforeId?: string;
  }): Promise<InstantEvalRun[]> {
    const query = {
      ...(options?.limit === undefined ? {} : { limit: options.limit }),
      ...(options?.before === undefined ? {} : { before: options.before }),
      ...(options?.beforeId === undefined
        ? {}
        : { beforeId: options.beforeId }),
    };
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/instant-evals",
      { params: { query } as never },
    );
    return this.unwrap<{ runs: InstantEvalRun[] }>({
      operation: "list instant eval runs",
      data,
      error,
      response,
    }).runs;
  }

  async get(id: string): Promise<InstantEvalRun> {
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/instant-evals/{id}",
      { params: { path: { id } } },
    );
    return this.unwrap<InstantEvalRun>({
      operation: `get instant eval run "${id}"`,
      data,
      error,
      response,
    });
  }

  /** Asks a run to stop. It stops before its next page. */
  async cancel(id: string): Promise<InstantEvalRun> {
    const { data, error, response } = await this.apiClient.POST(
      "/api/v1/instant-evals/{id}/cancel",
      { params: { path: { id } } },
    );
    return this.unwrap<InstantEvalRun>({
      operation: `cancel instant eval run "${id}"`,
      data,
      error,
      response,
    });
  }

  /**
   * One page of a run's judgements.
   *
   * Pass the `nextCursor` a page answers with to read the page after it. The
   * last page carries none.
   */
  async results(
    id: string,
    options?: {
      questionId?: string;
      isMatched?: boolean;
      status?: InstantEvalJudgment["status"];
      limit?: number;
      cursor?: string;
    },
  ): Promise<InstantEvalResultsPage> {
    const query = {
      ...(options?.questionId === undefined
        ? {}
        : { questionId: options.questionId }),
      // The query key stays `matched`, which is what the endpoint reads; the
      // option is named for what it is, which is a boolean.
      ...(options?.isMatched === undefined
        ? {}
        : { matched: options.isMatched ? "true" : "false" }),
      ...(options?.status === undefined ? {} : { status: options.status }),
      ...(options?.limit === undefined ? {} : { limit: options.limit }),
      ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
    };
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/instant-evals/{id}/results",
      { params: { path: { id }, query } as never },
    );
    return this.unwrap<InstantEvalResultsPage>({
      operation: `read instant eval run "${id}" results`,
      data,
      error,
      response,
    });
  }

  /** A few of the run's rows, with the judged text beside the verdict. */
  async sample(id: string, options?: { n?: number }): Promise<InstantEvalSample> {
    const query = options?.n === undefined ? {} : { n: options.n };
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/instant-evals/{id}/sample",
      { params: { path: { id }, query } as never },
    );
    return this.unwrap<InstantEvalSample>({
      operation: `sample instant eval run "${id}"`,
      data,
      error,
      response,
    });
  }
}
