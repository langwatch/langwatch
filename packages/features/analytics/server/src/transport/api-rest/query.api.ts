/**
 * The query domain — LangWatchQL over REST, on its own family.
 * @see ../../langwatch-ql — the service and everything under it
 * @see specs/analytics/lwql-api.feature
 */

import { apiKeyPermission } from "@langwatch/api";
import {
  type AppRestSecurity,
  canonicalBaseResponses,
  canonicalUnprocessableResponses,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  projectOf,
  type ProjectScopedContext,
  resolver,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";

import { LWQL_CLEAN_DIAGNOSTICS_MEANING } from "../../rules/langwatch-ql-diagnostics-shape.rules.ts";
import type { LangWatchQLRestPorts } from "../../services/langwatch-ql-route-guards.service.ts";
import { z } from "zod";
import { LWQL_COLUMN_UNITS } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import { LWQL_DIAGNOSTIC_CODES } from "../../rules/langwatch-ql-diagnostics-shape.rules.ts";
import { MAX_LWQL_LENGTH } from "../../rules/langwatch-ql-sql-literal.rules.ts";
import {
  lwqlGranularityStepSchema,
  lwqlTimeWindowSchema,
} from "../../services/langwatch-ql-time-window.service.ts";

const logger = createLogger("langwatch:api:query");

const QUERY_TAGS = ["Query"];

/**
 * The permission this family enforces for itself. Named once and shared by both routes so the
 * policy and the audits cannot drift apart, and so a future cross-project fan-out has a single
 * place to read it from.
 */
const QUERY_PERMISSION = "analytics:view" as const;

/**
 * The gate: `analytics:view` through the API-key ceiling. `apiKeyPermission` rather than
 * `requires`, because this is a public API-key surface — the ceiling is what makes a scoped key
 * answer `effective = ApiKey ∩ user` instead of inheriting the whole of its owner's access.
 */
const queryAccess = apiKeyPermission(QUERY_PERMISSION);

const RUN_DESCRIPTION =
  "Executes one read-only LangWatchQL SELECT over the analytics datasets and returns typed columns, rows, execution statistics, truncation state and diagnostics. The query runs as a restricted database identity scoped to the authenticated project.\n\n" +
  `Diagnostics are advisory and never reject a query. ${LWQL_CLEAN_DIAGNOSTICS_MEANING}\n\n` +
  "The project is taken from the credential — no project id appears anywhere in the path or the body, and none can be sent to select another one.\n\n" +
  "Failures answer with their real HTTP status (a refused query is 403, not 200) and this API's canonical error envelope — the same `code` and `meta` every other REST family publishes.";

const SCHEMA_DESCRIPTION =
  "Lists the LangWatchQL analytics datasets this key may query, with each column's type, description, the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join keys, partition-pruning time column, freshness and a runnable example query.\n\n" +
  "Scoped to the credential's own project and its permissions: a column this key cannot read is listed with `available: false` rather than hidden, so a caller can see what a wider key would unlock.";

/**
 * `/api/v1/query`, bound to one process's graph. Version-first, unlike the families that
 * predate it: a consumer holding a base URL does not learn two rules for where `v1` lives.
 */
export function createQueryRestApp(options: {
  security: AppRestSecurity;
  ports: LangWatchQLRestPorts;
}): MountableRestApp {
  const { security, ports } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "query",
    basePath: "/api/v1/query",
    errorEnvelope: "canonical",
    staticGeneration: "v1",
  });

  type QueryContext = ProjectScopedContext<EndpointVariables>;

  const projectId = (c: QueryContext): string => projectOf(c).id;

  /** `POST /api/v1/query` — execute one statement. The body IS the query. */
  const runHandler = async (c: QueryContext, input: z.infer<typeof lwqlQuerySchema>) => {
    const { sql, parameters, timeWindow, granularitySeconds } = input;
    const id = projectId(c);

    logger.info({ projectId: id, sqlLength: sql.length }, "Running LangWatchQL query");

    // The restricted tenant capability is hashed from the project's own
    // LangWatchQL secret, which the request's identity deliberately does not
    // carry. Read it here, and hand the service only the two fields it names.
    const { lwqlKey } = await ports.projects().getById(id);

    return await ports.langWatchQL().execute({
      project: { id, lwqlKey },
      protections: await ports.protectionsFor({ projectId: id }),
      sql,
      ...(parameters ? { parameters } : {}),
      ...(timeWindow ? { timeWindow } : {}),
      ...(granularitySeconds === undefined ? {} : { granularitySeconds }),
    });
  };

  /**
   * `GET /api/v1/query/schema` — describe what may be queried. A GET, because it reads a catalog
   * and takes no arguments: the credential is the whole of its input.
   */
  const schemaHandler = async (c: QueryContext) =>
    ports.langWatchQL().describeSchema({
      protections: await ports.protectionsFor({ projectId: projectId(c) }),
    });

  return service
    .registerRoute("post", "/", MANAGEMENT_API_VERSION, runHandler, (b) =>
      policy(queryAccess)(b)
        .withInput(lwqlQuerySchema)
        .withOutput(lwqlResultSchema)
        .withDocs({
          summary: "Run a LangWatchQL query",
          description: RUN_DESCRIPTION,
          tags: QUERY_TAGS,
          responses: {
            ...canonicalBaseResponses,
            // A scan-ceiling refusal: the statement is well formed, the volume
            // it would read is not allowed. QueryScanLimitExceededError carries 422.
            ...canonicalUnprocessableResponses,
            200: {
              description:
                "The query ran. Columns, rows, execution statistics, truncation state and diagnostics, scoped to the caller's project.",
              content: {
                "application/json": { schema: resolver(lwqlResultSchema) },
              },
            },
          },
        }),
    )
    .registerRoute("get", "/schema", MANAGEMENT_API_VERSION, schemaHandler, (b) =>
      policy(queryAccess)(b)
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
              content: {
                "application/json": { schema: resolver(lwqlSchemaSchema) },
              },
            },
          },
        }),
    )
    .build();
}

