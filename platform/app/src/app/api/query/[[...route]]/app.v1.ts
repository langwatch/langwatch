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
 * @see specs/lwql/api.feature
 * @see https://github.com/langwatch/langwatch/issues/7565#issuecomment-5424087900
 */

import { createLogger } from "@langwatch/observability";
import type { Context, MiddlewareHandler } from "hono";
import { describeRoute, resolver } from "hono-openapi";

import { appFromContext } from "~/app/api/middleware/app-context";
import {
  DEFAULT_LWQL_RESULT_LIMITS,
  getLangWatchQLService,
  LWQL_CLEAN_DIAGNOSTICS_MEANING,
} from "~/server/analytics/lwql";
import {
  type createProjectApp,
  handlerManagedAuth,
} from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import {
  createUnifiedKeyAuthMiddleware,
  type KeyAuthVariables,
} from "~/server/api-key/auth-middleware";
import { prisma } from "~/server/db";
import {
  canonicalBaseResponses,
  canonicalUnprocessableResponses,
} from "../../shared/base-responses";
import { resolveLwqlQueryScope } from "./queryScope";
import { lwqlQuerySchema, lwqlResultSchema, lwqlSchemaSchema } from "./schemas";

const logger = createLogger("langwatch:api:query");

const QUERY_TAGS = ["Query"];

/**
 * The permission this family enforces for itself, per project.
 *
 * Named once so the handler-managed policy declaration and the fan-out that
 * enforces it cannot drift. The door does not gate on it at the route level:
 * it resolves the SET of projects the key holds it on and reads the union,
 * so a key that holds it nowhere is a valid empty scope, not a refusal.
 */
const QUERY_PERMISSION = "analytics:view" as const;

/**
 * The gate: authenticate any API key, then fan out to what it can read.
 *
 * `handlerManagedAuth`, because the credential genuinely cannot be expressed
 * as a policy chain (#8085). `apiKeyPermission` would demand a single project
 * — an organization key with no `X-Project-Id` would fail to resolve one — and
 * would 403 a key without the permission on THAT project, whereas this door
 * fans the key out across every project it can read and reads zero rows for
 * one it cannot. The auth middleware {@link registerQueryRoutes} prepends
 * ({@link createUnifiedKeyAuthMiddleware}) authenticates any key without
 * demanding a project; the tenant boundary is the row policy, not this gate.
 */
const queryAuth: MiddlewareHandler = createUnifiedKeyAuthMiddleware({
  prisma,
  errorEnvelope: "canonical",
});

/** The declared policy: the handler authenticates, and enforces analytics:view per project. */
function queryAccess() {
  return handlerManagedAuth({
    reason:
      "Any API key reaches the projects it holds analytics:view on; the fan-out and the row policy enforce the scope, not a single-project route gate (#8085).",
    permissions: [QUERY_PERMISSION],
    credential: "apiKey",
  });
}

/** The projects the credential may read, plus the strictest redaction protections across them. */
async function callerContext(c: Context) {
  return resolveLwqlQueryScope({
    principal: c.get("keyPrincipal"),
    permissions: appFromContext(c).permissions,
  });
}

/**
 * How a caller reaches the projects it queries.
 *
 * Shared by both doors so the two cannot describe the rule differently. Any
 * LangWatch API key reaches every project it can read `analytics:view` on — an
 * organization or personal key spans its projects, a project key its one. No
 * project header is required. To read one project, filter inside the
 * statement with `WHERE TenantId = '<project id>'`.
 */
const HEADER_RULE =
  "Any LangWatch API key — project, organization or personal — reaches every project it can read `analytics:view` on: an organization or personal key spans its projects, a project key its one. Rows from more than one project come back flagged with the `MULTI_PROJECT_RESULT` diagnostic — to read a single project, filter inside the statement with `WHERE TenantId = '<project id>'`.";

/**
 * The response ceilings, read off the executor's own limits so this copy and
 * the enforced caps cannot drift. Formatted with thousands separators for a
 * reader.
 */
const RESULT_CEILINGS = `A statement that names no \`LIMIT\` is capped at ${DEFAULT_LWQL_RESULT_LIMITS.maxRows.toLocaleString("en-US")} rows: that \`LIMIT\` is appended before the query runs. A statement whose own \`LIMIT\` asks for more is refused with \`LIMIT_TOO_HIGH\` — lower it and page the rest with \`LIMIT\`/\`OFFSET\` and an \`ORDER BY\`. When using \`UNION\`, every top-level branch must carry its own \`LIMIT\` clause of ${DEFAULT_LWQL_RESULT_LIMITS.maxRows.toLocaleString("en-US")} rows or fewer, or the query is refused with \`LIMIT_REQUIRED_PER_BRANCH\`. A result whose body exceeds about ${DEFAULT_LWQL_RESULT_LIMITS.maxResultBytes.toLocaleString("en-US")} bytes is refused outright with \`lwql_result_too_large\`, never cut — select fewer columns or a smaller \`LIMIT\`.`;

