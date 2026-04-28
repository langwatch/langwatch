import {
  type LiqeQuery,
  type LogicalExpressionToken,
  type ParenthesizedExpressionToken,
  parse,
  type TagToken,
  type UnaryOperatorToken,
} from "liqe";
import { FilterFieldUnknownError, FilterParseError } from "../errors";
import { FIELD_HANDLERS, KNOWN_FIELDS } from "./build-handlers";
import {
  ATTRIBUTE_PREFIX,
  extractStringValue,
  nextParam,
  type TranslationContext,
  validateValueLength,
  wrap,
} from "./value-helpers";

const MAX_NODE_COUNT = 20;
const MAX_PARAM_COUNT = 50;

/**
 * `liqe`'s serializer can emit `cost:[0.01 TO 1]AND foo:bar` (no space after
 * `]`/`)` before a boolean) which its own parser then rejects. Normalise the
 * incoming query so older saved URLs and external callers don't 422.
 */
function normalizeQuery(s: string): string {
  return s
    .replace(/([\]\)])(?=(?:AND|OR|NOT)\b)/gi, "$1 ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Translate a liqe query string into a parameterized ClickHouse WHERE clause fragment.
 * Returns null for empty/whitespace queries.
 * Throws FilterParseError for invalid syntax or overly complex queries.
 * Throws FilterFieldUnknownError for unrecognized field names.
 */
export function translateFilterToClickHouse(
  queryText: string,
  tenantId: string,
  timeRange: { from: number; to: number },
): { sql: string; params: Record<string, unknown> } | null {
  const trimmed = normalizeQuery(queryText);
  if (!trimmed) return null;

  let ast: LiqeQuery;
  try {
    ast = parse(trimmed);
  } catch {
    throw new FilterParseError("Invalid filter syntax");
  }

  if (ast.type === "EmptyExpression") return null;

  const ctx: TranslationContext = {
    paramCounter: 0,
    nodeCount: 0,
    params: {
      tenantId,
      timeFrom: timeRange.from,
      timeTo: timeRange.to,
    },
    tenantId,
    timeRange,
  };

  const sql = translateNode(ast, false, ctx);

  if (Object.keys(ctx.params).length > MAX_PARAM_COUNT) {
    throw new FilterParseError("Too many filter conditions");
  }

  return { sql, params: ctx.params };
}

function translateNode(
  node: LiqeQuery,
  negated: boolean,
  ctx: TranslationContext,
): string {
  ctx.nodeCount++;
  if (ctx.nodeCount > MAX_NODE_COUNT) {
    throw new FilterParseError("Query too complex");
  }

  switch (node.type) {
    case "EmptyExpression":
      return "1 = 1";

    case "Tag":
      return translateTag(node as TagToken, negated, ctx);

    case "LogicalExpression": {
      const logExpr = node as LogicalExpressionToken;
      const left = translateNode(logExpr.left, negated, ctx);
      const right = translateNode(logExpr.right, negated, ctx);
      const op = logExpr.operator.operator === "OR" ? "OR" : "AND";
      return `(${left} ${op} ${right})`;
    }

    case "UnaryOperator": {
      const unary = node as UnaryOperatorToken;
      const isNeg = unary.operator === "NOT" || unary.operator === "-";
      return translateNode(unary.operand, negated !== isNeg, ctx);
    }

    case "ParenthesizedExpression": {
      const paren = node as ParenthesizedExpressionToken;
      return `(${translateNode(paren.expression, negated, ctx)})`;
    }

    default:
      throw new FilterParseError(
        `Unsupported query syntax: ${(node as { type: string }).type}`,
      );
  }
}

function translateTag(
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
): string {
  if (tag.field.type === "ImplicitField") {
    return translateFreeText(tag, negated, ctx);
  }

  const fieldName = tag.field.name;

  // attribute.<key> — dynamic per-attribute filtering, can't be enumerated
  // up front so it bypasses the static handler map.
  if (fieldName.startsWith(ATTRIBUTE_PREFIX)) {
    return translateAttributeField(fieldName, tag, negated, ctx);
  }

  const handler = FIELD_HANDLERS[fieldName];

  if (!handler) {
    throw new FilterFieldUnknownError(fieldName, KNOWN_FIELDS);
  }

  return handler(tag, negated, ctx);
}

function translateAttributeField(
  fieldName: string,
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
): string {
  const attrKey = fieldName.slice(ATTRIBUTE_PREFIX.length);
  if (!attrKey) {
    throw new FilterParseError("attribute.<key> requires a key after the dot");
  }
  const value = extractStringValue(tag);
  validateValueLength(value);
  const pKey = nextParam(ctx, "attrKey");
  const pVal = nextParam(ctx, "attrValue");
  ctx.params[pKey] = attrKey;
  ctx.params[pVal] = value;
  return wrap(`Attributes[{${pKey}:String}] = {${pVal}:String}`, negated);
}

function translateFreeText(
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
): string {
  const value = extractStringValue(tag);
  validateValueLength(value);
  const paramName = nextParam(ctx, "freeText");
  ctx.params[paramName] = `%${value}%`;

  const clause = `(ComputedInput ILIKE {${paramName}:String} OR ComputedOutput ILIKE {${paramName}:String})`;
  return negated ? `NOT ${clause}` : clause;
}
