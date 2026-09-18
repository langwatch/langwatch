/**
 * LangWatchQL analytics SQL — which functions a LangWatchQL query may call.
 * @see ./validate.ts — the walk that applies this
 * @see specs/analytics/lwql-api.feature
 */

/**
 * Operators, under the names the grammar desugars them to. Not a widening: `a + b` is a
 * `Function` named `plus`, `a IN (…)` one named `in`, `CASE WHEN` one named `multiIf`, and
 * `x::T` one named `CAST`.
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
 * Aggregates, and the only names {@link AGGREGATE_COMBINATORS} may extend. Every answerable
 * question in the feature file is an aggregation: percentiles by model, error rate against the
 * previous period, pass rates, cost rollups, first failure per trace.
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
 * Aggregate suffixes. `If` because every rate question in the feature file is a conditional
 * aggregate; `Distinct` because it is where the grammar puts the `DISTINCT` a caller wrote
 * inside an ordinary aggregate call.
 */
const AGGREGATE_COMBINATORS = ["if", "distinct"] as const;

/**
 * Window functions, for the rolling-window and ordering questions. An aggregate used with
 * `OVER` keeps its own name and is admitted by {@link AGGREGATE_FUNCTIONS}; these are the ones
 * that exist only as window functions.
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
 * Date and time, for time buckets, relative windows and period comparisons. `toInterval*` is
 * not optional decoration: `INTERVAL 1 HOUR` *is* a call to `toIntervalHour`, so
 * `toStartOfInterval(t, INTERVAL 1 HOUR)` needs both.
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
 * Strings, for grouping and filtering on names, models and attribute values. The
 * regular-expression members are RE2 through ClickHouse, and the cost of one is bounded by the
 * same server-side execution ceilings as everything else.
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
const CONDITIONAL_FUNCTIONS = ["multiIf", "coalesce", "nullIf", "ifNull", "assumeNotNull"] as const;

/**
 * Arrays, maps and tuples, because the LangWatchQL views expose those types.
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
 * JSON, because attribute maps carry serialised payloads. The feature file's example SQL reads
 * a JSON field out of a string column, and an evaluation's `Details` is routinely a JSON
 * document.
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
 * Types a caller may convert to. Written as targets crossed with {@link CONVERSION_FALLBACKS}
 * rather than as ninety-odd literals, because the list is exactly that product and typing it
 * out would hide a missing member rather than reveal one.
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

/**
 * A membership table for names, keyed on a null prototype.
 */
type NameLookup = Readonly<Record<string, true>>;

function nameLookup(names: readonly string[]): NameLookup {
  const lookup = Object.create(null) as Record<string, true>;
  for (const name of names) lookup[name] = true;
  return Object.freeze(lookup);
}

function isListed(lookup: NameLookup, name: string): boolean {
  return lookup[name] === true;
}

/** Every name a LangWatchQL query may call, lowercased. */
const ALLOWED_FUNCTION_NAMES: NameLookup = nameLookup(
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
const AGGREGATE_BASE_NAMES: NameLookup = nameLookup(
  AGGREGATE_FUNCTIONS.map((name) => name.toLowerCase()),
);

/**
 * How many combinator suffixes may be stripped off one name. ClickHouse allows them to compose
 * (`sumIfDistinct`), and each pass shortens the name so the loop terminates on its own — the
 * bound is here so that reasoning about this function never has to depend on that.
 */
const MAX_COMBINATORS = 4;

/**
 * The aggregate a name resolves to once its combinator suffixes are removed, or
 * `null` when it is not a combinator form of an allowed aggregate.
 */
function aggregateBaseOf(lowercased: string): string | null {
  let name = lowercased;
  for (let pass = 0; pass <= MAX_COMBINATORS; pass += 1) {
    if (isListed(AGGREGATE_BASE_NAMES, name)) return name;
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
 * @param name The name exactly as the parser reported it, in the caller's own
 */
export function isAllowedLangWatchQLFunction(name: string): boolean {
  const lowercased = name.trim().toLowerCase();
  if (isListed(ALLOWED_FUNCTION_NAMES, lowercased)) return true;
  return aggregateBaseOf(lowercased) !== null;
}

/**
 * Whether this function collapses rows — the fact a fanout diagnostic reads. True for a
 * combinator form as well, because `countIf` aggregates exactly as `count` does.
 */
export function isLangWatchQLAggregateFunction(name: string): boolean {
  return aggregateBaseOf(name.trim().toLowerCase()) !== null;
}
