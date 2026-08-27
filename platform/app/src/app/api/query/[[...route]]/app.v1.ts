/**
 * The query domain — LangWatchQL over REST, on its own family.
 *
 * Two doors:
 *
 *  - `POST /api/v1/query` — run one statement
 *  - `GET  /api/v1/query/schema` — describe what may be queried
 *
 * This supersedes `/api/v1/projects/{projectId}/analytics/query/clickhouse`
 * and its sibling `.../analytics/schema` — both removed (issue #7565), so this
 * is now the only HTTP door for raw LangWatchQL. Three things moved:
 *
 *  1. **The engine leaves the URL.** `/clickhouse` named the storage engine on
 *     a public path while Postgres-backed views already routed through the same
 *     service. The name promised something the surface does not mean.
 *  2. **The decorative path parameter goes.** `projectId` never *selected*
 *     anything on the old routes — the tenant came from the credential and a
 *     path naming any other project answered not found. A URL segment that
 *     cannot change the answer is a segment that misleads.
 *  3. **The domain gets its own family.** LangWatchQL is not a sub-feature of
 *     charts; charts are a *consumer* of it. `analytics-sql` (directory),
 *     `analytics/query/clickhouse` (URL) and `lwql` (service) were three names
 *     for one thing.
 *
 * The transport is plain REST, like every other family here. A request body is
 * the query itself and a `200` is the result itself — nothing is wrapped, and
 * a refusal is the canonical error envelope this API publishes everywhere
 * else, so one parser reads the whole platform.
 *
 * The version leads: `/api/v1/query`. Issue #7565 originally specified
 * `/api/query/v1` with a deliberate "do not correct this" note, and that
 * decision was reversed on purpose — the reversal and its reasoning are
 * recorded on the issue, not re-litigated here.
 *
 * ## Scope, and why the policy is a route-level chain
 *
 * A project API key reaches exactly its own project, so this file's handlers
 * are the single-project slice: they read the project off the credential, the
 * same way every other API-key read path does.
 *
 * The policy is {@link apiKeyPermission} with `analytics:view` — a real
 * route-level chain, which authenticates the credential and applies the
 * API-key ceiling before any of this file's code runs. See {@link queryAccess}
 * for why the handler-managed form that stood here first was a mistake.
 *
 * @see ~/server/analytics/lwql — the service and everything under it
 * @see specs/analytics/lwql-api.feature
 * @see https://github.com/langwatch/langwatch/issues/7565#issuecomment-5424087900
 */

import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { describeRoute, resolver } from "hono-openapi";

import {
  getLangWatchQLService,
  LWQL_CLEAN_DIAGNOSTICS_MEANING,
} from "~/server/analytics/lwql";
import { apiKeyPermission, type createProjectApp } from "~/server/api/security";
import { getProtectionsForProject } from "~/server/api/utils";
import { validator as zValidator } from "~/server/api/validation";
import { prisma } from "~/server/db";
import {
  canonicalBaseResponses,
  canonicalUnprocessableResponses,
} from "../../shared/base-responses";
import { lwqlQuerySchema, lwqlResultSchema, lwqlSchemaSchema } from "./schemas";

const logger = createLogger("langwatch:api:query");

const QUERY_TAGS = ["Query"];

/**
 * The permission this family enforces for itself.
 *
 * Named once and shared by both routes so the policy and the audits cannot
 * drift apart, and so the fan-out variant has a single place to read it from.
 */
const QUERY_PERMISSION = "analytics:view" as const;

