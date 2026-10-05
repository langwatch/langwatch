import {
  type FieldHandler,
  FilterFieldUnknownError,
  FilterParseError,
  FilterTooComplexError,
  MAX_FILTER_NODE_COUNT,
  type LiqeQuery,
  type LogicalExpressionToken,
  type ParenthesizedExpressionToken,
  parseTraceQuerySyntax,
  type TagToken,
  type UnaryOperatorToken,
  type ResolvedInstantEvalRun,
  type TranslationContext,
} from "@langwatch/trace-contract";

import {
  type AndChain,
  isAndChain,
  readAndChain,
  translateEvaluationScope,
} from "./trace-query-evaluation-scope.rules.ts";
import { FIELD_DEF_BY_NAME, KNOWN_FIELDS } from "./trace-query-fields.rules.ts";
import { boundedSubquery } from "./trace-query-subquery.rules.ts";
import {
  EVENT_ATTRIBUTE_PREFIX,
  EVENT_ATTRIBUTE_PREFIX_LEGACY,
  MAX_VALUE_LENGTH,
  SPAN_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
  extractStringValue,
  nextParam,
  validateAttributeKey,
  validateValueLength,
  wrap,
} from "./trace-query-values.rules.ts";

const MAX_PARAM_COUNT = 50;

/**
 * How many free-text terms the transcript-content search will carry. A
 * handful is a search; dozens is a scan of `log_records` wearing a query's
 * clothes, and the trace-level filter still applies every one of them.
 */
const MAX_CONTENT_TERMS = 8;

/**
 * Translates trace filters to ClickHouse SQL with value binding and free text.
 */

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
      return containsOrOperator((node as ParenthesizedExpressionToken).expression);
    default:
      return false;
  }
}

/**
 * Walk the query, pushing every positively-asserted bare word onto `terms`.
 * A negated branch contributes nothing: excluding a word cannot also be a
 * search for it.
 */
