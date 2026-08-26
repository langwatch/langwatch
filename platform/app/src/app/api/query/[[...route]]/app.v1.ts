/**
 * The query domain — LangWatchQL over JSON-RPC, on its own family.
 *
 * One door:
 *
 *  - `POST /api/v1/query` — methods `query.run` and `query.schema`
 *
 * This supersedes `/api/v1/projects/{projectId}/analytics/query/clickhouse`
 * and its sibling `.../analytics/schema` (issue #7565). Three things move:
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
 * ## Why JSON-RPC, and why one path
 *
 * The surface is a *verb* — "run this statement", "describe what I may query"
 * — not a collection of addressable resources. REST modelled that as a POST to
 * a noun-less path plus a `GET /schema` hanging off it, which is REST's shape
 * borrowed for something that is not resource-oriented. Naming the two calls
 * as methods on one envelope says what they are, and gives the family a place
 * to grow (`query.explain`, `query.cancel`) without minting a path per verb.
 *
 * The version leads: `/api/v1/query`. Issue #7565 originally specified
 * `/api/query/v1` with a deliberate "do not correct this" note, and that
 * decision was reversed on purpose — the reversal and its reasoning are
 * recorded on the issue, not re-litigated here.
 *
 * ## Scope, and why the policy is handler-managed
 *
 * A project API key reaches exactly its own project, so this file's handler is
 * the single-project slice: it reads the project off the credential, the same
 * way every other API-key read path does.
 *
 * The policy is {@link apiKeyPermission} with `analytics:view` — a real
 * route-level chain, which authenticates the credential and applies the
 * API-key ceiling before any of this file's code runs. See {@link queryAccess}
 * for why the handler-managed form that stood here first was a mistake.
 *
 * Because the gate is middleware, an unauthenticated caller is refused before
 * dispatch and learns nothing about which methods exist: a known method and a
 * nonsense one answer identically, so the method name is not a probe for a
 * key's validity.
 *
 * @see ~/server/analytics/lwql — the service and everything under it
 * @see ./rpc — the protocol layer: codes, ids, envelopes
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
import {
  type createProjectApp,
  apiKeyPermission,
} from "~/server/api/security";
import { getProtectionsForProject } from "~/server/api/utils";
import {
  RequestValidationError,
  validator as zValidator,
} from "~/server/api/validation";
import { prisma } from "~/server/db";
import {
  canonicalBaseResponses,
  canonicalUnprocessableResponses,
} from "../../shared/base-responses";
import {
  methodNotFound,
  type QueryRpcVariables,
  recordRpcId,
  rpcResultBody,
} from "./rpc";
import {
  lwqlQuerySchema,
  lwqlResultSchema,
  lwqlSchemaSchema,
  type QueryRpcMethod,
  queryRpcErrorSchema,
  queryRpcRequestSchema,
  queryRpcSuccessSchema,
} from "./schemas";

const logger = createLogger("langwatch:api:query");

const QUERY_TAGS = ["Query"];

/**
 * The permission this family enforces for itself.
 *
 * Named once and shared by every method so the policy and the audits cannot
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
 * a contract this handler never honoured, so the door stood open and every
 * anonymous call died on `project.id` of `undefined` as a 500 rather than a
 * 401. And the scope worry does not apply here: this route is mounted on a
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

/**
 * `query.run` — execute one statement.
 *
 * `params` is validated here rather than in the envelope schema so a bad `sql`
 * reports as `invalid params` against a known method, not as a malformed
 * request. The violations are handed to the shared `RequestValidationError`,
 * which is exported for exactly this: a check the route's own schema could not
 * express.
 */
async function runQuery(c: Context, params: unknown): Promise<unknown> {
  const parsed = lwqlQuerySchema.safeParse(params);
  if (!parsed.success) {
    throw new RequestValidationError({
      target: "json",
      violations: parsed.error.issues.map((issue) => ({
        // Reported under `params`, because that is where the caller wrote it.
        field:
          issue.path.length > 0
            ? `params.${issue.path.join(".")}`
            : "params",
        type: issue.code,
        message: issue.message,
      })),
    });
  }

  const { project, protections } = await callerContext(c);
  const { sql, parameters, timeWindow, granularitySeconds } = parsed.data;

  logger.info(
    { projectId: project.id, sqlLength: sql.length, method: "query.run" },
    "Running LangWatchQL query",
  );

  return await getLangWatchQLService().execute({
    project,
    protections,
    sql,
    ...(parameters ? { parameters } : {}),
    ...(timeWindow ? { timeWindow } : {}),
    ...(granularitySeconds === undefined ? {} : { granularitySeconds }),
  });
}

/**
 * `query.schema` — describe what may be queried.
 *
 * Takes no params. A caller that sends some is not corrected: extra arguments
 * to a no-argument method are harmless, and refusing them would break a client
 * that sends `params: {}` for uniformity.
 */
async function describeSchema(c: Context): Promise<unknown> {
  const { protections } = await callerContext(c);
  return getLangWatchQLService().describeSchema({ protections });
}

/**
 * The dispatch table.
 *
 * Keyed by the method enum, so a method added to `QUERY_RPC_METHODS` without a
 * handler here is a compile-time error rather than a runtime 404.
 */
const METHODS: Record<
  QueryRpcMethod,
  (c: Context, params: unknown) => Promise<unknown>
> = {
  "query.run": runQuery,
  "query.schema": (c) => describeSchema(c),
};

