/**
 * LangWatchQL analytics SQL — the REST routes.
 *
 * Two endpoints, named by issue #6480:
 *
 *  - `POST /api/v1/projects/{projectId}/analytics/query/clickhouse`
 *  - `GET  /api/v1/projects/{projectId}/analytics/schema`
 *
 * The handlers are deliberately thin. They resolve *who is asking* — the
 * project from the authenticated credential, the content permissions from the
 * same policy stack every other API-key read path uses — and hand that to the
 * service. Everything a customer's SQL is checked against is decided there and
 * in the layers below it.
 *
 * ## The path parameter is a cross-check, never the scope
 *
 * `projectId` appears in the URL because the issue names the endpoints that
 * way, but it does not *select* anything: the tenant comes from the credential,
 * and a path naming any other project is reported as not found. That is what
 * keeps "tenant scope derives exclusively from authenticated server context"
 * true of a URL that carries a project id — a caller can write whatever they
 * like there and reach nothing new. Not found rather than forbidden, because
 * whether another project exists is not theirs to learn.
 *
 * @see ~/server/analytics/lwql — the service and everything under it
 * @see specs/analytics/lwql-api.feature
 */

import { createLogger } from "@langwatch/observability";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import {
  getLangWatchQLService,
  LWQL_CLEAN_DIAGNOSTICS_MEANING,
  LWQL_COLUMN_UNITS,
  LWQL_DIAGNOSTIC_CODES,
  MAX_LWQL_LENGTH,
} from "~/server/analytics/lwql";
import { lwqlTimeWindowSchema } from "~/server/analytics/lwql/timeWindowSchema";
import { type createProjectApp, requires } from "~/server/api/security";
import { getProtectionsForProject } from "~/server/api/utils";
import { validator as zValidator } from "~/server/api/validation";
import { prisma } from "~/server/db";
import {
  canonicalBaseResponses,
  canonicalUnprocessableResponses,
} from "../../shared/base-responses";
import { lwqlProject } from "./routeGuards";

const logger = createLogger("langwatch:api:analytics-sql");

/**
 * A bound parameter's value.
 *
 * Scalars only: a parameter is a *value*, and anything structured would be a
 * value whose shape the declared ClickHouse type cannot describe.
 */
const parameterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const lwqlQuerySchema = z.object({
  // Deliberately not `.trim()`: the statement the database runs must be the one
  // that was submitted, and normalising it here — however harmlessly — is the
  // first step of the rewriting this API promises never to do.
  sql: z.string().min(1).max(MAX_LWQL_LENGTH),
  parameters: z.record(z.string(), parameterValueSchema).optional(),
  /**
   * The period this caller is reporting over.
   *
   * Honoured here and not only on the dashboard, because the same saved chart
   * is readable from both and a statement that follows the period must not have
   * two different meanings depending on which surface asked. Its values fill the
   * reserved `period_start` / `period_end` parameters the statement declares —
   * which is also why sending either of those under `parameters` is refused.
   */
  timeWindow: lwqlTimeWindowSchema.optional(),
});

// Response schemas exist for the published OpenAPI document. The service owns
// the types; these describe them to a consumer reading the spec, and stay loose
// where the payload genuinely is (a result row's columns are the caller's).
const lwqlResultSchema = z.object({
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
  // What a consumer can say from it is that this result was offered the period
  // beside it, not that the period bounded it.
  followsTimeWindow: z.boolean(),
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

const lwqlSchemaSchema = z.object({
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

export function registerLangWatchQLRoutes(
  secured: ReturnType<typeof createProjectApp>,
): void {
  secured.access(requires("analytics:view")).post(
    "/:projectId/analytics/query/clickhouse",
    describeRoute({
      summary: "Run LangWatchQL analytics SQL",
      description:
        "Executes one read-only ClickHouse SELECT over the LangWatchQL analytics datasets and returns typed columns, rows, execution statistics, truncation state and diagnostics. The query runs as a restricted database identity scoped to the authenticated project. " +
        `Diagnostics are advisory and never reject a query. ${LWQL_CLEAN_DIAGNOSTICS_MEANING}`,
      tags: ["Analytics / LangWatchQL"],
      responses: {
        ...canonicalBaseResponses,
        // A scan-ceiling refusal: the statement is well formed, the volume it
        // would read is not allowed. QueryScanLimitExceededError carries 422.
        ...canonicalUnprocessableResponses,
        200: {
          description:
            "The query ran, and the result is scoped to the caller's project",
          content: {
            "application/json": { schema: resolver(lwqlResultSchema) },
          },
        },
      },
    }),
    zValidator("json", lwqlQuerySchema),
    async (c) => {
      const project = await lwqlProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      const { sql, parameters, timeWindow } = c.req.valid("json");

      logger.info(
        { projectId: project.id, sqlLength: sql.length },
        "Running LangWatchQL analytics SQL",
      );

      const result = await getLangWatchQLService().execute({
        project,
        protections: await getProtectionsForProject(prisma, {
          projectId: project.id,
        }),
        sql,
        ...(parameters ? { parameters } : {}),
        ...(timeWindow ? { timeWindow } : {}),
      });
      return c.json(result);
    },
  );

  secured.access(requires("analytics:view")).get(
    "/:projectId/analytics/schema",
    describeRoute({
      summary: "Discover the LangWatchQL analytics schema",
      description:
        "Lists the LangWatchQL analytics datasets this key may query, with each column's type, description, the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join keys, partition-pruning time column, freshness and a runnable example query.",
      tags: ["Analytics / LangWatchQL"],
      responses: {
        ...canonicalBaseResponses,
        200: {
          description:
            "The LangWatchQL schema, scoped to the caller's permissions",
          content: {
            "application/json": { schema: resolver(lwqlSchemaSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = await lwqlProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });

      return c.json(
        getLangWatchQLService().describeSchema({
          protections: await getProtectionsForProject(prisma, {
            projectId: project.id,
          }),
        }),
      );
    },
  );
}
