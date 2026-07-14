import type { TagToken } from "liqe";
import { FilterParseError } from "../errors";
import {
  type CategoricalRead,
  type FieldDef,
  type FieldNeeds,
  type InMemoryTrace,
  type RangeRead,
  UNSUPPORTED,
  type Unsupported,
} from "./field-def";
import { boundedSubquery } from "./subqueries";
import {
  extractNumericValue,
  extractStringValue,
  type FieldHandler,
  nextParam,
  type TranslationContext,
  validateValueLength,
  wrap,
} from "./value-helpers";

// ---------------------------------------------------------------------------
// ClickHouse compilation (unchanged output — the byte-identical invariant)
// ---------------------------------------------------------------------------

export function translateNumericField(
  columnExpr: string,
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
  name = "value",
): string {
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

export function translateStringField(
  columnExpr: string,
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
  name = "value",
): string {
  const value = extractStringValue(tag);
  validateValueLength(value);
  const p = nextParam(ctx, name);
  ctx.params[p] = value;
  return wrap(`${columnExpr} = {${p}:String}`, negated);
}

function stringEqualityHandler(expression: string, name?: string): FieldHandler {
  return (tag, negated, ctx) =>
    translateStringField(expression, tag, negated, ctx, name);
}

function numericComparisonHandler(
  expression: string,
  name?: string,
): FieldHandler {
  return (tag, negated, ctx) =>
    translateNumericField(expression, tag, negated, ctx, name);
}

function crossTableStringHandler(
  table: string,
  timeColumn: string,
  expression: string,
  name = "value",
): FieldHandler {
  return (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx, name);
    ctx.params[p] = value;
    return wrap(
      boundedSubquery(table, timeColumn, `${expression} = {${p}:String}`),
      negated,
    );
  };
}

const NUMERIC_OP_MAP: Record<string, string> = {
  ":": "=",
  ":>": ">",
  ":<": "<",
  ":>=": ">=",
  ":<=": "<=",
};

function crossTableNumericHandler(
  table: string,
  timeColumn: string,
  expression: string,
  name = "value",
): FieldHandler {
  return (tag, negated, ctx) => {
    if (tag.expression.type === "RangeExpression") {
      const min = tag.expression.range.min;
      const max = tag.expression.range.max;
      const pMin = nextParam(ctx, `${name}Min`);
      const pMax = nextParam(ctx, `${name}Max`);
      ctx.params[pMin] = min;
      ctx.params[pMax] = max;
      return wrap(
        boundedSubquery(
          table,
          timeColumn,
          `${expression} >= {${pMin}:Float64} AND ${expression} <= {${pMax}:Float64}`,
        ),
        negated,
      );
    }
    const operator = tag.operator.operator;
    const num = extractNumericValue(tag);
    const p = nextParam(ctx, name);
    ctx.params[p] = num;
    const cmp = NUMERIC_OP_MAP[operator];
    if (!cmp) {
      throw new FilterParseError(`Unsupported operator: ${operator}`);
    }
    return wrap(
      boundedSubquery(table, timeColumn, `${expression} ${cmp} {${p}:Float64}`),
      negated,
    );
  };
}

// ---------------------------------------------------------------------------
// In-memory evaluation (mirrors the SQL each compiler emits)
// ---------------------------------------------------------------------------

/**
 * Numeric comparison mirroring {@link translateNumericField}: inclusive
 * `[min TO max]` ranges (ClickHouse always emits `>=`/`<=`, ignoring liqe's
 * inclusivity flags) and the single-value operators.
 */
export function matchNumericInMemory(value: number, tag: TagToken): boolean {
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
      throw new FilterParseError(
        `Unsupported operator: ${tag.operator.operator}`,
      );
  }
}

function evaluateCategorical(
  read: CategoricalRead,
  tag: TagToken,
  negated: boolean,
  trace: InMemoryTrace,
): boolean | Unsupported {
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

function evaluateRange(
  read: RangeRead,
  tag: TagToken,
  negated: boolean,
  trace: InMemoryTrace,
): boolean | Unsupported {
  const actual = read(trace);
  if (actual === UNSUPPORTED) return UNSUPPORTED;
  // NULL numeric column: excluded under both polarities (see above).
  if (actual === null) return false;
  const values = Array.isArray(actual) ? actual : [actual];
  const matched = values.some((v) => matchNumericInMemory(v, tag));
  return negated ? !matched : matched;
}

// ---------------------------------------------------------------------------
// Field-def builders (both sides)
// ---------------------------------------------------------------------------

/** Direct string equality on a `trace_summaries` expression. */
export function categorical(
  expression: string,
  read: CategoricalRead,
  name?: string,
): FieldDef {
  return {
    toClickHouse: stringEqualityHandler(expression, name),
    evaluateInMemory: (tag, negated, trace) =>
      evaluateCategorical(read, tag, negated, trace),
  };
}

/** Numeric comparison on a `trace_summaries` expression. */
export function range(
  expression: string,
  read: RangeRead,
  name?: string,
): FieldDef {
  return {
    toClickHouse: numericComparisonHandler(expression, name),
    evaluateInMemory: (tag, negated, trace) =>
      evaluateRange(read, tag, negated, trace),
  };
}

/**
 * String equality answered by a partition-pruned subquery on another table
 * (`evaluation_runs` / `stored_spans`). `read` collects the candidate values
 * from the referenced collection (or {@link UNSUPPORTED} when it isn't loaded).
 */
export function crossTableCategorical(
  table: string,
  timeColumn: string,
  expression: string,
  read: CategoricalRead,
  needs: FieldNeeds,
  name = "value",
): FieldDef {
  return {
    needs,
    toClickHouse: crossTableStringHandler(table, timeColumn, expression, name),
    evaluateInMemory: (tag, negated, trace) =>
      evaluateCategorical(read, tag, negated, trace),
  };
}

/** Numeric comparison answered by a partition-pruned cross-table subquery. */
export function crossTableRange(
  table: string,
  timeColumn: string,
  expression: string,
  read: RangeRead,
  needs: FieldNeeds,
  name = "value",
): FieldDef {
  return {
    needs,
    toClickHouse: crossTableNumericHandler(table, timeColumn, expression, name),
    evaluateInMemory: (tag, negated, trace) =>
      evaluateRange(read, tag, negated, trace),
  };
}