/**
 * The statuses whose body is the JSON-RPC error envelope rather than the bare
 * canonical one.
 *
 * Every failure this door answers is wrapped — the family's `onError` wraps
 * unconditionally — but only these are re-described here. 401 and 403 are
 * raised by middleware that answers BELOW the family handler and 500 is the
 * generic fallback; re-describing those would claim a wrapping this file
 * cannot guarantee, and an over-promise in the document is worse than the
 * shared entry it replaced.
 */
const RPC_WRAPPED_STATUSES = [400, 422] as const;

const RPC_ERROR_DESCRIPTIONS: Record<(typeof RPC_WRAPPED_STATUSES)[number], string> =
  {
    400:
      "The request was refused before the method ran: the JSON-RPC envelope was malformed, named a method this endpoint does not serve, or carried `params` that did not match the method. " +
      "`error.code` is the JSON-RPC code (-32700, -32600, -32601 or -32602) and `error.data` is this API's canonical error envelope.",
    422:
      "The method ran and refused on a deliberate ceiling — a well-formed query whose scan volume is not allowed. " +
      "`error.data` carries the canonical envelope, whose `code` names which ceiling.",
  };

const RPC_DESCRIPTION =
  "A JSON-RPC 2.0 endpoint for LangWatchQL. Send `{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": ..., \"params\": ... }`.\n\n" +
  "**`query.run`** — executes one read-only LangWatchQL SELECT over the analytics datasets and returns typed columns, rows, execution statistics, truncation state and diagnostics. The query runs as a restricted database identity scoped to the authenticated project. " +
  `Diagnostics are advisory and never reject a query. ${LWQL_CLEAN_DIAGNOSTICS_MEANING}\n\n` +
  "**`query.schema`** — lists the LangWatchQL analytics datasets this key may query, with each column's type, description, the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join keys, partition-pruning time column, freshness and a runnable example query. Takes no `params`.\n\n" +
  "Failures answer with their real HTTP status (a refused query is 403, not 200) and a JSON-RPC `error` whose `data` is this API's canonical error envelope — the same `code` and `meta` the REST families publish.\n\n" +
  "One exception worth coding for: **authentication and authorization failures (401, 403) answer with the canonical error envelope alone, not wrapped in a JSON-RPC `error`.** They are raised before the request reaches this endpoint's own handler. Branch on the HTTP status first, and only then read `error.code` — a client that assumes every failure carries a JSON-RPC envelope will misread a refused credential.";

/**
 * Registers the query-domain door.
 *
 * One route, because one path is the whole point of the transport. The methods
 * are documented in the description above rather than as separate operations:
 * a JSON-RPC method is not an HTTP operation, and inventing one path per method
 * in the document to make it look like REST would misdescribe the surface a
 * client actually calls.
 */
export function registerQueryRoutes(
  secured: ReturnType<typeof createProjectApp<QueryRpcVariables>>,
): void {
  secured.access(queryAccess()).post(
    "/",
    describeRoute({
      summary: "Call a LangWatchQL method (JSON-RPC 2.0)",
      description: RPC_DESCRIPTION,
      tags: QUERY_TAGS,
      responses: {
        ...canonicalBaseResponses,
        // A scan-ceiling refusal: the statement is well formed, the volume it
        // would read is not allowed. QueryScanLimitExceededError carries 422.
        ...canonicalUnprocessableResponses,
        // Overridden, because the shared entries describe the canonical body
        // alone and on this family that body is NESTED — it arrives as
        // `error.data` inside the JSON-RPC envelope. Publishing the inner
        // shape as though it were the whole response would generate a client
        // that reads `code` off the wrong level and finds nothing. Only the
        // statuses a caller reaches by getting the envelope or the params
        // wrong are re-described; the rest keep the shared entries.
        ...Object.fromEntries(
          RPC_WRAPPED_STATUSES.map((status) => [
            status,
            {
              description: RPC_ERROR_DESCRIPTIONS[status],
              content: {
                "application/json": { schema: resolver(queryRpcErrorSchema) },
              },
            },
          ]),
        ),
        200: {
          description:
            "The method ran. `result` is the payload for the method called: " +
            "a query result for `query.run`, the queryable schema for " +
            "`query.schema` — both scoped to the caller's project.",
          content: {
            "application/json": {
              // The ENVELOPE, not the bare payload. `result` is what a caller
              // wants, but it arrives nested under `jsonrpc`/`id`, and
              // publishing the payload alone would generate a client that
              // reads `columns` off the top level and finds nothing — the same
              // level error the 400/422 override above exists to avoid.
              schema: resolver(
                queryRpcSuccessSchema.extend({
                  result: lwqlResultSchema.or(lwqlSchemaSchema),
                }),
              ),
            },
          },
        },
        // Deliberately no 404 for an unknown method. The envelope enumerates
        // the methods, so a name this door does not serve is refused as an
        // invalid request (JSON-RPC -32601's usual 404 does not apply) — and
        // documenting a status the surface does not answer teaches an
        // integrator to branch on something that will never arrive.
      },
    }),
    // Ahead of the validator on purpose: the failures that most need an id to
    // be matched back to a call are the ones the validator rejects, and a
    // handler runs too late to have recorded it. See `recordRpcId`.
    recordRpcId,
    zValidator("json", queryRpcRequestSchema),
    async (c) => {
      const { id, method, params } = c.req.valid("json");

      const handler = METHODS[method];
      // Unreachable while the envelope schema enumerates the methods, but the
      // schema and the table are two declarations and this is what keeps their
      // disagreement an honest 404 rather than a crash.
      if (!handler) throw methodNotFound(method);

      const result = await handler(c, params);
      return c.json(rpcResultBody({ id, result }));
    },
  );
}
