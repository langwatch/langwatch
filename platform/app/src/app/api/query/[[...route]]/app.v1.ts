/**
 * The query domain — LangWatchQL over REST, on its own family.
 *
 * Three doors:
 *
 *  - `POST /api/v1/query` — run one statement
 *  - `GET  /api/v1/query/schema` — describe what may be queried
 *  - `GET  /api/v1/query/reference` — describe both query languages, with
 *    worked examples and which one answers which kind of question
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

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { appFromContext } from "~/app/api/middleware/app-context";
import {
  getLangWatchQLService,
  LWQL_CLEAN_DIAGNOSTICS_MEANING,
} from "~/server/analytics/lwql";
import { lwqlEnabled } from "~/server/analytics/lwql/access";
import { describeQueryReference } from "~/server/analytics/query-reference";
import {
  anyAuthenticated,
  apiKeyPermission,
  type createProjectApp,
} from "~/server/api/security";
import { getProtectionsForProject } from "~/server/api/utils";
import { validator as zValidator } from "~/server/api/validation";
import { enforceApiKeyCeiling } from "~/server/api-key/auth-middleware";
import type { ResolvedToken } from "~/server/api-key/token-resolver";
import { prisma } from "~/server/db";
import {
  canonicalBaseResponses,
  canonicalUnprocessableResponses,
} from "../../shared/base-responses";
import {
  lwqlQuerySchema,
  lwqlResultSchema,
  lwqlSchemaSchema,
  queryReferenceSchema,
} from "./schemas";

const logger = createLogger("langwatch:api:query");

const QUERY_TAGS = ["Query"];

/**
 * The permission this family enforces for itself.
 *
 * Named once and shared by every route here so the policy and the audits
 * cannot drift apart, and so the fan-out variant has a single place to read it
 * from.
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

/**
 * What a cache may do with a document shaped by the caller's own permissions.
 *
 * Both discovery doors answer differently per credential: `available`, the
 * columns in the schema, and whether the LangWatchQL half is open at all. A
 * cache keyed on the URL, or on the project, would replay one key's document
 * to another, so the answer says not to store it rather than trusting every
 * proxy between here and the caller to key on the credential.
 */
const CREDENTIAL_SHAPED = "private, no-store";

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

const REFERENCE_DESCRIPTION =
  "Describes both query languages in one payload: LangWatchQL (SQL over the analytics datasets) with its schema, limits and endpoints, and the trace filter (a Lucene-flavored string over the trace list) with its syntax, its fields and their static value vocabularies, and the open-ended attribute namespaces.\n\n" +
  "It also carries worked examples in both languages and a table saying which language answers which kind of question. Every example is checked against the real validator and the real translator before it ships, so a published example parses and compiles; whether THIS key can run one is its own `available` flag.\n\n" +
  "Pure: it reads the catalogs and this key's own permissions, never the project's traces, so it answers from memory. It is cacheable only PER CREDENTIAL — `available`, the embedded schema and the gated columns all differ between keys, so a shared cache must key on the credential and never serve one key's document to another. The values a field actually holds change under you and are a separate call — `GET /api/traces/facets`.\n\n" +
  "An example this key cannot run is listed with `available: false` and keeps its `requires.gates`, so a caller can see which permission it needs.\n\n" +
  "Any credential for the project may read it. The trace filter half is the traces family's vocabulary, so a key scoped to `traces:view` alone is answered rather than refused; for that key the LangWatchQL half arrives with `lwql.enabled: false` and an empty schema. `GET /api/v1/query/schema` is stricter and refuses that key outright, which is why this document withholds the catalog rather than repeating it.";

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
      c.header("Cache-Control", CREDENTIAL_SHAPED);
      return c.json(
        await getLangWatchQLService().describeSchema({ protections }),
      );
    },
  );
}

/**
 * `GET /api/v1/query/reference` — describe both query languages.
 *
 * A sibling of `/schema` rather than a replacement for it: `/schema` is the
 * LangWatchQL catalog and stays exactly what it was, and this is the document a
 * caller reads when it does not yet know WHICH language answers its question.
 * It embeds the same schema, so a caller that wants both pays one round trip.
 *
 * Pure apart from the two facts that depend on the caller — their permissions
 * and whether the project has the LangWatchQL surface — so it answers from
 * memory plus one flag read.
 */
/**
 * Whether this credential could run LangWatchQL here.
 *
 * Asked rather than enforced, because the reference answers either way: the
 * trace filter half is the traces family's vocabulary, and a key scoped to
 * `traces:view` alone would otherwise be refused the only document that
 * describes the language it is entitled to use. The SQL half is withheld from
 * such a key instead: `/schema` refuses it outright, so publishing the catalog
 * here would be that door standing open next to the one that is shut.
 *
 * Runs the real ceiling rather than a second copy of the rule, so a legacy
 * project key keeps passing and a scoped key is checked exactly once.
 */
async function holdsQueryPermission(c: Context): Promise<boolean> {
  const resolved = c.get("resolvedToken") as ResolvedToken | undefined;
  if (!resolved) return false;
  try {
    await enforceApiKeyCeiling({
      resolved,
      permission: QUERY_PERMISSION,
      app: appFromContext(c),
    });
    return true;
  } catch (error) {
    if (HandledError.isHandled(error)) return false;
    throw error;
  }
}

function registerReference(secured: ReturnType<typeof createProjectApp>): void {
  secured.access(anyAuthenticated()).get(
    "/reference",
    describeRoute({
      summary: "Discover both query languages",
      description: REFERENCE_DESCRIPTION,
      tags: QUERY_TAGS,
      responses: {
        ...canonicalBaseResponses,
        200: {
          description:
            "The LangWatchQL schema and limits, the trace filter's syntax and fields, worked examples in both languages, and which language answers which kind of question.",
          content: {
            "application/json": { schema: resolver(queryReferenceSchema) },
          },
        },
      },
    }),
    async (c) => {
      const { project, protections } = await callerContext(c);
      c.header("Cache-Control", CREDENTIAL_SHAPED);
      return c.json(
        describeQueryReference({
          protections,
          lwqlEnabled:
            (await holdsQueryPermission(c)) &&
            (await lwqlEnabled({ prisma, projectId: project.id })),
          database: getLangWatchQLService().database,
        }),
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
  registerReference(secured);
}
