/**
 * Governed analytics SQL — the REST routes.
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
 * @see ~/server/analytics/governed-sql — the service and everything under it
 * @see specs/analytics/governed-sql-api.feature
 */

import { NotFoundError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import type { Project } from "~/generated/prisma/client";
import {
  GOVERNED_COLUMN_UNITS,
  GOVERNED_SQL_CLEAN_DIAGNOSTICS_MEANING,
  GOVERNED_SQL_DIAGNOSTIC_CODES,
  getGovernedSqlService,
} from "~/server/analytics/governed-sql";
import { GovernedSqlNotEnabledError } from "~/server/analytics/governed-sql/errors";
import { type createProjectApp, requires } from "~/server/api/security";
import { getProtectionsForProject } from "~/server/api/utils";
import { validator as zValidator } from "~/server/api/validation";
import { prisma } from "~/server/db";
import { featureFlagService } from "~/server/featureFlag";
import { baseResponses } from "../../shared/base-responses";

const logger = createLogger("langwatch:api:analytics-sql");

/**
 * Longest statement the endpoint accepts.
 *
 * A request-shape ceiling rather than a cost one — the cost ceilings are pinned
 * server-side by the settings profile. It exists so that pathological input is
 * refused before it reaches a parser fed attacker-controlled text, and it sits
 * far above any query the issue's analytical shapes produce.
 */
const MAX_SQL_LENGTH = 50_000;

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

const governedSqlQuerySchema = z.object({
  // Deliberately not `.trim()`: the statement the database runs must be the one
  // that was submitted, and normalising it here — however harmlessly — is the
  // first step of the rewriting this API promises never to do.
  sql: z.string().min(1).max(MAX_SQL_LENGTH),
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
  timeWindow: z
    .object({ start: z.coerce.date(), end: z.coerce.date() })
    .optional(),
});

// Response schemas exist for the published OpenAPI document. The service owns
// the types; these describe them to a consumer reading the spec, and stay loose
// where the payload genuinely is (a result row's columns are the caller's).
const governedSqlResultSchema = z.object({
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
      code: z.enum(GOVERNED_SQL_DIAGNOSTIC_CODES),
      message: z.string(),
      meta: z.record(z.string(), z.any()).optional(),
    }),
  ),
});

const governedSchemaSchema = z.object({
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
          unit: z.enum(GOVERNED_COLUMN_UNITS).nullable(),
          gates: z.array(z.enum(["input", "output", "costs"])),
          available: z.boolean(),
        }),
      ),
      exampleSql: z.string(),
    }),
  ),
});

/**
 * The project this request runs for, having checked the URL agrees with the
 * credential.
 *
 * Returns the credential's project, never the one the path named — so even a
 * future refactor that forgot the check could not widen scope, because the id
 * from the URL is never what anything downstream reads.
 */
function callerProject({
  project,
  requestedProjectId,
}: {
  project: Project;
  requestedProjectId: string | undefined;
}): Project {
  if (requestedProjectId !== project.id) {
    throw new NotFoundError(
      "project_not_found",
      "Project",
      requestedProjectId ?? "",
    );
  }
  return project;
}

/**
 * The experimental gate over the whole surface, same flag as the workbench's
 * tRPC router. Checked per request and server-side only; an API key has no
 * member behind it, so the project is the distinct identity.
 */
async function requireGovernedSqlEnabled(project: Project): Promise<void> {
  // The flag store's organization-scoped rules fail closed when the calling
  // context has no organization, so the gate resolves the project's — without
  // this, a rule enabling the surface for an organization could never match.
  const team = await prisma.team.findUnique({
    where: { id: project.teamId },
    select: { organizationId: true },
  });
  const enabled = await featureFlagService.isEnabled(
    "release_governed_sql_workbench",
    {
      distinctId: project.id,
      projectId: project.id,
      organizationId: team?.organizationId,
    },
  );
  if (!enabled) throw new GovernedSqlNotEnabledError();
}

export function registerGovernedSqlRoutes(
  secured: ReturnType<typeof createProjectApp>,
): void {
  secured.access(requires("analytics:view")).post(
    "/:projectId/analytics/query/clickhouse",
    describeRoute({
      summary: "Run governed analytics SQL",
      description:
        "Executes one read-only ClickHouse SELECT over the governed analytics datasets and returns typed columns, rows, execution statistics, truncation state and diagnostics. The query runs as a restricted database identity scoped to the authenticated project. " +
        `Diagnostics are advisory and never reject a query. ${GOVERNED_SQL_CLEAN_DIAGNOSTICS_MEANING}`,
      tags: ["Analytics / Governed SQL"],
      responses: {
        ...baseResponses,
        200: {
          description:
            "The query ran, and the result is scoped to the caller's project",
          content: {
            "application/json": { schema: resolver(governedSqlResultSchema) },
          },
        },
      },
    }),
    zValidator("json", governedSqlQuerySchema),
    async (c) => {
      const project = callerProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      await requireGovernedSqlEnabled(project);
      const { sql, parameters, timeWindow } = c.req.valid("json");

      logger.info(
        { projectId: project.id, sqlLength: sql.length },
        "Running governed analytics SQL",
      );

      const result = await getGovernedSqlService().execute({
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
      summary: "Discover the governed analytics schema",
      description:
        "Lists the governed analytics datasets this key may query, with each column's type, description, the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join keys, partition-pruning time column, freshness and a runnable example query.",
      tags: ["Analytics / Governed SQL"],
      responses: {
        ...baseResponses,
        200: {
          description:
            "The governed schema, scoped to the caller's permissions",
          content: {
            "application/json": { schema: resolver(governedSchemaSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = callerProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      await requireGovernedSqlEnabled(project);

      return c.json(
        getGovernedSqlService().describeSchema({
          protections: await getProtectionsForProject(prisma, {
            projectId: project.id,
          }),
        }),
      );
    },
  );
}
