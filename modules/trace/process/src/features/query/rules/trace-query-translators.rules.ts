import {
  FilterParseError,
  type TagToken,
  type CategoricalRead,
  type FieldDef,
  type FieldNeeds,
  type InMemoryTrace,
  type RangeRead,
  UNSUPPORTED,
  type Unsupported,
  type FieldHandler,
  type TranslationContext,
} from "@langwatch/trace-contract";

import {
  extractNumericValue,
  extractStringValue,
  nextParam,
  validateValueLength,
  wrap,
} from "./trace-query-values.rules.ts";

/** The LangWatchQL dialect's text handlers, and the in-memory side of each filter field. */

export function translateNumericField({
  columnExpr,
  tag,
  negated,
  ctx,
  name = "value",
}: {
  columnExpr: string;
  tag: TagToken;
  negated: boolean;
  ctx: TranslationContext;
  name?: string;
}): string {
  if (tag.expression.type === "RangeExpression") {
    const min = tag.expression.range.min;
    const max = tag.expression.range.max;
    const pMin = nextParam(ctx, `${name}Min`);
    const pMax = nextParam(ctx, `${name}Max`);
    ctx.params[pMin] = min;
    ctx.params[pMax] = max;
    return wrap(
      `(${columnExpr} >= {${pMin}:Float64} AND ${columnExpr} <= {${pMax}:Float64})`,
      negated,
    );
  }

  const operator = tag.operator.operator;
  const num = extractNumericValue(tag);
  const p = nextParam(ctx, name);
  ctx.params[p] = num;

  switch (operator) {
    case ":":
      return wrap(`${columnExpr} = {${p}:Float64}`, negated);
    case ":>":
      return wrap(`${columnExpr} > {${p}:Float64}`, negated);
    case ":<":
      return wrap(`${columnExpr} < {${p}:Float64}`, negated);
    case ":>=":
      return wrap(`${columnExpr} >= {${p}:Float64}`, negated);
    case ":<=":
      return wrap(`${columnExpr} <= {${p}:Float64}`, negated);
    default:
      throw new FilterParseError(`Unsupported operator: ${operator}`);
  }
}

export function translateStringField({
  columnExpr,
  tag,
  negated,
  ctx,
  name = "value",
}: {
  columnExpr: string;
  tag: TagToken;
  negated: boolean;
  ctx: TranslationContext;
  name?: string;
}): string {
  const value = extractStringValue(tag);
  validateValueLength(value);
  const p = nextParam(ctx, name);
  ctx.params[p] = value;
  return wrap(`${columnExpr} = {${p}:String}`, negated);
}

/** `expression = value`, bound; the value's parameter is minted from `name`. */
export function stringEqualityHandler(expression: string, name?: string): FieldHandler {
  return (tag, negated, ctx) =>
    translateStringField({ columnExpr: expression, tag, negated, ctx, name });
}

/** `expression <op> value` or an inclusive range, bound as Float64. */
export function numericComparisonHandler(expression: string, name?: string): FieldHandler {
  return (tag, negated, ctx) =>
    translateNumericField({ columnExpr: expression, tag, negated, ctx, name });
}

/**
 * Numeric comparison mirroring {@link translateNumericField}: inclusive
 * `[min TO max]` ranges (ClickHouse always emits `>=`/`<=`, ignoring liqe's
 * inclusivity flags) and the single-value operators.
 */
function matchNumericInMemory(value: number, tag: TagToken): boolean {
  if (tag.expression.type === "RangeExpression") {
    const min = tag.expression.range.min;
    const max = tag.expression.range.max;
    return value >= min && value <= max;
  }
  const num = extractNumericValue(tag);
  switch (tag.operator.operator) {
    case ":":
      return value === num;
    case ":>":
      return value > num;
    case ":<":
      return value < num;
    case ":>=":
      return value >= num;
    case ":<=":
      return value <= num;
    default:
      throw new FilterParseError(`Unsupported operator: ${tag.operator.operator}`);
  }
}

function evaluateCategorical({
  read,
  tag,
  negated,
  trace,
}: {
  read: CategoricalRead;
  tag: TagToken;
  negated: boolean;
  trace: InMemoryTrace;
}): boolean | Unsupported {
  const actual = read(trace);
  if (actual === UNSUPPORTED) return UNSUPPORTED;
  const target = extractStringValue(tag);
  // A `null` scalar mirrors a NULL ClickHouse column: `col = x` and
  // `NOT (col = x)` both yield NULL, i.e. the row is excluded either way.
  if (actual === null) return false;
  const values = Array.isArray(actual) ? actual : [actual];
  const matched = values.includes(target);
  return negated ? !matched : matched;
}

function evaluateRange({
  read,
  tag,
  negated,
  trace,
}: {
  read: RangeRead;
  tag: TagToken;
  negated: boolean;
  trace: InMemoryTrace;
}): boolean | Unsupported {
  const actual = read(trace);
  if (actual === UNSUPPORTED) return UNSUPPORTED;
  // NULL numeric column: excluded under both polarities (see above).
  if (actual === null) return false;
  const values = Array.isArray(actual) ? actual : [actual];
  const matched = values.some((v) => matchNumericInMemory(v, tag));
  return negated ? !matched : matched;
}

/** A field compared as a string, against what `read` takes from the trace. */
export function categorical({
  read,
  needs,
}: {
  read: CategoricalRead;
  needs?: FieldNeeds;
}): FieldDef {
  return {
    ...(needs ? { needs } : {}),
    evaluateInMemory: (tag, negated, trace) => evaluateCategorical({ read, tag, negated, trace }),
  };
}

/** A field compared as a number, against what `read` takes from the trace. */
export function range({ read, needs }: { read: RangeRead; needs?: FieldNeeds }): FieldDef {
  return {
    ...(needs ? { needs } : {}),
    evaluateInMemory: (tag, negated, trace) => evaluateRange({ read, tag, negated, trace }),
  };
}
