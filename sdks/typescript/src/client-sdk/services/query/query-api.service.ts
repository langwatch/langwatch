import type { paths } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";

/** The JSON-RPC 2.0 envelope every `/api/v1/query` request body carries. */
type QueryRpcRequestBody = NonNullable<
  paths["/api/v1/query"]["post"]["requestBody"]
>["content"]["application/json"];

/** The JSON-RPC 2.0 envelope a `200` answers with — `result` is a union of the two methods' payloads. */
type QueryRpcResponseBody =
  paths["/api/v1/query"]["post"]["responses"]["200"]["content"]["application/json"];

/**
 * `result` on a `200` is a two-member union — one path serves both
 * `query.run` and `query.schema`, so the generated type cannot tell them
 * apart by method. Narrow by `Extract`ing on a property that exists on only
 * one member (`rows` for a run result, `datasets` for a schema result) rather
 * than hand-writing either shape: a contract change to either member's
 * required fields breaks this narrowing at compile time instead of drifting
 * silently, the same reason `ChartRunResult` derives from the generated
 * response rather than a copy.
 */
type QueryRpcResult = QueryRpcResponseBody["result"];

/** The typed columns/rows/statistics payload `query.run` answers with. */
export type QueryRunResult = Extract<QueryRpcResult, { rows: unknown[] }>;

/** The queryable dataset/column catalog `query.schema` answers with. */
export type QuerySchemaResult = Extract<QueryRpcResult, { datasets: unknown[] }>;

/**
 * The parameters a `query.run` call sends. The generated request body types
 * `params` as `unknown` (LangWatchQL's per-method params aren't modelled in
 * the OpenAPI schema), so this is the SDK's own contract for what it sends —
 * not derived, because there is nothing typed to derive it from.
 */
export interface QueryRunParams {
  sql: string;
  parameters?: Record<string, string | number | boolean | null>;
  timeWindow?: { start: string; end: string };
  granularitySeconds?: number;
}

/**
 * The canonical error envelope this API publishes, as the shared error reader
 * expects to find it: at the top level of the body.
 *
 * A refusal this endpoint's own handler raised is wrapped in JSON-RPC, so the
 * canonical envelope rides one level deeper as `error.data`. Lift it back out
 * so the reader sees the shape every other family answers with.
 *
 * Anything else is returned untouched: a bare canonical envelope (how auth
 * refusals arrive, raised before this endpoint's handler), a JSON-RPC error
 * with no canonical `data`, a proxy's HTML, a truncated body. Unwrapping is
 * strictly additive — it never discards a body it does not recognise.
 */
const canonicalBody = (error: unknown): unknown => {
  if (typeof error !== "object" || error === null) return error;
  const rpcError = (error as { error?: unknown }).error;
  if (typeof rpcError !== "object" || rpcError === null) return error;
  const data = (rpcError as { data?: unknown }).data;
  // Only a canonical envelope has a string `code`; a JSON-RPC error's own
  // `code` is a number, and `data` may be absent or carry something else.
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as { code?: unknown }).code !== "string"
  ) {
    return error;
  }
  return { error: data };
};

export class QueryApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
    /**
     * The HTTP status the platform answered with, when the response was kept.
     * Without it the CLI's error reader can only guess `network_error` for a
     * failure the platform named precisely — same rationale as `TracesApiError`.
     */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "QueryApiError";
  }
}