/**
 * The gate: `analytics:view` through the API-key ceiling.
 *
 * `apiKeyPermission` rather than `requires`, because this is a public
 * API-key surface — the ceiling is what makes a scoped key answer
 * `effective = ApiKey ∩ user` instead of inheriting the whole of its owner's
 * access.
 *
 * This was briefly `handlerManagedAuth`, on the theory that the family would
 * grow a cross-project fan-out and that a route-level gate would resolve at
 * the wrong scope. That reasoning was wrong twice over. `handlerManagedAuth`
 * applies NO middleware — it is a declaration that the HANDLER authenticates,
 * a contract these handlers never honoured, so the door stood open and every
 * anonymous call died on `project.id` of `undefined` as a 500 rather than a
 * 401. And the scope worry does not apply here: these routes are mounted on a
 * project app, where the permission resolves against the project the
 * credential names. The fan-out, when it lands, is a different app on a
 * different mount, and it can choose its own gate then.
 *
 * The rule this leaves behind: reach for `handlerManagedAuth` only when the
 * credential genuinely cannot be expressed as a policy chain — the way the
 * dataset family's signed upload sessions cannot. A plain API key can.
 */
function queryAccess() {
  return apiKeyPermission(QUERY_PERMISSION);
}

/** The project the credential resolved to, plus its redaction protections. */
async function callerContext(c: Context) {
  const project = c.get("project");
  return {
    project,
    protections: await getProtectionsForProject(prisma, {
      projectId: project.id,
    }),
  };
}

const RUN_DESCRIPTION =
  "Executes one read-only LangWatchQL SELECT over the analytics datasets and returns typed columns, rows, execution statistics, truncation state and diagnostics. The query runs as a restricted database identity scoped to the authenticated project.\n\n" +
  `Diagnostics are advisory and never reject a query. ${LWQL_CLEAN_DIAGNOSTICS_MEANING}\n\n` +
  "The project is taken from the credential — no project id appears anywhere in the path or the body, and none can be sent to select another one.\n\n" +
  "Failures answer with their real HTTP status (a refused query is 403, not 200) and this API's canonical error envelope — the same `code` and `meta` every other REST family publishes.";

const SCHEMA_DESCRIPTION =
  "Lists the LangWatchQL analytics datasets this key may query, with each column's type, description, the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join keys, partition-pruning time column, freshness and a runnable example query.\n\n" +
  "Scoped to the credential's own project and its permissions: a column this key cannot read is listed with `available: false` rather than hidden, so a caller can see what a wider key would unlock.";

/**
 * `POST /api/v1/query` — execute one statement.
 *
 * The body IS the query. Validation is `zValidator`, so a malformed one is
 * refused by the shared validator with the canonical `validation_error` and
 * its per-field `reasons` chain, exactly as on every other family — this
 * route neither builds nor classifies that failure itself.
 */
function registerRun(secured: ReturnType<typeof createProjectApp>): void {
  secured.access(queryAccess()).post(
    "/",
    describeRoute({
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
          content: {
            "application/json": { schema: resolver(lwqlResultSchema) },
          },
        },
      },
    }),
    zValidator("json", lwqlQuerySchema),
    async (c) => {
      const { project, protections } = await callerContext(c);
      const { sql, parameters, timeWindow, granularitySeconds } =
        c.req.valid("json");

      logger.info(
        { projectId: project.id, sqlLength: sql.length },
        "Running LangWatchQL query",
      );

      const result = await getLangWatchQLService().execute({
        project,
        protections,
        sql,
        ...(parameters ? { parameters } : {}),
        ...(timeWindow ? { timeWindow } : {}),
        ...(granularitySeconds === undefined ? {} : { granularitySeconds }),
      });
      return c.json(result);
    },
  );
}

/**
 * `GET /api/v1/query/schema` — describe what may be queried.
 *
 * A GET, because it reads a catalog and takes no arguments: the credential is
 * the whole of its input.
 */
function registerSchema(secured: ReturnType<typeof createProjectApp>): void {
  secured.access(queryAccess()).get(
    "/schema",
    describeRoute({
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
    async (c) => {
      const { protections } = await callerContext(c);
      return c.json(
        await getLangWatchQLService().describeSchema({ protections }),
      );
    },
  );
}

/** Registers the query-domain routes. */
export function registerQueryRoutes(
  secured: ReturnType<typeof createProjectApp>,
): void {
  registerRun(secured);
  registerSchema(secured);
}
