import { ClickHouseTraceQuerySubqueryAdapter } from "./trace-query-subquery.clickhouse.adapter";
import {
  FilterFieldUnknownError,
  FilterParseError,
  type LiqeQuery,
  type LogicalExpressionToken,
  type ParenthesizedExpressionToken,
  parseTraceQuerySyntax,
  type TagToken,
  type UnaryOperatorToken,
} from "@langwatch/trace-contract";
import type { TranslationContext } from "@langwatch/trace-contract";
import { FIELD_DEF_BY_NAME, KNOWN_FIELDS } from "./trace-query-fields.clickhouse.adapter";
import {
  EVENT_ATTRIBUTE_PREFIX,
  EVENT_ATTRIBUTE_PREFIX_LEGACY,
  MAX_VALUE_LENGTH,
  SPAN_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
  TraceQueryValuesAdapter,
} from "./trace-query-values.clickhouse.adapter";

export const MAX_NODE_COUNT = 20;
const MAX_PARAM_COUNT = 50;

/**
 * How many free-text terms the transcript-content search will carry. A
 * handful is a search; dozens is a scan of `log_records` wearing a query's
 * clothes, and the trace-level filter still applies every one of them.
 */
const MAX_CONTENT_TERMS = 8;

/**
 * A trace filter as ClickHouse SQL — the top of the query translator: walks the filter tree, hands each leaf to {@link TraceQueryTranslatorsAdapter} for a predicate, with {@link TraceQueryValuesAdapter} binding values. Free text is pulled out separately since it's a search across several fields, not a predicate on one, and its terms must be known before the SQL is built. Nine of twelve steps here are the tree walk itself, exported for no reason; only three entry points are anybody else's business.
 */
export class TraceQueryClickHouseAdapter {
  static create(): TraceQueryClickHouseAdapter {
    return new TraceQueryClickHouseAdapter();
  }

