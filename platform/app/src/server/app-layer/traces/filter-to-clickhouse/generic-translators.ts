import type { TagToken } from "liqe";
import { FilterParseError } from "../errors";
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

export function stringEquality(
  expression: string,
  name?: string,
): FieldHandler {
  return (tag, negated, ctx) =>
    translateStringField(expression, tag, negated, ctx, name);
}

export function crossTableStringEquality(
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

export function numericComparison(
  expression: string,
  name?: string,
): FieldHandler {
  return (tag, negated, ctx) =>
    translateNumericField(expression, tag, negated, ctx, name);
}

const NUMERIC_OP_MAP: Record<string, string> = {
  ":": "=",
  ":>": ">",
  ":<": "<",
  ":>=": ">=",
  ":<=": "<=",
};

export function crossTableNumericComparison(
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
