import {
  type LiqeQuery,
  type LogicalExpressionToken,
  type ParenthesizedExpressionToken,
  parse,
  type TagToken,
  type UnaryOperatorToken,
} from "liqe";
import { FilterFieldUnknownError, FilterParseError } from "../errors";
import { FIELD_DEF_BY_NAME, KNOWN_FIELDS } from "./build-handlers";
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

export const MAX_NODE_COUNT = 20;
const MAX_PARAM_COUNT = 50;

/**
 * `liqe`'s serializer can emit `cost:[0.01 TO 1]AND foo:bar` (no space after
 * `]`/`)` before a boolean) which its own parser then rejects. Normalise the
 * incoming query so older saved URLs and external callers don't 422.
 */
export function normalizeQuery(s: string): string {
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

/**
 * How many free-text terms the transcript-content search will carry. A
 * handful is a search; dozens is a scan of `log_records` wearing a query's
 * clothes, and the trace-level filter still applies every one of them.
 */
const MAX_CONTENT_TERMS = 8;

/**
 * The positive free-text terms of a query: every non-negated implicit-field
 * value ("#6418", a quoted phrase), skipping structured `field:value` tags.
 * The Sessions lens matches these against session transcript content in
 * `log_records`, ON TOP of the trace-level translation above, so a term that
 * only ever appeared in a transcript still finds its session. Returns [] for
 * empty or unparsable input (the translator throws on those first anyway),
 * and for any query carrying an OR.
 */
export function extractFreeTextTerms(queryText: string): string[] {
  const trimmed = normalizeQuery(queryText);
  if (!trimmed) return [];

  let ast: LiqeQuery;
  try {
    ast = parse(trimmed);
  } catch {
    return [];
  }

  // The content search joins these terms with AND, which cannot express a
  // disjunction. So a query carrying OR anywhere contributes NO content
  // terms: the content branch is skipped entirely and the search falls back
  // to the trace-level filter, which does translate OR correctly. Fewer
  // matches beats wrong ones, `checkout OR refund` must never be answered as
  // `checkout AND refund`.
  if (containsOrOperator(ast)) return [];

  const terms: string[] = [];
  collectFreeTextTerms(ast, false, terms);
  // Each term becomes its own `positionCaseInsensitive` over the transcript
  // bodies, so the count decides how many passes that subquery makes. Past
  // the cap the content branch is dropped whole rather than truncated: the
  // terms are ANDed, so keeping a prefix would answer a narrower question
  // than the one asked and return sessions that do not match the rest. Same
  // call as the OR case above, for the same reason.
  if (terms.length > MAX_CONTENT_TERMS) return [];
  return terms;
}

/** Whether an OR joins any two branches of the query, at any depth. */
function containsOrOperator(node: LiqeQuery): boolean {
  switch (node.type) {
    case "LogicalExpression": {
      const logExpr = node as LogicalExpressionToken;
      return (
        logExpr.operator.operator === "OR" ||
        containsOrOperator(logExpr.left) ||
        containsOrOperator(logExpr.right)
      );
    }
    case "UnaryOperator":
      return containsOrOperator((node as UnaryOperatorToken).operand);
    case "ParenthesizedExpression":
      return containsOrOperator(
        (node as ParenthesizedExpressionToken).expression,
      );
    default:
      return false;
  }
}

/**
 * Walk the query, pushing every positively-asserted bare word onto `terms`.
 * A negated branch contributes nothing: excluding a word cannot also be a
 * search for it.
 */
function collectFreeTextTerms(
  node: LiqeQuery,
  negated: boolean,
  terms: string[],
): void {
  switch (node.type) {
    case "Tag": {
      const value = freeTextTermOf(node as TagToken, negated);
      if (value !== null) terms.push(value);
      return;
    }
    case "LogicalExpression": {
      const logExpr = node as LogicalExpressionToken;
      collectFreeTextTerms(logExpr.left, negated, terms);
      collectFreeTextTerms(logExpr.right, negated, terms);
      return;
    }
    case "UnaryOperator": {
      const unary = node as UnaryOperatorToken;
      const isNeg = unary.operator === "NOT" || unary.operator === "-";
      collectFreeTextTerms(unary.operand, negated !== isNeg, terms);
      return;
    }
    case "ParenthesizedExpression":
      collectFreeTextTerms(
        (node as ParenthesizedExpressionToken).expression,
        negated,
        terms,
      );
      return;
    default:
      return;
  }
}

/**
 * The bare search word this tag carries, or null when it is not one.
 * Literals only: the content search matches a term as a plain substring, so a
 * regex would be looked up by its source text (`/checkout.*failed/` searched
 * for those very characters) and match nothing.
 */
function freeTextTermOf(tag: TagToken, negated: boolean): string | null {
  if (negated || tag.field.type !== "ImplicitField") return null;
  if (tag.expression.type !== "LiteralExpression") return null;
  const value = extractStringValue(tag);
  return value.length > 0 ? value : null;
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

  // `.get()` — own keys only. A plain-object index would resolve a field named
  // `constructor` / `toString` / `__proto__` off `Object.prototype`, sail past
  // this guard, and persist a filter no reader can evaluate.
  const def = FIELD_DEF_BY_NAME.get(fieldName);

  if (!def) {
    throw new FilterFieldUnknownError(fieldName, KNOWN_FIELDS);
  }

  return def.toClickHouse(tag, negated, ctx);
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
  const p = `{${paramName}:String}`;

  // Span names are part of free text, not just the captured I/O: the name is
  // often the only place a tool or agent identifier appears, so a query like
  // `codex` has to reach it. `TraceName` covers the root span's name straight
  // off `trace_summaries`; the subquery covers every other span via
  // `stored_spans.SpanName` (backed by `idx_span_name`).
  //
  // `TraceName` is `String DEFAULT ''`, so the `ifNull` wrapper is belt-and-
  // braces rather than load-bearing; it matches how `meta-handlers.ts` already
  // reads the column. What matters is that both name branches evaluate to a
  // definite true/false, never a NULL, so the clause's three-valued logic when a
  // computed I/O column is NULL stays exactly as it was. The parity suite pins
  // that. The span subquery is tenant-scoped and time-bounded by
  // `boundedSubquery`.
  const clause = `(ComputedInput ILIKE ${p} OR ComputedOutput ILIKE ${p} OR ifNull(TraceName, '') ILIKE ${p} OR ${boundedSubquery(
    "stored_spans",
    "StartTime",
    `SpanName ILIKE ${p}`,
  )})`;
  return negated ? `NOT ${clause}` : clause;
}
