/**
 * LangWatchQL analytics SQL — which functions a LangWatchQL query may call.
 *
 * The walk in `./validate.ts` allowlists node *kinds* and their *fields*. That
 * is not enough on its own, because every function call in ClickHouse — and
 * every operator, which the grammar desugars into one — arrives as the same
 * `Function` node carrying a name. A kind allowlist says "a function call is
 * fine here" and says nothing about `getSetting`, `currentUser`, `hostName` or
 * `version`. This module is the third allowlist: over the name.
 *
 * ## The admission rule
 *
 * **A function is listed because a question the LangWatchQL schema exists to
 * answer needs it, never because it looks harmless.** Harmlessness is not the
 * test and never was: `version()` leaks nothing of another tenant's and is
 * still not something this API publishes, and the set of functions that "look
 * fine" grows without limit while the set a caller actually needs does not.
 * Every family below traces to the feature file's answerable questions, to the
 * example SQL the schema endpoint publishes, or to the column types the
 * LangWatchQL views expose — and the comment on each says which.
 *
 * The corollary is the important half: **there is no denylist**. Nothing here
 * enumerates the introspection, system, filesystem, URL, dictionary or
 * randomness families, and nothing needs to. They are refused because they are
 * absent, which is also how a function ClickHouse ships next year is refused
 * before anyone has heard of it.
 *
 * ## Matching is case-insensitive, because the parser preserves case
 *
 * `@clickhouse/parser` reports the name as the caller wrote it: `COUNT(*)`
 * arrives as `COUNT`, `Avg(x)` as `Avg`. ClickHouse itself accepts either for a
 * documented subset, so a case-sensitive comparison would refuse the upper-case
 * SQL half the world writes. Folding case can only widen matching *within* this
 * list — a name that is absent stays absent in every spelling — and no entry
 * here is the case-variant of some other ClickHouse function.
 *
 * ## Aggregate combinators are a suffix rule, not 400 more entries
 *
 * ClickHouse spells conditional aggregation by suffixing the aggregate:
 * `countIf`, `sumIf`, `argMaxIf`. The grammar does the same for the standard
 * spelling — `COUNT(DISTINCT x)` arrives as `COUNTDistinct`, `sum(DISTINCT x)`
 * as `sumDistinct` — so refusing the suffix forms would refuse ordinary SQL.
 * {@link AGGREGATE_COMBINATORS} enumerates the two suffixes those needs
 * require, and they compose only onto {@link AGGREGATE_FUNCTIONS}. `-Merge`,
 * `-State`, `-Resample`, `-ForEach`, `-Array` and `-Map` are deliberately
 * absent: no LangWatchQL view exposes an `AggregateFunction` column, so no
 * LangWatchQL question can need them.
 *
 * ## What stays out on purpose, and why it is not an oversight
 *
 * `arrayReduce`, `arrayReduceInRanges`, `initializeAggregation` and
 * `finalizeAggregation` take an aggregate's name as a *string*, which no name
 * allowlist can inspect. They are absent rather than special-cased.
 * `rand`/`randCanonical` are absent because this API promises a parameterized
 * query re-runs deterministically. `dictGet*` is absent because dictionaries
 * are not subject to row policies at all — the feature file's own reason for
 * keeping the LangWatchQL schema free of them. `now()` is the one deliberate
 * exception to determinism: a relative time window has no other spelling, and
 * the schema endpoint's published example SQL uses it.
 *
 * @see ./validate.ts — the walk that applies this
 * @see specs/analytics/lwql-api.feature
 */

/**
 * Operators, under the names the grammar desugars them to.
 *
 * Not a widening: `a + b` is a `Function` named `plus`, `a IN (…)` one named
 * `in`, `CASE WHEN` one named `multiIf`, and `x::T` one named `CAST`. A caller
 * who writes no function call at all still lands here, so an operator missing
 * from this list refuses ordinary arithmetic.
 *
 * Two operators are listed with their families instead, because that is where a
 * reader looks for them: `||` desugars to `concat` and `CASE WHEN` without a
 * subject desugars to `multiIf`.
 */