  /** Whether an OR joins any two branches of the query, at any depth. */
  private static containsOrOperator(node: LiqeQuery): boolean {
    switch (node.type) {
      case "LogicalExpression": {
        const logExpr = node as LogicalExpressionToken;
        return (
          logExpr.operator.operator === "OR" ||
          TraceQueryClickHouseAdapter.containsOrOperator(logExpr.left) ||
          TraceQueryClickHouseAdapter.containsOrOperator(logExpr.right)
        );
      }
      case "UnaryOperator":
        return TraceQueryClickHouseAdapter.containsOrOperator((node as UnaryOperatorToken).operand);
      case "ParenthesizedExpression":
        return TraceQueryClickHouseAdapter.containsOrOperator(
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
  private static collectFreeTextTerms(node: LiqeQuery, negated: boolean, terms: string[]): void {
    switch (node.type) {
      case "Tag": {
        const value = TraceQueryClickHouseAdapter.freeTextTermOf(node as TagToken, negated);
        if (value !== null) terms.push(value);
        return;
      }
      case "LogicalExpression": {
        const logExpr = node as LogicalExpressionToken;
        TraceQueryClickHouseAdapter.collectFreeTextTerms(logExpr.left, negated, terms);
        TraceQueryClickHouseAdapter.collectFreeTextTerms(logExpr.right, negated, terms);
        return;
      }
      case "UnaryOperator": {
        const unary = node as UnaryOperatorToken;
        const isNeg = unary.operator === "NOT" || unary.operator === "-";
        TraceQueryClickHouseAdapter.collectFreeTextTerms(unary.operand, negated !== isNeg, terms);
        return;
      }
      case "ParenthesizedExpression":
        TraceQueryClickHouseAdapter.collectFreeTextTerms(
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
   * Bare search word this tag carries, or null if not one. Literals only — content search matches a term as a plain substring, so a regex would be looked up by its source text and match nothing.
   */
  private static freeTextTermOf(tag: TagToken, negated: boolean): string | null {
    if (negated || tag.field.type !== "ImplicitField") return null;
    if (tag.expression.type !== "LiteralExpression") return null;
    const value = TraceQueryValuesAdapter.extractStringValue(tag);
    return value.length > 0 ? value : null;
  }

  private static translateNode(node: LiqeQuery, negated: boolean, ctx: TranslationContext): string {
    ctx.nodeCount++;
    if (ctx.nodeCount > MAX_NODE_COUNT) {
      throw new FilterParseError("Query too complex");
    }

    switch (node.type) {
      case "EmptyExpression":
        return "1 = 1";

      case "Tag":
        return TraceQueryClickHouseAdapter.translateTag(node as TagToken, negated, ctx);

      case "LogicalExpression": {
        const logExpr = node as LogicalExpressionToken;
        const left = TraceQueryClickHouseAdapter.translateNode(logExpr.left, negated, ctx);
        const right = TraceQueryClickHouseAdapter.translateNode(logExpr.right, negated, ctx);
        const op = logExpr.operator.operator === "OR" ? "OR" : "AND";
        return `(${left} ${op} ${right})`;
      }

      case "UnaryOperator": {
        const unary = node as UnaryOperatorToken;
        const isNeg = unary.operator === "NOT" || unary.operator === "-";
        return TraceQueryClickHouseAdapter.translateNode(unary.operand, negated !== isNeg, ctx);
      }

      case "ParenthesizedExpression": {
        const paren = node as ParenthesizedExpressionToken;
        return `(${TraceQueryClickHouseAdapter.translateNode(paren.expression, negated, ctx)})`;
      }

      default:
        throw new FilterParseError(`Unsupported query syntax: ${(node as { type: string }).type}`);
    }
  }

  private static translateTag(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
    if (tag.field.type === "ImplicitField") {
      return TraceQueryClickHouseAdapter.translateFreeText(tag, negated, ctx);
    }

    const fieldName = tag.field.name;

    // Namespaced attribute prefixes — unique root keeps autocomplete clean.
    // `trace.attribute.<k>` and `span.attribute.<k>` are the canonical
    // forms; `attribute.<k>` and `event.<k>` (one dot) are kept as aliases
    // so saved queries from the previous schema still translate cleanly.
    if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX)) {
      const key = fieldName.slice(TRACE_ATTRIBUTE_PREFIX.length);
      return TraceQueryClickHouseAdapter.translateTraceAttribute(key, tag, negated, ctx);
    }
    if (fieldName.startsWith(SPAN_ATTRIBUTE_PREFIX)) {
      const key = fieldName.slice(SPAN_ATTRIBUTE_PREFIX.length);
      return TraceQueryClickHouseAdapter.translateSpanAttribute(key, tag, negated, ctx);
    }
    if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX)) {
      const key = fieldName.slice(EVENT_ATTRIBUTE_PREFIX.length);
      return TraceQueryClickHouseAdapter.translateEventAttribute(key, tag, negated, ctx);
    }
    // Legacy alias — `attribute.<k>`. Identical SQL to `trace.attribute.<k>`.
    if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX_LEGACY)) {
      const key = fieldName.slice(TRACE_ATTRIBUTE_PREFIX_LEGACY.length);
      return TraceQueryClickHouseAdapter.translateTraceAttribute(key, tag, negated, ctx);
    }
    // Legacy alias — `event.<k>` (single-dot form). Skips the bare `event`
    // field so `event:<name>` still routes to the static handler map.
    if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX_LEGACY) && fieldName !== "event") {
      const key = fieldName.slice(EVENT_ATTRIBUTE_PREFIX_LEGACY.length);
      return TraceQueryClickHouseAdapter.translateEventAttribute(key, tag, negated, ctx);
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

  private static translateTraceAttribute(
    attrKey: string,
    tag: TagToken,
    negated: boolean,
    ctx: TranslationContext,
  ): string {
    if (!attrKey) {
      throw new FilterParseError("trace.attribute.<key> requires a key after the dot");
    }
    TraceQueryValuesAdapter.validateAttributeKey(attrKey);
    const value = TraceQueryValuesAdapter.extractStringValue(tag);
    TraceQueryValuesAdapter.validateValueLength(value);
    const pKey = TraceQueryValuesAdapter.nextParam(ctx, "attrKey");
    const pVal = TraceQueryValuesAdapter.nextParam(ctx, "attrValue");
    ctx.params[pKey] = attrKey;
    ctx.params[pVal] = value;
    return TraceQueryValuesAdapter.wrap(`Attributes[{${pKey}:String}] = {${pVal}:String}`, negated);
  }

  /**
   * event.attribute.<attr_key>:value — matches if any span event has Attributes[<attr_key>]=<value>. Events live on stored_spans, answered by a partition-pruned subquery; Events.Attributes is Array(Map), and arrayExists short-circuits on first match, cheap relative to materialising the nested column per row.
   */
  private static translateEventAttribute(
    attrKey: string,
    tag: TagToken,
    negated: boolean,
    ctx: TranslationContext,
  ): string {
    if (!attrKey) {
      throw new FilterParseError("event.attribute.<key> requires a key after the dot");
    }
    TraceQueryValuesAdapter.validateAttributeKey(attrKey);
    const value = TraceQueryValuesAdapter.extractStringValue(tag);
    TraceQueryValuesAdapter.validateValueLength(value);
    const pKey = TraceQueryValuesAdapter.nextParam(ctx, "eventAttrKey");
    const pVal = TraceQueryValuesAdapter.nextParam(ctx, "eventAttrValue");
    ctx.params[pKey] = attrKey;
    ctx.params[pVal] = value;
    return TraceQueryValuesAdapter.wrap(
      ClickHouseTraceQuerySubqueryAdapter.boundedSubquery(
        "stored_spans",
        "StartTime",
        `arrayExists(attrs -> attrs[{${pKey}:String}] = {${pVal}:String}, \`Events.Attributes\`)`,
      ),
      negated,
    );
  }

  /**
   * span.attribute.<attr_key>:value — matches if any span has SpanAttributes[<attr_key>]=<value>. Same partition-pruned subquery shape as the event-attribute form. Filtering only — never SELECTs the heavy attribute payloads, so it stays cheap even with megabyte-class gen_ai.input.messages blobs.
   */
  private static translateSpanAttribute(
    attrKey: string,
    tag: TagToken,
    negated: boolean,
    ctx: TranslationContext,
  ): string {
    if (!attrKey) {
      throw new FilterParseError("span.attribute.<key> requires a key after the dot");
    }
    TraceQueryValuesAdapter.validateAttributeKey(attrKey);
    const value = TraceQueryValuesAdapter.extractStringValue(tag);
    TraceQueryValuesAdapter.validateValueLength(value);
    const pKey = TraceQueryValuesAdapter.nextParam(ctx, "spanAttrKey");
    const pVal = TraceQueryValuesAdapter.nextParam(ctx, "spanAttrValue");
    ctx.params[pKey] = attrKey;
    ctx.params[pVal] = value;
    return TraceQueryValuesAdapter.wrap(
      ClickHouseTraceQuerySubqueryAdapter.boundedSubquery(
        "stored_spans",
        "StartTime",
        `SpanAttributes[{${pKey}:String}] = {${pVal}:String}`,
      ),
      negated,
    );
  }

  private static translateFreeText(
    tag: TagToken,
    negated: boolean,
    ctx: TranslationContext,
  ): string {
    const value = TraceQueryValuesAdapter.extractStringValue(tag);
    TraceQueryValuesAdapter.validateValueLength(value);
    const paramName = TraceQueryValuesAdapter.nextParam(ctx, "freeText");
    ctx.params[paramName] = `%${value}%`;
    const p = `{${paramName}:String}`;

    // Span names are part of free text, not just captured I/O — often the
    // only place a tool/agent identifier appears. TraceName covers the root
    // span off trace_summaries; the subquery covers every other span via
    // stored_spans.SpanName. Both branches evaluate to a definite true/false,
    // never NULL (parity suite pins this), keeping three-valued logic unchanged.
    const clause = `(ComputedInput ILIKE ${p} OR ComputedOutput ILIKE ${p} OR ifNull(TraceName, '') ILIKE ${p} OR ${ClickHouseTraceQuerySubqueryAdapter.boundedSubquery(
      "stored_spans",
      "StartTime",
      `SpanName ILIKE ${p}`,
    )})`;
    return negated ? `NOT ${clause}` : clause;
  }

  /**
   * `liqe`'s serializer can emit `cost:[0.01 TO 1]AND foo:bar` (no space after
   * `]`/`)` before a boolean) which its own parser then rejects. Normalise the
   * incoming query so older saved URLs and external callers don't 422.
   */
  static normalizeQuery(s: string): string {
    return s
      .replace(/([)\]])(?=(?:AND|OR|NOT)\b)/gi, "$1 ")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  /**
   * Positive free-text terms of a query: every non-negated implicit-field value, skipping structured field:value tags. The Sessions lens matches these against transcript content in log_records, ON TOP of the trace-level translation, so a transcript-only term still finds its session. Returns [] for empty/unparsable input and for any query carrying an OR.
   */
  static extractFreeTextTerms(queryText: string): string[] {
    const trimmed = TraceQueryClickHouseAdapter.normalizeQuery(queryText);
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
    if (TraceQueryClickHouseAdapter.containsOrOperator(ast)) return [];

    const terms: string[] = [];
    TraceQueryClickHouseAdapter.collectFreeTextTerms(ast, false, terms);
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
   * Translates a liqe query into a parameterized CH WHERE fragment. Null for empty/whitespace. Throws FilterParseError for invalid syntax or over-complex queries, FilterFieldUnknownError for unrecognized fields.
   */
  static translateFilter(
    queryText: string,
    tenantId: string,
    timeRange: { from: number; to: number },
  ): { sql: string; params: Record<string, unknown> } | null {
    const trimmed = TraceQueryClickHouseAdapter.normalizeQuery(queryText);
    if (!trimmed) return null;

    let ast: LiqeQuery;
    try {
      ast = parseTraceQuerySyntax(trimmed);
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

    const sql = TraceQueryClickHouseAdapter.translateNode(ast, false, ctx);

    if (Object.keys(ctx.params).length > MAX_PARAM_COUNT) {
      throw new FilterParseError("Too many filter conditions");
    }

    return { sql, params: ctx.params };
  }
}
