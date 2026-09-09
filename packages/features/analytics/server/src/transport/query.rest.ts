/**
 * LangWatchQL over REST at `/api/v1/query`. Version-first, unlike the families
 * that predate it: a consumer holding a base URL learns one rule for `v1`.
 * @see packages/features/analytics/specs — lwql-api
 */
import {
  langWatchQLProtectionsSchema,
  lwqlStatementSchema,
  type LangWatchQLCaller,
  type LangWatchQLExecuteInput,
  type LangWatchQLProtections,
  type LangWatchQLQueryResult,
  type LangWatchQLSchema,
} from "@langwatch/analytics-contract";
import {
  canonicalBaseResponses,
  canonicalUnprocessableResponses,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
} from "@langwatch/api/rest";
import { featureApi } from "@langwatch/runtime-composition";
import { z } from "zod";

import { LWQL_COLUMN_UNITS } from "../services/langwatch-ql-catalog-shapes.service.ts";
import {
  LWQL_CLEAN_DIAGNOSTICS_MEANING,
  LWQL_DIAGNOSTIC_CODES,
} from "../rules/langwatch-ql-diagnostics-shape.rules.ts";

/**
 * What the query door reaches. The project identity is the process's: the tenant
 * capability is hashed from a secret the request deliberately does not carry.
 */
export interface AnalyticsQueryApi {
  /**
   * The project identity one execution runs under. Its LangWatchQL secret is
   * read server-side and must never leave the handler — no field of it may
   * appear in a response.
   */
  runCallerFor(input: { projectId: string }): Promise<LangWatchQLCaller>;
  describeSchema(input: { protections: LangWatchQLProtections }): LangWatchQLSchema;
  execute(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult>;
}

export const AnalyticsQueryApi = featureApi<AnalyticsQueryApi>("analytics");

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
  columns: z.array(z.object({ name: z.string(), type: z.string() })),
  rows: z.array(z.record(z.string(), z.any())),
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
  diagnostics: z.array(
    z.object({
      // Enumerated rather than a bare string: a consumer branches on the code,
      // and a published spec that would not tell it which codes exist makes it
      // guess from prose.
      code: z.enum(LWQL_DIAGNOSTIC_CODES),
      message: z.string(),
      meta: z.record(z.string(), z.any()).optional(),
    }),
  ),
});

export const lwqlSchemaSchema = z.object({
  database: z.string(),
  datasets: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      grain: z.string(),
      joinKeys: z.array(z.string()),
      timeColumn: z.string(),
      freshness: z.string(),
      columns: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          description: z.string(),
          // Nullable rather than optional: the response answers the unit
          // question for every column, and `null` is the answer for one that is
          // not measured in anything.
          unit: z.enum(LWQL_COLUMN_UNITS).nullable(),
          gates: z.array(z.enum(["input", "output", "costs"])),
          available: z.boolean(),
        }),
      ),
      exampleSql: z.string(),
    }),
  ),
});

export const queryRest = defineRestRouter(AnalyticsQueryApi)
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

    return app.execute({
      project: await app.runCallerFor({ projectId: scope.id }),
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
  .handle(({ app }, protections) => app.describeSchema({ protections }))
  .build();