const OPERATORS = [
  "plus",
  "minus",
  "multiply",
  "divide",
  "intDiv",
  "modulo",
  "negate",
  "and",
  "or",
  "not",
  "equals",
  "notEquals",
  "less",
  "lessOrEquals",
  "greater",
  "greaterOrEquals",
  "in",
  "notIn",
  "globalIn",
  "globalNotIn",
  "isNull",
  "isNotNull",
  "isDistinctFrom",
  "isNotDistinctFrom",
  "like",
  "notLike",
  "ilike",
  "notILike",
  "exists",
  // The ternary `a ? b : c`, `CASE x WHEN …` and `CASE WHEN …` respectively.
  "if",
  "caseWithExpression",
  "caseWithoutExpression",
  // `x[1]`, `m['k']`, `(a, b).1`, `(a, b)` and `x -> f(x)`.
  "arrayElement",
  "tupleElement",
  "tuple",
  "lambda",
  "CAST",
] as const;

/**
 * Aggregates, and the only names {@link AGGREGATE_COMBINATORS} may extend.
 *
 * Every answerable question in the feature file is an aggregation: percentiles
 * by model, error rate against the previous period, pass rates, cost rollups,
 * first failure per trace. `argMin` / `argMax` are what "first failure and
 * first retry per trace" is written with, and `groupArray` is what an ordered
 * "operation A then operation B" reconstruction needs.
 */
const AGGREGATE_FUNCTIONS = [
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "any",
  "anyLast",
  "argMin",
  "argMax",
  "uniq",
  "uniqExact",
  "uniqCombined",
  "median",
  "medianExact",
  "quantile",
  "quantiles",
  "quantileExact",
  "quantilesExact",
  "quantileTDigest",
  "quantilesTDigest",
  "quantileTiming",
  "quantilesTiming",
  "stddevPop",
  "stddevSamp",
  "varPop",
  "varSamp",
  "groupArray",
  "groupUniqArray",
  "topK",
] as const;

/**
 * Aggregate suffixes.
 *
 * `If` because every rate question in the feature file is a conditional
 * aggregate; `Distinct` because it is where the grammar puts the `DISTINCT`
 * a caller wrote inside an ordinary aggregate call.
 */
const AGGREGATE_COMBINATORS = ["if", "distinct"] as const;

/**
 * Window functions, for the rolling-window and ordering questions.
 *
 * An aggregate used with `OVER` keeps its own name and is admitted by
 * {@link AGGREGATE_FUNCTIONS}; these are the ones that exist only as window
 * functions.
 */
const WINDOW_FUNCTIONS = [
  "row_number",
  "rank",
  "dense_rank",
  "ntile",
  "first_value",
  "last_value",
  "nth_value",
  "lagInFrame",
  "leadInFrame",
] as const;

/**
 * Date and time, for time buckets, relative windows and period comparisons.
 *
 * `toInterval*` is not optional decoration: `INTERVAL 1 HOUR` *is* a call to
 * `toIntervalHour`, so `toStartOfInterval(t, INTERVAL 1 HOUR)` needs both.
 * `now()` is here for relative windows — see the module header on determinism.
 */
const DATE_TIME_FUNCTIONS = [
  "now",
  "now64",
  "today",
  "yesterday",
  "toStartOfSecond",
  "toStartOfMinute",
  "toStartOfFiveMinutes",
  "toStartOfTenMinutes",
  "toStartOfFifteenMinutes",
  "toStartOfHour",
  "toStartOfDay",
  "toStartOfWeek",
  "toStartOfISOWeek",
  "toStartOfMonth",
  "toStartOfQuarter",
  "toStartOfYear",
  "toStartOfInterval",
  "toMonday",
  "toLastDayOfMonth",
  "toYear",
  "toQuarter",
  "toMonth",
  "toWeek",
  "toISOWeek",
  "toDayOfMonth",
  "toDayOfWeek",
  "toDayOfYear",
  "toHour",
  "toMinute",
  "toSecond",
  "toUnixTimestamp",
  "fromUnixTimestamp",
  "toTimeZone",
  "dateDiff",
  "dateTrunc",
  "date_trunc",
  "addSeconds",
  "addMinutes",
  "addHours",
  "addDays",
  "addWeeks",
  "addMonths",
  "addQuarters",
  "addYears",
  "subtractSeconds",
  "subtractMinutes",
  "subtractHours",
  "subtractDays",
  "subtractWeeks",
  "subtractMonths",
  "subtractQuarters",
  "subtractYears",
  "toIntervalSecond",
  "toIntervalMinute",
  "toIntervalHour",
  "toIntervalDay",
  "toIntervalWeek",
  "toIntervalMonth",
  "toIntervalQuarter",
  "toIntervalYear",
  "formatDateTime",
] as const;

