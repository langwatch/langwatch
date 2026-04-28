import type { TagToken } from "liqe";
import { FilterParseError } from "../errors";

export const MAX_VALUE_LENGTH = 500;

export const ATTRIBUTE_PREFIX = "attribute.";

export interface TranslationContext {
  paramCounter: number;
  nodeCount: number;
  params: Record<string, unknown>;
  tenantId: string;
  timeRange: { from: number; to: number };
}

export type FieldHandler = (
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
) => string;

export function extractStringValue(tag: TagToken): string {
  if (tag.expression.type === "LiteralExpression") {
    return String(tag.expression.value);
  }
  if (tag.expression.type === "RegexExpression") {
    return String(tag.expression.value);
  }
  throw new FilterParseError("Unsupported value expression");
}

export function extractNumericValue(tag: TagToken): number {
  if (tag.expression.type !== "LiteralExpression") {
    throw new FilterParseError("Expected a numeric value");
  }
  const raw = tag.expression.value;
  const num = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (Number.isNaN(num)) {
    throw new FilterParseError(`Not a number: ${String(raw)}`);
  }
  return num;
}

/**
 * Generate a unique parameter name for the ClickHouse SDK to bind. Pass a
 * semantic `base` (e.g. `"traceId"`) so the resulting query reads naturally —
 * `WHERE TraceId = {traceId_0:String}` instead of `{f0:String}`. The trailing
 * counter keeps names unique when the same field appears multiple times in
 * one query.
 */
export function nextParam(ctx: TranslationContext, base = "f"): string {
  const name = `${base}${base === "f" ? "" : "_"}${ctx.paramCounter}`;
  ctx.paramCounter++;
  return name;
}

export function validateValueLength(value: string): void {
  if (value.length > MAX_VALUE_LENGTH) {
    throw new FilterParseError(
      `Filter value too long (max ${MAX_VALUE_LENGTH} characters)`,
    );
  }
}

export function wrap(sql: string, negated: boolean): string {
  return negated ? `NOT (${sql})` : sql;
}
