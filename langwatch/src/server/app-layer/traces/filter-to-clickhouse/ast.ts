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
import { boundedSubquery } from "./subqueries";
import {
  EVENT_ATTRIBUTE_PREFIX,
  EVENT_ATTRIBUTE_PREFIX_LEGACY,
  extractStringValue,
  nextParam,
  SPAN_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
  type TranslationContext,
  validateAttributeKey,
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

  // Namespaced attribute prefixes — unique root keeps autocomplete clean.
  // `trace.attribute.<k>` and `span.attribute.<k>` are the canonical
  // forms; `attribute.<k>` and `event.<k>` (one dot) are kept as aliases
  // so saved queries from the previous schema still translate cleanly.
  if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX)) {
    const key = fieldName.slice(TRACE_ATTRIBUTE_PREFIX.length);
    return translateTraceAttribute(key, tag, negated, ctx);
  }
  if (fieldName.startsWith(SPAN_ATTRIBUTE_PREFIX)) {
    const key = fieldName.slice(SPAN_ATTRIBUTE_PREFIX.length);
    return translateSpanAttribute(key, tag, negated, ctx);
  }
  if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX)) {
    const key = fieldName.slice(EVENT_ATTRIBUTE_PREFIX.length);
    return translateEventAttribute(key, tag, negated, ctx);
  }
  // Legacy alias — `attribute.<k>`. Identical SQL to `trace.attribute.<k>`.
  if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX_LEGACY)) {
    const key = fieldName.slice(TRACE_ATTRIBUTE_PREFIX_LEGACY.length);
    return translateTraceAttribute(key, tag, negated, ctx);
  }
  // Legacy alias — `event.<k>` (single-dot form). Skips the bare `event`
  // field so `event:<name>` still routes to the static handler map.
  if (
    fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX_LEGACY) &&
    fieldName !== "event"
  ) {
    const key = fieldName.slice(EVENT_ATTRIBUTE_PREFIX_LEGACY.length);
    return translateEventAttribute(key, tag, negated, ctx);
  }

  const handler = FIELD_HANDLERS[fieldName];

  if (!handler) {
    throw new FilterFieldUnknownError(fieldName, KNOWN_FIELDS);
  }

  return handler(tag, negated, ctx);
}

function translateTraceAttribute(
  attrKey: string,
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
): string {
  if (!attrKey) {
    throw new FilterParseError(
      "trace.attribute.<key> requires a key after the dot",
    );
  }
  validateAttributeKey(attrKey);
  const value = extractStringValue(tag);
  validateValueLength(value);
  const pKey = nextParam(ctx, "attrKey");
  const pVal = nextParam(ctx, "attrValue");
  ctx.params[pKey] = attrKey;
  ctx.params[pVal] = value;
  return wrap(`Attributes[{${pKey}:String}] = {${pVal}:String}`, negated);
}

/**
 * `event.attribute.<attr_key>:value` — match if any span event in the trace
 * has an `Attributes[<attr_key>] = <value>` entry. Events live on
 * `stored_spans`, so this is answered by a partition-pruned subquery over
 * that table. `Events.Attributes` is `Array(Map(LowCardinality(String),
 * String))` — `arrayExists` short-circuits on the first match, cheap
 * relative to materialising the nested column for each row.
 */
function translateEventAttribute(
  attrKey: string,
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
): string {
  if (!attrKey) {
    throw new FilterParseError(
      "event.attribute.<key> requires a key after the dot",
    );
  }
  validateAttributeKey(attrKey);
  const value = extractStringValue(tag);
  validateValueLength(value);
  const pKey = nextParam(ctx, "eventAttrKey");
  const pVal = nextParam(ctx, "eventAttrValue");
  ctx.params[pKey] = attrKey;
  ctx.params[pVal] = value;
  return wrap(
    boundedSubquery(
      "stored_spans",
      "StartTime",
      `arrayExists(attrs -> attrs[{${pKey}:String}] = {${pVal}:String}, \`Events.Attributes\`)`,
    ),
    negated,
  );
}

/**
 * `span.attribute.<attr_key>:value` — match if any span in the trace has
 * `SpanAttributes[<attr_key>] = <value>`. Same partition-pruned subquery
 * shape as the event-attribute form, scoped against the `SpanAttributes`
 * map directly. Filtering only — we never SELECT the heavy attribute
 * payloads, so this stays cheap even on traces with megabyte-class
 * `gen_ai.input.messages` blobs.
 */
function translateSpanAttribute(
  attrKey: string,
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
): string {
  if (!attrKey) {
    throw new FilterParseError(
      "span.attribute.<key> requires a key after the dot",
    );
  }
  validateAttributeKey(attrKey);
  const value = extractStringValue(tag);
  validateValueLength(value);
  const pKey = nextParam(ctx, "spanAttrKey");
  const pVal = nextParam(ctx, "spanAttrValue");
  ctx.params[pKey] = attrKey;
  ctx.params[pVal] = value;
  return wrap(
    boundedSubquery(
      "stored_spans",
      "StartTime",
      `SpanAttributes[{${pKey}:String}] = {${pVal}:String}`,
    ),
    negated,
  );
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
