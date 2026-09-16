/**
 * LangWatchQL over REST at `/api/v1/query`. Version-first, unlike the families
 * that predate it: a consumer holding a base URL learns one rule for `v1`.
 * @see modules/analytics/specs — lwql-api
 */
import {
  langWatchQLProtectionsSchema,
  lwqlStatementSchema,
  type AnalyticsApi,
  type LangWatchQLCaller,
} from "@langwatch/analytics-contract";
import {
  canonicalBaseResponses,
  canonicalUnprocessableResponses,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/runtime-composition";
import { z } from "zod";

import {
  LWQL_CLEAN_DIAGNOSTICS_MEANING,
  LWQL_DIAGNOSTIC_CODES,
} from "../rules/langwatch-ql-diagnostics-shape.rules.ts";

/**
 * What the query door reaches — project identity is the process's; the
 * tenant capability is hashed from a secret the request never carries.
 * Typed straight off {@link AnalyticsApi}, so it can't name a spelling the app doesn't implement.
 */
export interface AnalyticsQueryApi extends Pick<
  AnalyticsApi,
  "describeLangWatchQLSchema" | "executeLangWatchQL"
> {
  /**
   * The project identity one execution runs under, for a CREDENTIAL rather
   * than a member — this door has no session, so caller protections arrive
   * as a fact. The LangWatchQL secret must never leave the handler.
   */
  resolveApiKeyRunCaller(input: Readonly<{ projectId: string }>): Promise<LangWatchQLCaller>;
}

export const AnalyticsQueryApi = moduleApi<AnalyticsQueryApi>("analytics");

/**
 * What this credential may see of its project's content. A fact rather than an
 * operation: the answer is the KEY's own cut, and the credential is the door's
 * to read, never the handler's.
 */
export const langWatchQLCallerProtections = defineRestMiddleware(
  "langWatchQLCallerProtections",
  langWatchQLProtectionsSchema,
);

const QUERY_TAGS = ["Query"];

const RUN_DESCRIPTION =
  "Executes one read-only LangWatchQL SELECT over the analytics datasets and returns typed columns, rows, execution statistics, truncation state and diagnostics. The query runs as a restricted database identity scoped to the authenticated project.\n\n" +
  `Diagnostics are advisory and never reject a query. ${LWQL_CLEAN_DIAGNOSTICS_MEANING}\n\n` +
  "The project is taken from the credential — no project id appears anywhere in the path or the body, and none can be sent to select another one.\n\n" +
  "Failures answer with their real HTTP status (a refused query is 403, not 200) and this API's canonical error envelope — the same `code` and `meta` every other REST family publishes.";

const SCHEMA_DESCRIPTION =
  "Lists the LangWatchQL analytics datasets this key may query, with each column's type, description, the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join keys, partition-pruning time column, freshness and a runnable example query.\n\n" +
  "Scoped to the credential's own project and its permissions: a column this key cannot read is listed with `available: false` rather than hidden, so a caller can see what a wider key would unlock.";

// Response schemas exist for the published OpenAPI document. The service owns
// the types; these describe them to a consumer reading the spec, and stay loose
// where the payload genuinely is the caller's.
export const lwqlResultSchema = z.object({
  columns: z.array(z.object({ name: z.string(), type: z.string() })).readonly(),
  rows: z.array(z.record(z.string(), z.any())).readonly(),
  statistics: z.object({
    elapsedMs: z.number(),
    rowsRead: z.number(),
    bytesRead: z.number(),
    rowsReturned: z.number(),
  }),
  truncated: z.boolean(),
  // Whether the statement DECLARED the reserved time-window parameters and was
  // therefore given the surface's window. It is not a claim about the rows: the
  // author writes the comparison, so a statement that declares the names and
  // never compares against them reports `true` and still reads all of time.
  followsTimeWindow: z.boolean(),
  // The granularity facts, mirroring the service's result: whether the
  // statement declares the reserved parameter at all, the step this run was
  // bucketed at when one was supplied for it, and — never set on this
  // caller-owned door today — what a coarsening surface asked for.
  followsGranularity: z.boolean(),
  granularitySeconds: z.number().optional(),
  coarsenedFromSeconds: z.number().optional(),
  diagnostics: z
    .array(
      z.object({
        // Enumerated rather than a bare string: a consumer branches on the code,
        // and a published spec that would not tell it which codes exist makes it
        // guess from prose.
        code: z.enum(LWQL_DIAGNOSTIC_CODES),
        message: z.string(),
        meta: z.record(z.string(), z.any()).optional(),
      }),
    )
    .readonly(),
});

export const lwqlSchemaSchema = z.object({
  database: z.string(),
  datasets: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        grain: z.string(),
        joinKeys: z.array(z.string()).readonly(),
        timeColumn: z.string(),
        freshness: z.string(),
        columns: z
          .array(
            z.object({
              name: z.string(),
              type: z.string(),
              description: z.string(),
              // Nullable rather than optional: `null` answers the unit
              // question for a column not measured in anything. A bare
              // string, matching `LangWatchQLSchemaColumn`'s declared type —
              // not the narrower set this door's catalog happens to draw from.
              unit: z.string().nullable(),
              gates: z.array(z.string()).readonly(),
              available: z.boolean(),
            }),
          )
          .readonly(),
        exampleSql: z.string(),
      }),
    )
    .readonly(),
});