/** Arithmetic and rounding, for rates, ratios and bucketed distributions. */
const ARITHMETIC_FUNCTIONS = [
  "abs",
  "round",
  "floor",
  "ceil",
  "ceiling",
  "trunc",
  "truncate",
  "sign",
  "exp",
  "log",
  "ln",
  "log2",
  "log10",
  "sqrt",
  "pow",
  "power",
  "intDivOrZero",
  "moduloOrZero",
  "greatest",
  "least",
] as const;

/**
 * Strings, for grouping and filtering on names, models and attribute values.
 *
 * The regular-expression members are RE2 through ClickHouse, and the cost of
 * one is bounded by the same server-side execution ceilings as everything else.
 */
const STRING_FUNCTIONS = [
  "lower",
  "upper",
  "lowerUTF8",
  "upperUTF8",
  "concat",
  "concatWithSeparator",
  "substring",
  "substringUTF8",
  "left",
  "right",
  "length",
  "lengthUTF8",
  "empty",
  "notEmpty",
  "trim",
  "trimBoth",
  "trimLeft",
  "trimRight",
  "startsWith",
  "endsWith",
  "position",
  "positionCaseInsensitive",
  "match",
  "extract",
  "extractAll",
  "replaceAll",
  "replaceOne",
  "replaceRegexpAll",
  "replaceRegexpOne",
  "splitByChar",
  "splitByString",
] as const;

/** Conditionals and null handling, for bucketing and safe division. */
const CONDITIONAL_FUNCTIONS = [
  "multiIf",
  "coalesce",
  "nullIf",
  "ifNull",
  "assumeNotNull",
] as const;

/**
 * Arrays, maps and tuples, because the LangWatchQL views expose those types.
 *
 * `traces.Models` and `simulations.MessageContents` are `Array(String)` and
 * `spans.SpanAttributes` is a `Map(String, String)`, so "latency by model" is
 * literally an `arrayJoin` and reading an attribute is a `mapKeys` / `mapValues`
 * / element access away. A caller cannot use these datasets without them.
 */
const COLLECTION_FUNCTIONS = [
  "arrayJoin",
  "arrayMap",
  "arrayFilter",
  "arrayExists",
  "arrayAll",
  "arrayCount",
  "arraySum",
  "arrayAvg",
  "arrayMin",
  "arrayMax",
  "arraySort",
  "arrayReverseSort",
  "arrayDistinct",
  "arrayUniq",
  "arrayConcat",
  "arraySlice",
  "arrayFirst",
  "arrayLast",
  "arrayFirstIndex",
  "arrayEnumerate",
  "arrayStringConcat",
  "has",
  "hasAll",
  "hasAny",
  "indexOf",
  "map",
  "mapKeys",
  "mapValues",
  "mapContains",
  "mapFilter",
] as const;

/**
 * JSON, because attribute maps carry serialised payloads.
 *
 * The feature file's example SQL reads a JSON field out of a string column, and
 * an evaluation's `Details` is routinely a JSON document.
 */
const JSON_FUNCTIONS = [
  "JSONExtract",
  "JSONExtractString",
  "JSONExtractInt",
  "JSONExtractUInt",
  "JSONExtractFloat",
  "JSONExtractBool",
  "JSONExtractRaw",
  "JSONExtractArrayRaw",
  "JSONExtractKeys",
  "JSONExtractKeysAndValues",
  "JSONHas",
  "JSONLength",
  "JSONType",
  "isValidJSON",
  "simpleJSONHas",
  "simpleJSONExtractString",
  "simpleJSONExtractInt",
  "simpleJSONExtractUInt",
  "simpleJSONExtractFloat",
  "simpleJSONExtractBool",
] as const;

/**
 * Types a caller may convert to.
 *
 * Written as targets crossed with {@link CONVERSION_FALLBACKS} rather than as
 * ninety-odd literals, because the list is exactly that product and typing it
 * out would hide a missing member rather than reveal one. The result is still a
 * closed, enumerable set — {@link ALLOWED_FUNCTION_NAMES} is the whole of it.
 */