/**
 * Typed client for the LangWatchQL JSON-RPC door (`POST /api/v1/query`) —
 * the same governed query surface the workbench and saved charts run
 * through, exposed directly rather than only via a saved chart's statement.
 *
 * Unlike the chart family, this route carries no `projectId` in its path or
 * body — the generated operation declares `path?: never`. Project scope is
 * resolved once, when the underlying `LangwatchApiClient` is built
 * (`createLangWatchApiClient` bakes `scopedProjectId() ?? LANGWATCH_PROJECT_ID`
 * into that client's `Authorization`/`Basic` header at construction time —
 * see `src/internal/api/client.ts` and `src/internal/api/auth.ts`). A
 * per-call `projectId()` resolution the way `ChartsApiService` has one would
 * therefore be dead code here: there is no URL slot to put it in, and it
 * cannot retroactively change a header already baked into an existing
 * client. It would also wrongly force every caller to have a project in
 * scope — legacy `sk-lw-*` project keys carry their own project identity and
 * need none (see `buildAuthHeaders`). So this service takes the plain,
 * project-implicit config `AnalyticsApiService` does, and lets the api
 * client resolve the credential itself.
 */
export class QueryApiService {
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
    // The shared reader (`throwIfHandledError`) decides "did the platform NAME
    // this failure?" by looking for the canonical envelope `{error:{code,...}}`
    // at the TOP level of the body — the shape every REST family answers with.
    // This endpoint is the one that speaks JSON-RPC, so a refusal its own
    // handler raised arrives one level deeper, as `error.data`. Handed the raw
    // body, the reader finds `error.code = -32000` (a JSON-RPC number, not a
    // canonical code), decides the failure is unnamed, and the caller loses the
    // code, the trace id and the platform's sentence — every 400/422 degrading
    // to a generic error.
    //
    // So unwrap the transport here, in the one service that speaks it, rather
    // than teaching the shared reader about JSON-RPC — it is used by every
    // other family and must keep reading exactly one shape.
    //
    // Auth refusals (401/403) are raised BEFORE this endpoint's handler and so
    // arrive already unwrapped, as the bare canonical envelope. `canonicalBody`
    // passes those through untouched.
    const canonical = canonicalBody(error);
    const message = formatApiErrorForOperation({
      operation: operation,
      error: canonical,
      options: { status },
    });
    // A failure the platform NAMED (a code, a status, a meta bag) is raised as
    // the typed `LangWatchHandledError`, so the CLI's error output carries the
    // real code instead of degrading everything to `network_error`.
    throwIfHandledError({ operation, error: canonical, response, message });
    throw new QueryApiError(message, operation, error, status);
  }

  /**
   * A JSON-RPC id for one call. Only needs to correlate a request with its
   * own response — not global uniqueness — so a per-call counter is enough
   * and stays deterministic for tests.
   */
  #nextId = 0;
  private requestId(): number {
    return ++this.#nextId;
  }

  /**
   * Runs one read-only LangWatchQL `SELECT` over the analytics datasets and
   * returns typed columns, rows, execution statistics, truncation state and
   * diagnostics, scoped to the caller's project.
   */
  async query(params: QueryRunParams): Promise<QueryRunResult> {
    const body: QueryRpcRequestBody = {
      jsonrpc: "2.0",
      id: this.requestId(),
      method: "query.run",
      params,
    };
    const { data, error, response } = await this.apiClient.POST(
      "/api/v1/query",
      { body },
    );
    if (error) this.handleApiError("run query", error, response);
    // `result` is typed as the two-method union statically; which member it
    // actually is depends on the `method` we just sent, a runtime fact the
    // type system cannot see through the string literal. Narrow with the
    // `Extract` alias above rather than a hand-written shape.
    return data.result as QueryRunResult;
  }

  /**
   * Lists the LangWatchQL analytics datasets this key may query, with each
   * column's type, description, the permissions that unlock it, and whether
   * this caller holds them — plus each dataset's grain, join keys,
   * partition-pruning time column, freshness and a runnable example query.
   */
  async schema(): Promise<QuerySchemaResult> {
    const body: QueryRpcRequestBody = {
      jsonrpc: "2.0",
      id: this.requestId(),
      method: "query.schema",
    };
    const { data, error, response } = await this.apiClient.POST(
      "/api/v1/query",
      { body },
    );
    if (error) this.handleApiError("discover query schema", error, response);
    return data.result as QuerySchemaResult;
  }
}