/**
 * The type is written out rather than inferred so the declaration emit
 * stays portable.
 */
export const queryRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<AnalyticsQueryApi>;
}> = defineRestRouter(AnalyticsQueryApi)
  .withNamespace("query")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("v1-only")

  /** `POST /api/v1/query` — execute one statement. The body IS the query. */
  .post("/", "postApiV1Query")
  .withInput(lwqlStatementSchema)
  .withPermission("analytics:view")
  .withMiddleware(langWatchQLCallerProtections)
  .withOutput(lwqlResultSchema)
  .withDocs({
    summary: "Run a LangWatchQL query",
    description: RUN_DESCRIPTION,
    tags: QUERY_TAGS,
    responses: {
      ...canonicalBaseResponses,
      // A scan-ceiling refusal: the statement is well formed, the volume it
      // would read is not allowed. QueryScanLimitExceededError carries 422.
      ...canonicalUnprocessableResponses,
      200: {
        description:
          "The query ran. Columns, rows, execution statistics, truncation state and diagnostics, scoped to the caller's project.",
        content: { "application/json": { schema: resolver(lwqlResultSchema) } },
      },
    },
  })
  .handle(async ({ app, input, scope }, protections) => {
    const { sql, parameters, timeWindow, granularitySeconds } = input;

    return app.executeLangWatchQL({
      project: await app.resolveApiKeyRunCaller({ projectId: scope.id }),
      protections,
      sql,
      ...(parameters ? { parameters } : {}),
      ...(timeWindow ? { timeWindow } : {}),
      ...(granularitySeconds === undefined ? {} : { granularitySeconds }),
    });
  })

  /**
   * `GET /api/v1/query/schema` — describe what may be queried. A GET, because
   * it reads a catalog and takes no arguments: the credential is the whole of
   * its input.
   */
  .get("/schema", "getApiV1QuerySchema")
  .withPermission("analytics:view")
  .withMiddleware(langWatchQLCallerProtections)
  .withOutput(lwqlSchemaSchema)
  .withDocs({
    summary: "Discover the queryable LangWatchQL schema",
    description: SCHEMA_DESCRIPTION,
    tags: QUERY_TAGS,
    responses: {
      ...canonicalBaseResponses,
      200: {
        description:
          "The datasets and columns this key may query, with the permissions that unlock each one.",
        content: { "application/json": { schema: resolver(lwqlSchemaSchema) } },
      },
    },
  })
  .handle(({ app }, protections) => app.describeLangWatchQLSchema({ protections }))
  .build();