function collectFreeTextTerms(node: LiqeQuery, negated: boolean, terms: string[]): void {
  switch (node.type) {
    case "Tag": {
      terms.push(...freeTextTermsOf(node as TagToken, negated));
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
      collectFreeTextTerms((node as ParenthesizedExpressionToken).expression, negated, terms);
      return;
    default:
      return;
  }
}

/**
 * Extracts bare search words; empty if not a literal term.
 */
function freeTextTermsOf(tag: TagToken, negated: boolean): string[] {
  if (negated || tag.field.type !== "ImplicitField") return [];
  if (tag.expression.type !== "LiteralExpression") return [];
  const value = extractStringValue(tag);
  return value.length > 0 ? [value] : [];
}

function translateNode({
  node,
  negated,
  ctx,
  translateTag,
  bindEvaluations,
}: {
  node: LiqeQuery;
  negated: boolean;
  ctx: TranslationContext;
  translateTag: FieldHandler;
  bindEvaluations: boolean;
}): string {
  ctx.nodeCount++;
  if (ctx.nodeCount > MAX_FILTER_NODE_COUNT) {
    throw new FilterTooComplexError({ maxNodes: MAX_FILTER_NODE_COUNT });
  }

  const branch = (side: LiqeQuery, sideNegated: boolean): string =>
    translateNode({ node: side, negated: sideNegated, ctx, translateTag, bindEvaluations });

  switch (node.type) {
    case "EmptyExpression":
      return "1 = 1";

    case "Tag":
      return translateTag(node as TagToken, negated, ctx);

    case "LogicalExpression": {
      const logExpr = node as LogicalExpressionToken;
      if (bindEvaluations && !negated && isAndChain(logExpr)) {
        return translateAndChain({ chain: readAndChain(logExpr), ctx, branch });
      }
      const op = logExpr.operator.operator === "OR" ? "OR" : "AND";
      return `(${branch(logExpr.left, negated)} ${op} ${branch(logExpr.right, negated)})`;
    }

    case "UnaryOperator": {
      const unary = node as UnaryOperatorToken;
      const isNeg = unary.operator === "NOT" || unary.operator === "-";
      return branch(unary.operand, negated !== isNeg);
    }

    case "ParenthesizedExpression": {
      const paren = node as ParenthesizedExpressionToken;
      return `(${branch(paren.expression, negated)})`;
    }

    default:
      throw new FilterParseError(`Unsupported query syntax: ${(node as { type: string }).type}`);
  }
}

/**
 * An AND chain read once from its top: the bound evaluator group as one
 * condition, ANDed with the other operands walked as usual, folded left.
 */
function translateAndChain({
  chain,
  ctx,
  branch,
}: {
  chain: AndChain;
  ctx: TranslationContext;
  branch: (side: LiqeQuery, sideNegated: boolean) => string;
}): string {
  // The chain's own node is already counted; its nested ANDs and the bound
  // group are not walked, so they are counted here to keep the ceiling put.
  ctx.nodeCount += chain.nodeCount - 1;
  if (ctx.nodeCount > MAX_FILTER_NODE_COUNT) {
    throw new FilterTooComplexError({ maxNodes: MAX_FILTER_NODE_COUNT });
  }
  const parts = [
    ...(chain.scope ? [translateEvaluationScope(chain.scope, ctx)] : []),
    ...chain.rest.map((operand) => branch(operand, false)),
  ];
  const [first = "1 = 1", ...others] = parts;
  if (others.length === 0) return `(${first})`;
  return others.reduce((acc, part) => `(${acc} AND ${part})`, first);
}

function translateTag(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
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
    return translateTraceAttribute({ attrKey: key, tag, negated, ctx });
  }
  if (fieldName.startsWith(SPAN_ATTRIBUTE_PREFIX)) {
    const key = fieldName.slice(SPAN_ATTRIBUTE_PREFIX.length);
    return translateSpanAttribute({ attrKey: key, tag, negated, ctx });
  }
  if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX)) {
    const key = fieldName.slice(EVENT_ATTRIBUTE_PREFIX.length);
    return translateEventAttribute({ attrKey: key, tag, negated, ctx });
  }
  // Legacy alias — `attribute.<k>`. Identical SQL to `trace.attribute.<k>`.
  if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX_LEGACY)) {
    const key = fieldName.slice(TRACE_ATTRIBUTE_PREFIX_LEGACY.length);
    return translateTraceAttribute({ attrKey: key, tag, negated, ctx });
  }
  // Legacy alias — `event.<k>` (single-dot form). Skips the bare `event`
  // field so `event:<name>` still routes to the static handler map.
  if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX_LEGACY) && fieldName !== "event") {
    const key = fieldName.slice(EVENT_ATTRIBUTE_PREFIX_LEGACY.length);
    return translateEventAttribute({ attrKey: key, tag, negated, ctx });
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

function translateTraceAttribute({
  attrKey,
  tag,
  negated,
  ctx,
}: {
  attrKey: string;
  tag: TagToken;
  negated: boolean;
  ctx: TranslationContext;
}): string {
  if (!attrKey) {
    throw new FilterParseError("trace.attribute.<key> requires a key after the dot");
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
 * Matches span events with Attributes[<key>]=<value> via partition-pruned subquery.
 */
function translateEventAttribute({
  attrKey,
  tag,
  negated,
  ctx,
}: {
  attrKey: string;
  tag: TagToken;
  negated: boolean;
  ctx: TranslationContext;
}): string {
  if (!attrKey) {
    throw new FilterParseError("event.attribute.<key> requires a key after the dot");
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
 * Matches spans with SpanAttributes[<key>]=<value> via partition-pruned subquery.
 */
function translateSpanAttribute({
  attrKey,
  tag,
  negated,
  ctx,
}: {
  attrKey: string;
  tag: TagToken;
  negated: boolean;
  ctx: TranslationContext;
}): string {
  if (!attrKey) {
    throw new FilterParseError("span.attribute.<key> requires a key after the dot");
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

function translateFreeText(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
  const value = extractStringValue(tag);
  validateValueLength(value);
  const paramName = nextParam(ctx, "freeText");
  ctx.params[paramName] = `%${value}%`;
  const p = `{${paramName}:String}`;

  // Span names are part of free text, not just captured I/O — often the
  // only place a tool/agent identifier appears. TraceName covers the root
  // span off trace_summaries; the subquery covers every other span via
  // stored_spans.SpanName. Both branches evaluate to a definite true/false,
  // never NULL (parity suite pins this), keeping three-valued logic unchanged.
  const clause = `(ComputedInput ILIKE ${p} OR ComputedOutput ILIKE ${p} OR ifNull(TraceName, '') ILIKE ${p} OR ${boundedSubquery(
    "stored_spans",
    "StartTime",
    `SpanName ILIKE ${p}`,
  )})`;
  return negated ? `NOT ${clause}` : clause;
}

/**
 * Normalizes query spacing for compatibility with liqe parser.
 */
export function normalizeQuery(s: string): string {
  return s
    .replace(/([)\]])(?=(?:AND|OR|NOT)\b)/gi, "$1 ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Extracts positive free-text terms, excluding OR queries and structured tags.
 */
export function extractFreeTextTerms(queryText: string): string[] {
  const trimmed = normalizeQuery(queryText);
  if (!trimmed) return [];

  let ast: LiqeQuery;
  try {
    ast = parseTraceQuerySyntax(trimmed);
  } catch {
    return [];
  }

  // Content search joins terms with AND, which can't express a disjunction,
  // so a query carrying OR anywhere contributes NO content terms — the
  // branch is skipped and search falls back to the trace-level filter,
  // which does translate OR correctly. Fewer matches beats wrong ones:
  // 'checkout OR refund' must never be answered as 'checkout AND refund'.
  if (containsOrOperator(ast)) return [];

  const terms: string[] = [];
  collectFreeTextTerms(ast, false, terms);
  // Each term becomes its own positionCaseInsensitive over transcript
  // bodies, so count and width decide the subquery's cost. Past either
  // bound the content branch is dropped whole, not truncated — the terms
  // are ANDed, so a prefix would answer a narrower question and return
  // sessions that don't match the rest. Same call as the OR case above.
  if (terms.length > MAX_CONTENT_TERMS) return [];
  if (terms.some((term) => term.length > MAX_VALUE_LENGTH)) return [];
  return terms;
}

/**
 * Translates a liqe query into a parameterized WHERE fragment or null.
 * `evalRuns` carries the runs registered for the query's `eval` chips.
 */
export function translateFilter({
  queryText,
  tenantId,
  timeRange,
  evalRuns,
}: {
  queryText: string;
  tenantId: string;
  timeRange: { from: number; to: number };
  evalRuns?: readonly ResolvedInstantEvalRun[];
}): { sql: string; params: Record<string, unknown> } | null {
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
    ...(evalRuns ? { evalRuns } : {}),
  };

  const sql = translateFilterAst({
    queryText,
    ctx,
    translateTag: (tag, negated, tagCtx) => translateTag(tag, negated, tagCtx),
    bindEvaluations: true,
  });

  return sql === null ? null : { sql, params: ctx.params };
}

/**
 * The language's boolean structure, compiled with the tag translator given:
 * a second dialect over other tables supplies its own `translateTag`. Null
 * for an empty query, and the parameters land on `ctx.params`.
 */
export function translateFilterAst({
  queryText,
  ctx,
  translateTag,
  bindEvaluations = false,
}: {
  queryText: string;
  ctx: TranslationContext;
  translateTag: FieldHandler;
  /** Compile an evaluator and its result conditions as one evaluation; only
   * the `trace_summaries` dialect has the evaluator fields. */
  bindEvaluations?: boolean;
}): string | null {
  const trimmed = normalizeQuery(queryText);
  if (!trimmed) return null;

  let ast: LiqeQuery;
  try {
    ast = parseTraceQuerySyntax(trimmed);
  } catch {
    throw new FilterParseError("Invalid filter syntax");
  }

  if (ast.type === "EmptyExpression") return null;

  const sql = translateNode({ node: ast, negated: false, ctx, translateTag, bindEvaluations });

  if (Object.keys(ctx.params).length > MAX_PARAM_COUNT) {
    throw new FilterParseError("Too many filter conditions");
  }

  return sql;
}