/**
 * The wire shapes of the query domain: what a caller sends, and what the two doors answer with.
 * @see ./query.api.ts — the routes these describe
 */

/**
 * A bound parameter's value. Scalars only: a parameter is a *value*, and anything structured
 * would be a value whose shape the declared ClickHouse type cannot describe.
 */
const parameterValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const lwqlQuerySchema = z.object({
  // Deliberately not `.trim()`: the statement the database runs must be the one
  // that was submitted, and normalising it here — however harmlessly — is the
  // first step of the rewriting this API promises never to do.
  sql: z.string().min(1).max(MAX_LWQL_LENGTH),
  parameters: z.record(z.string(), parameterValueSchema).optional(),
  /**
   * The period this caller is reporting over. Honoured here and not only on the dashboard,
   * because the same saved chart is readable from both and a statement that follows the period
   * must not have two different meanings depending on which surface asked.
   */
  timeWindow: lwqlTimeWindowSchema.optional(),
  /**
   * The datapoint step for a statement that declares `{period_granularity_seconds:UInt32}`, in
   * seconds — the REST twin of the workbench's step control, so a statement's bucketing means
   * the same thing at both doors.
   */
  granularitySeconds: lwqlGranularityStepSchema.optional(),
});

// Response schemas exist for the published OpenAPI document. The service owns
// the types; these describe them to a consumer reading the spec, and stay loose
// where the payload genuinely is (a result row's columns are the caller's).
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
  // Whether the statement DECLARED the reserved time-window parameters and was therefore given
  // the surface's window. It is not a claim about the rows: the author writes the comparison,
  // so a statement that declares the names and never compares against them reports `true` and
  // still reads all of time. What a consumer can say from it is that this result was offered
  // the period beside it, not that the period bounded it.
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
          // question for every column, and `null` is the answer for one that
          // is not measured in anything. A consumer can tell that apart from
          // an API too old to have units; `.optional()` could not.
          unit: z.enum(LWQL_COLUMN_UNITS).nullable(),
          gates: z.array(z.enum(["input", "output", "costs"])),
          available: z.boolean(),
        }),
      ),
      exampleSql: z.string(),
    }),
  ),
});
