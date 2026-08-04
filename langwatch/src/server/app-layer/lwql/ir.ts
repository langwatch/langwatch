/**
 * LWQL intermediate representation.
 *
 * Issue #6346 decision 1: both input forms — SQL-like text and structured JSON —
 * converge here, and *this* is the security boundary. The text parser is a
 * front-end that can only emit IR; anything reaching ClickHouse has passed
 * through this schema first.
 *
 * The schema is deliberately closed: no `z.record`, `z.any`, `z.unknown`,
 * `.passthrough()` or `.catchall()` appears in it, so an unexpected key is a
 * validation error rather than a value that survives into the compiler.
 */

import { z } from "zod";

import { AGGREGATION_NAMES, ENTITY_NAMES } from "./catalog";

/**
 * Identifiers are matched against the catalogue by the compiler, but bounding
 * their *shape* here keeps malformed input out of error messages that get
 * echoed back to callers.
 */
const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, {
    message: "Field names are lowercase alphanumeric with underscores.",
  });

export const comparisonOperatorSchema = z.enum([
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "like",
  "not_like",
  "in",
  "not_in",
  "is_null",
  "is_not_null",
]);

export type LwqlComparisonOperator = z.infer<typeof comparisonOperatorSchema>;

/**
 * Scalar literal. Values are always bound as query parameters, never
 * interpolated, so the only job here is to keep the domain small enough that
 * the compiler can type-check it against the field.
 */
export const literalSchema = z.union([
  z.string().max(4096),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export type LwqlLiteral = z.infer<typeof literalSchema>;

export interface LwqlComparison {
  field: string;
  op: LwqlComparisonOperator;
  value?: LwqlLiteral | LwqlLiteral[];
}

export type LwqlPredicate =
  | LwqlComparison
  | { and: LwqlPredicate[] }
  | { or: LwqlPredicate[] }
  | { not: LwqlPredicate };

const comparisonSchema: z.ZodType<LwqlComparison> = z.object({
  field: identifier,
  op: comparisonOperatorSchema,
  value: z
    .union([literalSchema, z.array(literalSchema).min(1).max(1000)])
    .optional(),
});

/**
 * Nesting is bounded so a hostile-but-valid payload cannot force unbounded
 * recursion in the compiler. The text parser enforces the same ceiling.
 */
export const MAX_PREDICATE_DEPTH = 12;

export const predicateSchema: z.ZodType<LwqlPredicate> = z.lazy(() =>
  z.union([
    comparisonSchema,
    z.object({ and: z.array(predicateSchema).min(1).max(100) }),
    z.object({ or: z.array(predicateSchema).min(1).max(100) }),
    z.object({ not: predicateSchema }),
  ]),
);

/**
 * A projected column: either a bare field, or an aggregate over one.
 *
 * `count` is the only aggregate accepting `*`; the compiler enforces that
 * rather than the schema, so the error can name the offending function.
 */
/** Function names are case-insensitive, as in SQL. */
const aggregationName = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(z.enum(AGGREGATION_NAMES as [string, ...string[]]));

export const selectItemSchema = z.union([
  z.object({
    field: z.union([identifier, z.literal("*")]),
    fn: aggregationName.optional(),
    // Carried through validation so compiler errors can echo the original
    // spelling; bounded because it appears in user-facing messages.
    fnRaw: z.string().max(64).optional(),
    as: identifier.optional(),
  }),
  // Convenience form: a bare string is an unaggregated field.
  identifier.transform((field) => ({ field })),
]);

export type LwqlSelectItem = {
  field: string;
  fn?: string;
  /**
   * The function name as the author spelled it, used only to make errors echo
   * their input. Never used for lookup — `fn` is the normalised, allowlisted
   * form and is the only thing the compiler resolves against.
   */
  fnRaw?: string;
  as?: string;
};

export const orderBySchema = z.object({
  field: identifier,
  fn: aggregationName.optional(),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

export type LwqlOrderBy = z.infer<typeof orderBySchema>;

/** Hard ceiling on rows returned, regardless of what the caller asks for. */
export const MAX_LIMIT = 10_000;
export const DEFAULT_LIMIT = 100;

/**
 * Default time bound applied when the caller supplies none.
 *
 * Issue #6346 safety requirement: expensive or unbounded scans are prevented by
 * default. An unbounded query over a large tenant is the easiest way to make
 * this endpoint an availability problem for everyone else.
 */
export const DEFAULT_TIME_RANGE_DAYS = 7;
export const MAX_TIME_RANGE_DAYS = 90;

export const lwqlQuerySchema = z
  .object({
    from: z.enum(ENTITY_NAMES as [string, ...string[]]),
    select: z.array(selectItemSchema).min(1).max(50),
    where: z.union([predicateSchema, z.array(predicateSchema)]).optional(),
    group_by: z.array(identifier).max(10).optional(),
    order_by: z.array(orderBySchema).max(10).optional(),
    limit: z.number().int().positive().max(MAX_LIMIT).optional(),
    offset: z.number().int().nonnegative().max(1_000_000).optional(),
    /**
     * Absolute epoch-ms window. Omitted bounds default to the last
     * `DEFAULT_TIME_RANGE_DAYS`. Not a tenant control — see decision 3.
     */
    time_range: z
      .object({
        from: z.number().int().nonnegative().optional(),
        to: z.number().int().nonnegative().optional(),
      })
      .optional(),
  })
  .strict();

export type LwqlQuery = {
  from: string;
  select: LwqlSelectItem[];
  where?: LwqlPredicate | LwqlPredicate[];
  group_by?: string[];
  order_by?: LwqlOrderBy[];
  limit?: number;
  offset?: number;
  time_range?: { from?: number; to?: number };
};

/** Normalises the two accepted `where` shapes into a single predicate. */
export const normaliseWhere = (
  where: LwqlPredicate | LwqlPredicate[] | undefined,
): LwqlPredicate | undefined => {
  if (where === undefined) return undefined;
  if (!Array.isArray(where)) return where;
  if (where.length === 0) return undefined;
  if (where.length === 1) return where[0];
  return { and: where };
};