const RUN_DESCRIPTION =
  "Executes one read-only LangWatchQL SELECT over the analytics views and returns typed columns, rows, execution statistics and diagnostics. The query runs as a restricted database identity scoped to the projects this key can read.\n\n" +
  `Diagnostics are advisory and never reject a query. ${LWQL_CLEAN_DIAGNOSTICS_MEANING}\n\n` +
  "A projection may call the app functions the schema endpoint lists (`conversation`, `llm_readable_trace`, `llm_messages`, and so on). Those are computed by the application after the query, so they are allowed only as aliased entries in the top-level SELECT list; a call in WHERE, GROUP BY, ORDER BY, a join, a subquery or a nested expression is refused, and a UNION disqualifies both of its branches even where each reads as a top-level projection. A projection may also call the eval functions, which judge a text with a model and are charged for; their key is the text itself. A run that would need more distinct conversations, traces, spans or texts than the published cap answers 422 rather than a partial result, and a run whose texts would exceed the per-query token budget answers 422 before anything is sent.\n\n" +
  `${HEADER_RULE}\n\n` +
  `${RESULT_CEILINGS}\n\n` +
  "Failures answer with their real HTTP status (a refused query is 403, not 200) and this API's canonical error envelope — the same `code` and `meta` every other REST family publishes.";

const SCHEMA_DESCRIPTION =
  "Lists the LangWatchQL analytics views this key may query, with each column's type, description, the permissions that unlock it, and whether this caller holds them — plus each view's grain, join keys, partition-pruning time column, freshness and a runnable example query. It also lists, under `functions`, every function name a query may call.\n\n" +
  "Under `appFunctions` it lists the app functions a projection may call, each with its signature, the type and encoding of the value it returns, how many distinct keys one run may read, and the permissions it needs.\n\n" +
  "Scoped to the projects the credential can read and their permissions: a column or app function this key cannot read in every one of them is listed with `available: false` rather than hidden, so a caller can see what a wider key would unlock.\n\n" +
  `${HEADER_RULE}`;

/**
 * `POST /api/v1/query` — execute one statement.
 *
 * The body IS the query. Validation is `zValidator`, so a malformed one is
 * refused by the shared validator with the canonical `validation_error` and
 * its per-field `reasons` chain, exactly as on every other family — this
 * route neither builds nor classifies that failure itself.
 */
function registerRun(secured: QuerySecuredApp): void {
  secured.access(queryAccess()).post(
    "/",
    queryAuth,
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
            "The query ran. Columns, rows, execution statistics and diagnostics, scoped to the projects the key can read.",
          content: {
            "application/json": { schema: resolver(lwqlResultSchema) },
          },
        },
      },
    }),
    zValidator("json", lwqlQuerySchema),
    async (c) => {
      const { projects, protections } = await callerContext(c);
      const { sql, parameters, timeWindow, granularitySeconds } =
        c.req.valid("json");

      logger.info(
        {
          projectIds: projects.map((project) => project.id),
          projectCount: projects.length,
          sqlLength: sql.length,
        },
        "Running LangWatchQL query",
      );

      const result = await getLangWatchQLService().execute({
        // The tenant-capability SET the service resolves: a project key is a
        // set of one, an API key the union of every project it holds
        // `analytics:view` on. An empty set reads zero rows — the row policy,
        // not this door, is the tenant boundary (#8085).
        projects,
        protections,
        sql,
        // The request's own cancellation. It matters for exactly one thing:
        // a statement calling an eval function keeps paying a classifier per
        // row after the client has hung up, and nothing else here does.
        signal: c.req.raw.signal,
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
function registerSchema(secured: QuerySecuredApp): void {
  secured.access(queryAccess()).get(
    "/schema",
    queryAuth,
    describeRoute({
      summary: "Discover the queryable LangWatchQL schema",
      description: SCHEMA_DESCRIPTION,
      tags: QUERY_TAGS,
      responses: {
        ...canonicalBaseResponses,
        200: {
          description:
            "The views and columns this key may query, with the permissions that unlock each one.",
          content: {
            "application/json": { schema: resolver(lwqlSchemaSchema) },
          },
        },
      },
    }),
    async (c) => {
      const { projects, protections } = await callerContext(c);
      return c.json(
        await getLangWatchQLService().describeSchema({
          projectIds: projects.map((project) => project.id),
          protections,
        }),
      );
    },
  );
}

/**
 * The query app's context, widened with what the key-auth middleware sets.
 *
 * `createProjectApp` gives the project-auth variables; the query door layers
 * its own {@link createUnifiedKeyAuthMiddleware}, which sets `keyPrincipal`, so
 * the handlers can read it off context with full typing.
 */
type QuerySecuredApp = ReturnType<typeof createProjectApp<KeyAuthVariables>>;

/** Registers the query-domain routes. */
export function registerQueryRoutes(secured: QuerySecuredApp): void {
  registerRun(secured);
  registerSchema(secured);
}
