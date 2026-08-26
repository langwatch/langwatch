/**
 * Request and response schemas for the query domain.
 *
 * Two layers live here, and the split is the point:
 *
 *  - **The JSON-RPC envelope** ({@link queryRpcRequestSchema}) — the shape of
 *    the door itself, shared by every method.
 *  - **The per-method payloads** ({@link lwqlQuerySchema} and the result
 *    schemas) — what one method's `params` and `result` mean.
 *
 * The payload schemas were lifted verbatim from the routes this door
 * superseded (`api/analytics-sql/[[...route]]/app.v1.ts`, removed by issue
 * #7565), and deliberately so: this module is what a consumer migrating from
 * the old REST endpoints should find unchanged in shape, so the comments came
 * with them — each one records a contract decision rather than describing the
 * code.
 *
 * @see ~/server/analytics/lwql — the service that owns the runtime types
 * @see https://github.com/langwatch/langwatch/issues/7565#issuecomment-5424087900
 */

import { z } from "zod";
import {
  LWQL_COLUMN_UNITS,
  LWQL_DIAGNOSTIC_CODES,
  MAX_LWQL_LENGTH,
} from "~/server/analytics/lwql";
import {
  lwqlGranularityStepSchema,
  lwqlTimeWindowSchema,
} from "~/server/analytics/lwql/timeWindowSchema";

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

export const lwqlQuerySchema = z.object({
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
  /**
   * The datapoint step for a statement that declares
   * `{period_granularity_seconds:UInt32}`, in seconds — the REST twin of the
   * workbench's step control, so a statement's bucketing means the same thing
   * at both doors. Restricted to the steps the surface actually offers
   * ({@link lwqlGranularityStepSchema}) rather than any positive integer, so
   * an off-list value is a clean schema rejection instead of reaching the
   * service's backstop. The bucket-budget refusal is still the service's.
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
  // Whether the statement DECLARED the reserved time-window parameters and was
  // therefore given the surface's window. It is not a claim about the rows: the
  // author writes the comparison, so a statement that declares the names and
  // never compares against them reports `true` and still reads all of time.
  // What a consumer can say from it is that this result was offered the period
  // beside it, not that the period bounded it.
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

/**
 * The methods this door dispatches on.
 *
 * Namespaced (`query.run`, not `run`) because the namespace is what makes the
 * envelope readable in a log line or a client that multiplexes more than one
 * domain — the URL is not carried alongside the method there.
 *
 * Declared as a const tuple so the enum, the dispatch table and the published
 * document cannot drift: adding a method here is a type error everywhere it
 * has not been handled.
 */
export const QUERY_RPC_METHODS = ["query.run", "query.schema"] as const;
export type QueryRpcMethod = (typeof QUERY_RPC_METHODS)[number];

/**
 * A JSON-RPC request id.
 *
 * String or number per JSON-RPC 2.0. `null` is accepted on the way in because
 * the spec uses it for a notification, and echoing back what arrived is kinder
 * than refusing a document that is technically well formed — but this door
 * answers every request, so a notification is served like any other call.
 */
const rpcIdSchema = z.union([z.string(), z.number(), z.null()]);

/**
 * The envelope.
 *
 * `params` is deliberately `unknown` here rather than a discriminated union on
 * `method`. Two reasons, and they are the whole shape of the error contract:
 *
 *  1. A discriminated union reports a bad `params` as a failure of the WHOLE
 *     envelope, so an unknown method and a malformed `sql` arrive as the same
 *     class of complaint. Validating `params` per method, after dispatch, is
 *     what lets `method not found` (-32601) and `invalid params` (-32602) stay
 *     distinct — which is the one thing a JSON-RPC client branches on.
 *  2. It keeps the published document honest: one door, one envelope, and each
 *     method's payload described where that method is described.
 */
export const queryRpcRequestSchema = z.object({
  // Pinned to the one version this door speaks. A document declaring another
  // version is a different protocol, and answering it as though it were this
  // one is how a client learns the wrong contract.
  jsonrpc: z.literal("2.0"),
  id: rpcIdSchema.optional(),
  method: z.enum(QUERY_RPC_METHODS),
  // Absent `params` is legal and means "no arguments" — `query.schema` takes
  // none, and requiring `params: {}` there would be ceremony with no meaning.
  params: z.unknown().optional(),
});

export type QueryRpcRequest = z.infer<typeof queryRpcRequestSchema>;

/**
 * The success envelope, for the published document.
 *
 * `result` is the method's own payload — `lwqlResultSchema` for `query.run`,
 * `lwqlSchemaSchema` for `query.schema` — so it is described here as the union
 * a caller may receive, and precisely per method in each method's docs.
 */
export const queryRpcSuccessSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: rpcIdSchema.optional(),
  result: z.unknown(),
});

/**
 * The error envelope.
 *
 * `data` carries the canonical API error body this app already publishes
 * everywhere else, unchanged. That is the deliberate part: an RPC failure and
 * a REST failure describe themselves with ONE vocabulary — same `code`, same
 * `meta`, same `reasons` chain — so an agent or CLI that already reads this
 * app's errors needs no second parser for this door.
 */
export const queryRpcErrorSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: rpcIdSchema.optional(),
  error: z.object({
    // The JSON-RPC code: the protocol-level class of the failure.
    code: z.number(),
    message: z.string(),
    // The canonical envelope — the application-level detail.
    data: z.unknown().optional(),
  }),
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
