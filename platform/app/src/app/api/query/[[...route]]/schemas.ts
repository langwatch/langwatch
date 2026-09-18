/**
 * Request and response schemas for the query domain.
 *
 * One request payload — what `POST /api/v1/query` accepts
 * ({@link lwqlQuerySchema}) — and one response payload per route
 * ({@link lwqlResultSchema}, {@link lwqlSchemaSchema},
 * {@link queryReferenceSchema}).
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
  LWQL_APP_FUNCTION_ENCODINGS,
  LWQL_APP_FUNCTION_KEY_KINDS,
  LWQL_COLUMN_UNITS,
  LWQL_DIAGNOSTIC_CODES,
  MAX_LWQL_LENGTH,
} from "~/server/analytics/lwql";
import {
  lwqlGranularityStepSchema,
  lwqlTimeWindowSchema,
} from "~/server/analytics/lwql/timeWindowSchema";
import { QUERY_EXAMPLE_INTENTS } from "~/server/app-layer/traces/query-language/examples";

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
   * reserved `dashboard_context_period_start` / `dashboard_context_period_end`
   * parameters the statement declares — which is also why sending either of
   * those under `parameters` is refused.
   */
  timeWindow: lwqlTimeWindowSchema.optional(),
  /**
   * The datapoint step for a statement that declares
   * `{dashboard_context_granularity_seconds:UInt32}`, in seconds — the REST twin of the
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

export const lwqlSchemaSchema = z.object({
  database: z.string(),
  views: z.array(
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
  // The function names a query may call, equal to the validator's allowlist.
  // Permission-independent, so it is the same for every caller.
  functions: z.array(z.string()),
  // The app functions a projection may call. A section of its own rather than
  // columns on a view: a function reads a trace or conversation id from
  // wherever the caller found one, so it belongs to no single view. Separate
  // from `functions` above because these are resolved by the application after
  // the query, and each carries its own gates, cap and encoding.
  appFunctions: z.array(
    z.object({
      name: z.string(),
      signature: z.string(),
      description: z.string(),
      // The ClickHouse type of the HYDRATED column, which is not the type the
      // key had — the application re-declares it after computing the value.
      returns: z.string(),
      // How to read the returned string: `json` for a payload to parse back,
      // `text` for prose. Enumerated so a consumer is not left guessing from
      // the description whether a column holds JSON.
      encoding: z.enum(LWQL_APP_FUNCTION_ENCODINGS),
      keyKind: z.enum(LWQL_APP_FUNCTION_KEY_KINDS),
      // How many distinct keys of that kind one run may read. Exceeding it is a
      // 422 naming this number, never a partial answer. A whole number above
      // zero, so a consumer can size a page against it without guarding for a
      // fraction or a negative.
      cap: z.number().int().positive(),
      gates: z.array(z.enum(["input", "output", "costs"])),
      available: z.boolean(),
      exampleSql: z.string(),
    }),
  ),
});

const queryReferenceEndpointSchema = z.object({
  method: z.enum(["GET", "POST"]),
  path: z.string(),
  description: z.string(),
});

/**
 * The query reference, as the OpenAPI document describes it.
 *
 * Loose where the payload is a projection of something already published
 * elsewhere in this file — the LangWatchQL schema — and exact where the
 * consumer branches on it: the example's `language`, `intent` and `available`
 * are what an agent picks a query with, and a spec that would not enumerate
 * them makes it guess from prose.
 */
export const queryReferenceSchema = z.object({
  version: z.string(),
  lwql: z.object({
    enabled: z.boolean(),
    schema: lwqlSchemaSchema,
    limits: z.object({
      maxStatementLength: z.number(),
      maxRowsReturned: z.number(),
      maxResultBytes: z.number(),
      maxExecutionTimeSeconds: z.number(),
      pagination: z.string(),
    }),
    endpoints: z.array(queryReferenceEndpointSchema),
  }),
  traceFilter: z.object({
    syntax: z.string(),
    fields: z.array(
      z.object({
        name: z.string(),
        label: z.string(),
        valueType: z.enum(["categorical", "range", "text", "existence"]),
        // Nullable rather than optional, for the same reason the schema's
        // `unit` is: every field answers the grouping question, and `null` is
        // the answer for one the product has not placed in a group yet.
        group: z.string().nullable(),
        facetable: z.boolean(),
        knownValues: z.array(z.string()),
      }),
    ),
    dynamicPrefixes: z.array(
      z.object({
        prefix: z.string(),
        label: z.string(),
        description: z.string(),
        aliases: z.array(z.string()),
      }),
    ),
    endpoints: z.array(queryReferenceEndpointSchema),
  }),
  examples: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      intent: z.enum(QUERY_EXAMPLE_INTENTS),
      language: z.enum(["lwql", "trace-filter"]),
      tags: z.array(z.string()),
      text: z.string(),
      parameters: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          description: z.string(),
        }),
      ),
      requires: z.object({
        gates: z.array(z.enum(["input", "output", "costs"])),
        functions: z.array(z.string()),
      }),
      available: z.boolean(),
      notes: z.string().optional(),
    }),
  ),
  decisionTable: z.array(
    z.object({ when: z.string(), use: z.string(), why: z.string() }),
  ),
});
