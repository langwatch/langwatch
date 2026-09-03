/**
 * The wire shapes of the query domain: what a caller sends, and what the two
 * doors answer with.
 *
 * A file of their own because the request schema is what `zValidator` refuses
 * a malformed body against, and the two response schemas exist for the
 * published OpenAPI document — the service owns the types, these describe them
 * to a consumer reading the spec, and stay loose where the payload genuinely
 * is (a result row's columns are the caller's).
 *
 * @see ./query.api.ts — the routes these describe
 */

import { z } from "zod";

import { LWQL_COLUMN_UNITS } from "../../langwatch-ql/catalog/types";
import { LWQL_DIAGNOSTIC_CODES } from "../../langwatch-ql/diagnostics";
import { MAX_LWQL_LENGTH } from "../../langwatch-ql/sql-text";
import {
  lwqlGranularityStepSchema,
  lwqlTimeWindowSchema,
} from "../../langwatch-ql/time-window-schema";

/**
 * A bound parameter's value.
 *
 * Scalars only: a parameter is a *value*, and anything structured would be a
 * value whose shape the declared ClickHouse type cannot describe.
 */
const parameterValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

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
