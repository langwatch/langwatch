/**
 * Allowlist + request schema for the read-only trace query surface (SPIKE #5670).
 *
 * SECURITY MODEL — "safety-by-allowlist-totality" (NOT "zero parser surface"):
 * every dimension, metric, and aggregation the caller can name is a CLOSED
 * enum mapped to a developer-authored ClickHouse expression. ClickHouse binds
 * *values* but never *identifiers*, so identifiers must come from a finite
 * allowlist — a hostile string can never become a column/function/table name.
 * The one free-text input (`filter`) is delegated to the already-hardened liqe
 * compiler (`translateFilterToClickHouse`), which parameterizes values,
 * allowlists its own fields, and caps complexity. That parser surface is
 * retained and acknowledged — it is not zero.
 *
 * STRUCTURAL ISOLATION RULE (the one rule the allowlist must never break):
 * the compiler emits exactly one outer `FROM trace_summaries` plus, only via
 * the liqe compiler, tenant-scoped `TraceId IN (SELECT … WHERE TenantId=…)`
 * subqueries. No dictGet, no user-supplied JOIN/HAVING, no table functions,
 * no un-scoped FROM. arrayJoin is permitted only over a scoped row's own array
 * (leakage-safe; a row-explosion DoS concern bounded by the exec caps).
 */

import { z } from "zod";

/**
 * Aggregation operators → ClickHouse function. `count` takes no column; all
 * others require an allowlisted metric column. Percentiles use tdigest to stay
 * within the memory caps on large ranges.
 */
export const AGGREGATION_OPS = {
  count: { needsColumn: false, fn: () => "count()" },
  cardinality: { needsColumn: true, fn: (c: string) => `uniqExact(${c})` },
  avg: { needsColumn: true, fn: (c: string) => `avg(${c})` },
  sum: { needsColumn: true, fn: (c: string) => `coalesce(sum(${c}), 0)` },
  min: { needsColumn: true, fn: (c: string) => `min(${c})` },
  max: { needsColumn: true, fn: (c: string) => `max(${c})` },
  p50: { needsColumn: true, fn: (c: string) => `quantileTDigest(0.5)(${c})` },
  p90: { needsColumn: true, fn: (c: string) => `quantileTDigest(0.9)(${c})` },
  p95: { needsColumn: true, fn: (c: string) => `quantileTDigest(0.95)(${c})` },
  p99: { needsColumn: true, fn: (c: string) => `quantileTDigest(0.99)(${c})` },
} as const;

export type AggregationOp = keyof typeof AGGREGATION_OPS;

/**
 * Metric columns (aggregatable). Each maps to a safe scalar expression over
 * `trace_summaries`. Payload columns (ComputedInput/Output, raw attributes)
 * are deliberately absent — they are filter-only, never aggregated/projected
 * as raw values (SR-8).
 */
export const METRIC_COLUMNS = {
  durationMs: "TotalDurationMs",
  cost: "TotalCost",
  promptTokens: "TotalPromptTokenCount",
  completionTokens: "TotalCompletionTokenCount",
  totalTokens:
    "(coalesce(TotalPromptTokenCount, 0) + coalesce(TotalCompletionTokenCount, 0))",
  tokensPerSecond: "TokensPerSecond",
} as const;

export type MetricColumn = keyof typeof METRIC_COLUMNS;

/**
 * Dimension columns (group-by-able). A CURATED enum — never arbitrary
 * `trace.attribute.<k>` — so a groupBy can never project raw payload/PII as a
 * group key (SR-8, devil's-advocate R8). `model` fans out the Models array;
 * arrayJoin is leakage-safe because it operates on the already-scoped row.
 */
export const DIMENSION_COLUMNS = {
  model: "arrayJoin(Models)",
  topicId: "TopicId",
  hasError: "ContainsErrorStatus",
} as const;

export type DimensionColumn = keyof typeof DIMENSION_COLUMNS;

/** Output-alias shape: must be a bare identifier, never SQL. */
const aliasSchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "alias must be a bare identifier")
  .max(64);

const aggregationSchema = z
  .object({
    op: z.enum(
      Object.keys(AGGREGATION_OPS) as [AggregationOp, ...AggregationOp[]],
    ),
    column: z
      .enum(Object.keys(METRIC_COLUMNS) as [MetricColumn, ...MetricColumn[]])
      .optional(),
    alias: aliasSchema.optional(),
  })
  .superRefine((agg, ctx) => {
    const spec = AGGREGATION_OPS[agg.op];
    if (spec.needsColumn && !agg.column) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `aggregation "${agg.op}" requires a metric column`,
      });
    }
  });

/**
 * The whole user-facing request. Note what is ABSENT: no tenantId/projectId
 * (derived from the authenticated session), no raw SQL, no table selector, no
 * JOIN/HAVING, no free-form projection. Unknown keys are stripped by Zod.
 */
export const traceQueryRequestSchema = z.object({
  aggregations: z.array(aggregationSchema).min(1).max(10),
  groupBy: z
    .array(
      z.enum(
        Object.keys(DIMENSION_COLUMNS) as [DimensionColumn, ...DimensionColumn[]],
      ),
    )
    .max(3)
    .optional(),
  filter: z.string().max(2000).optional(),
  timeRange: z
    .object({ from: z.number().int(), to: z.number().int() })
    .refine((t) => t.from <= t.to, {
      // An inverted range would emit `OccurredAt >= big AND <= small` and
      // silently match nothing — reject it rather than return an empty result.
      message: "timeRange.from must be <= timeRange.to",
    }),
  limit: z.number().int().positive().optional(),
});

export type TraceQueryRequest = z.infer<typeof traceQueryRequestSchema>;
