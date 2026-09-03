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
 * API-key ceiling before any of this file's code runs. `handlerManagedAuth`
 * applies NO middleware: it is a declaration that the HANDLER authenticates,
 * and a handler that then reads the project off an unpopulated context leaves
 * the door open and answers 500 where it owed a 401.
 *
 * Unlike the routes it replaces, this family carries NO feature flag. The two
 * it supersedes were gated because they were experimental; this door is the
 * published one.
 *
 * @see ../../langwatch-ql — the service and everything under it
 * @see specs/analytics/lwql-api.feature
 */

import { apiKeyPermission } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  canonicalBaseResponses,
  canonicalUnprocessableResponses,
  type MountableRestApp,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import { describeRoute, resolver } from "hono-openapi";

import { LWQL_CLEAN_DIAGNOSTICS_MEANING } from "../../langwatch-ql/diagnostics";
import type { LangWatchQLRestPorts } from "./langwatch-ql-route-guards";
import { lwqlQuerySchema, lwqlResultSchema, lwqlSchemaSchema } from "./query.schemas";

/** The app every route in this family is registered on. */
type QueryApp = SecuredApp<{ Variables: AppRestProjectVariables }>;

const logger = createLogger("langwatch:api:query");

const QUERY_TAGS = ["Query"];

/**
 * The permission this family enforces for itself.
 *
 * Named once and shared by both routes so the policy and the audits cannot
 * drift apart, and so a future cross-project fan-out has a single place to
 * read it from.
 */
const QUERY_PERMISSION = "analytics:view" as const;

/**
 * The gate: `analytics:view` through the API-key ceiling.
 *
 * `apiKeyPermission` rather than `requires`, because this is a public
 * API-key surface — the ceiling is what makes a scoped key answer
 * `effective = ApiKey ∩ user` instead of inheriting the whole of its owner's
 * access.
 */
function queryAccess() {
  return apiKeyPermission(QUERY_PERMISSION);
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
function registerRun(secured: QueryApp, ports: LangWatchQLRestPorts): void {
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
      const project = c.get("project");
      const { sql, parameters, timeWindow, granularitySeconds } = c.req.valid("json");

      logger.info({ projectId: project.id, sqlLength: sql.length }, "Running LangWatchQL query");

      // The restricted tenant capability is hashed from the project's own
      // LangWatchQL secret, which the request's identity deliberately does not
      // carry. Read it here, and hand the service only the two fields it names.
      const { lwqlKey } = await ports.projects().getById(project.id);

      const result = await ports.langWatchQL().execute({
        project: { id: project.id, lwqlKey },
        protections: await ports.protectionsFor({ projectId: project.id }),
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
function registerSchema(secured: QueryApp, ports: LangWatchQLRestPorts): void {
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
      const project = c.get("project");

      return c.json(
        ports.langWatchQL().describeSchema({
          protections: await ports.protectionsFor({ projectId: project.id }),
        }),
      );
    },
  );
}

/** Registers the query-domain routes. */
export function registerQueryRoutes(secured: QueryApp, ports: LangWatchQLRestPorts): void {
  registerRun(secured, ports);
  registerSchema(secured, ports);
}

/**
 * `/api/v1/query`, bound to one process's graph.
 *
 * Version-first, unlike the families that predate it: a consumer holding a
 * base URL does not learn two rules for where `v1` lives.
 *
 * The canonical envelope, because this is a new family — `legacy` is the flat
 * `{ error }` shape older families published and whose consumers parse it, and
 * nothing consumes this door yet.
 */
export function createQueryRestApp(options: {
  security: AppRestSecurity;
  ports: LangWatchQLRestPorts;
}): MountableRestApp {
  const secured = options.security.createProjectApp({
    basePath: "/api/v1/query",
    errorEnvelope: "canonical",
  });

  registerQueryRoutes(secured, options.ports);

  return secured.hono;
}