const CONVERSION_TARGETS = [
  "Int8",
  "Int16",
  "Int32",
  "Int64",
  "Int128",
  "Int256",
  "UInt8",
  "UInt16",
  "UInt32",
  "UInt64",
  "UInt128",
  "UInt256",
  "Float32",
  "Float64",
  "Decimal32",
  "Decimal64",
  "Decimal128",
  "Decimal256",
  "Date",
  "Date32",
  "DateTime",
  "DateTime64",
  "UUID",
] as const;

/**
 * What a conversion does with a value it cannot read.
 *
 * The `Or*` forms are what makes an attribute map usable: a token count stored
 * as a `String` is `toUInt64OrNull(SpanAttributes['…'])`, and the plain form
 * would fail the whole query on one malformed row.
 */
const CONVERSION_FALLBACKS = ["", "OrNull", "OrZero", "OrDefault"] as const;

/** Conversions with no numeric fallback form. */
const PLAIN_CONVERSIONS = ["toString", "toBool"] as const;

const CONVERSION_FUNCTIONS: readonly string[] = [
  ...PLAIN_CONVERSIONS,
  ...CONVERSION_TARGETS.flatMap((target) =>
    CONVERSION_FALLBACKS.map((fallback) => `to${target}${fallback}`),
  ),
];

/** Every name a LangWatchQL query may call, lowercased. */
const ALLOWED_FUNCTION_NAMES: ReadonlySet<string> = new Set(
  [
    ...OPERATORS,
    ...AGGREGATE_FUNCTIONS,
    ...WINDOW_FUNCTIONS,
    ...DATE_TIME_FUNCTIONS,
    ...ARITHMETIC_FUNCTIONS,
    ...STRING_FUNCTIONS,
    ...CONDITIONAL_FUNCTIONS,
    ...COLLECTION_FUNCTIONS,
    ...JSON_FUNCTIONS,
    ...CONVERSION_FUNCTIONS,
  ].map((name) => name.toLowerCase()),
);

/** The aggregates a combinator suffix may be appended to, lowercased. */
const AGGREGATE_BASE_NAMES: ReadonlySet<string> = new Set(
  AGGREGATE_FUNCTIONS.map((name) => name.toLowerCase()),
);

/**
 * How many combinator suffixes may be stripped off one name.
 *
 * ClickHouse allows them to compose (`sumIfDistinct`), and each pass shortens
 * the name so the loop terminates on its own — the bound is here so that
 * reasoning about this function never has to depend on that.
 */
const MAX_COMBINATORS = 4;

/**
 * The aggregate a name resolves to once its combinator suffixes are removed, or
 * `null` when it is not a combinator form of an allowed aggregate.
 */
function aggregateBaseOf(lowercased: string): string | null {
  let name = lowercased;
  for (let pass = 0; pass <= MAX_COMBINATORS; pass += 1) {
    if (AGGREGATE_BASE_NAMES.has(name)) return name;
    const suffix = AGGREGATE_COMBINATORS.find(
      (candidate) => name.length > candidate.length && name.endsWith(candidate),
    );
    if (!suffix) return null;
    name = name.slice(0, -suffix.length);
  }
  return null;
}

/**
 * Whether a LangWatchQL query may call this function.
 *
 * @param name The name exactly as the parser reported it, in the caller's own
 *   spelling and case.
 */
export function isAllowedLangWatchQLFunction(name: string): boolean {
  const lowercased = name.trim().toLowerCase();
  if (ALLOWED_FUNCTION_NAMES.has(lowercased)) return true;
  return aggregateBaseOf(lowercased) !== null;
}

/**
 * Whether this function collapses rows — the fact a fanout diagnostic reads.
 *
 * True for a combinator form as well, because `countIf` aggregates exactly as
 * `count` does. Says nothing about *where* the call appears: the same name used
 * with `OVER` does not collapse anything, and that distinction belongs to the
 * walk, which is what knows the call is a window function.
 */
export function isLangWatchQLAggregateFunction(name: string): boolean {
  return aggregateBaseOf(name.trim().toLowerCase()) !== null;
}
