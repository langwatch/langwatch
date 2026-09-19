import {
  type LiqeQuery,
  type LogicalExpressionToken,
  type ParenthesizedExpressionToken,
  parse,
  type TagToken,
  type UnaryOperatorToken,
} from "liqe";
import {
  FilterFieldUnknownError,
  FilterParseError,
  FilterTooComplexError,
} from "../errors";
import { MAX_FILTER_NODE_COUNT } from "../query-language/queries";
import { FIELD_DEF_BY_NAME, KNOWN_FIELDS } from "./build-handlers";
import { boundedSubquery } from "./subqueries";
import {
  EVENT_ATTRIBUTE_PREFIX,
  EVENT_ATTRIBUTE_PREFIX_LEGACY,
  extractStringValue,
  MAX_VALUE_LENGTH,
  nextParam,
  SPAN_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
  type TranslationContext,
  validateAttributeKey,
  validateValueLength,
  wrap,
} from "./value-helpers";

const MAX_PARAM_COUNT = 50;

/**
 * How one dialect compiles a single `field:value` tag.
 *
 * The boolean structure of the language (AND, OR, NOT, parentheses, the node
 * ceiling) is the same whatever table the result runs against, so the walk
 * below takes the per-tag compilation as an argument. `trace_summaries` is one
 * dialect (the rest of this file); the LangWatchQL trace view is another, and
 * it lives with the feature that needs it.
 *
 * @see ~/server/app-layer/instant-evals/shorthand/filter.ts
 */
export type FilterTagTranslator = (
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
) => string;

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

  const sql = translateFilterAst({ queryText, ctx, translateTag });
  if (sql === null) return null;
  return { sql, params: ctx.params };
}

/**
 * The language's boolean structure, compiled with the tag translator given.
 *
 * Returns `null` for an empty query, which every caller reads as "no
 * condition"; throws {@link FilterParseError} for syntax the language does not
 * have and for a query past the node or parameter ceiling. The parameters land
 * on `ctx.params`, so the caller owns both the names it seeded and the ones the
 * walk added.
 */
export function translateFilterAst({
  queryText,
  ctx,
  translateTag: translateTagWith,
}: {
  readonly queryText: string;
  readonly ctx: TranslationContext;
  readonly translateTag: FilterTagTranslator;
}): string | null {
  const trimmed = normalizeQuery(queryText);
  if (!trimmed) return null;

  let ast: LiqeQuery;
  try {
    ast = parse(trimmed);
  } catch {
    throw new FilterParseError("Invalid filter syntax");
  }

  if (ast.type === "EmptyExpression") return null;

  const sql = translateNode({
    node: ast,
    negated: false,
    ctx,
    translateTag: translateTagWith,
  });

  if (Object.keys(ctx.params).length > MAX_PARAM_COUNT) {
    throw new FilterParseError("Too many filter conditions");
  }

  return sql;
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
  // bodies, so the count and the width of each term decide how much work that
  // subquery does. Past either bound the content branch is dropped whole
  // rather than truncated: the terms are ANDed, so keeping a prefix would
  // answer a narrower question than the one asked and return sessions that do
  // not match the rest. Same call as the OR case above, for the same reason.
  if (terms.length > MAX_CONTENT_TERMS) return [];
  if (terms.some((term) => term.length > MAX_VALUE_LENGTH)) return [];
  return terms;
}

/**
 * Whether the query names `fieldName` as a structured term anywhere, negated
 * or not, at any depth. Empty and unparsable input names nothing (the
 * translator rejects the latter first anyway).
 */
export function queryNamesField(queryText: string, fieldName: string): boolean {
  const trimmed = normalizeQuery(queryText);
  if (!trimmed) return false;

  let ast: LiqeQuery;
  try {
    ast = parse(trimmed);
  } catch {
    return false;
  }

  return namesField(ast, fieldName);
}

function namesField(node: LiqeQuery, fieldName: string): boolean {
  switch (node.type) {
    case "Tag": {
      const tag = node as TagToken;
      return tag.field.type !== "ImplicitField" && tag.field.name === fieldName;
    }
    case "LogicalExpression": {
      const logExpr = node as LogicalExpressionToken;
      return (
        namesField(logExpr.left, fieldName) ||
        namesField(logExpr.right, fieldName)
      );
    }
    case "UnaryOperator":
      return namesField((node as UnaryOperatorToken).operand, fieldName);
    case "ParenthesizedExpression":
      return namesField(
        (node as ParenthesizedExpressionToken).expression,
        fieldName,
      );
    default:
      return false;
  }
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

/**
 * The walk, with the per-tag compilation it was given.
 *
 * Named parameters rather than positional, because the tag translator is the
 * fourth thing the walk needs and a reader at the recursive call should not
 * have to count arguments to see which of them is the dialect.
 */
function translateNode({
  node,
  negated,
  ctx,
  translateTag: translateTagWith,
}: {
  node: LiqeQuery;
  negated: boolean;
  ctx: TranslationContext;
  translateTag: FilterTagTranslator;
}): string {
  ctx.nodeCount++;
  if (ctx.nodeCount > MAX_FILTER_NODE_COUNT) {
    throw new FilterTooComplexError({ maxNodes: MAX_FILTER_NODE_COUNT });
  }

  switch (node.type) {
    case "EmptyExpression":
      return "1 = 1";

    case "Tag":
      return translateTagWith(node as TagToken, negated, ctx);

    case "LogicalExpression": {
      const logExpr = node as LogicalExpressionToken;
      const branch = (side: LiqeQuery): string =>
        translateNode({
          node: side,
          negated,
          ctx,
          translateTag: translateTagWith,
        });
      const op = logExpr.operator.operator === "OR" ? "OR" : "AND";
      return `(${branch(logExpr.left)} ${op} ${branch(logExpr.right)})`;
    }

    case "UnaryOperator": {
      const unary = node as UnaryOperatorToken;
      const isNeg = unary.operator === "NOT" || unary.operator === "-";
      return translateNode({
        node: unary.operand,
        negated: negated !== isNeg,
        ctx,
        translateTag: translateTagWith,
      });
    }

    case "ParenthesizedExpression": {
      const paren = node as ParenthesizedExpressionToken;
      return `(${translateNode({
        node: paren.expression,
        negated,
        ctx,
        translateTag: translateTagWith,
      })})`;
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
