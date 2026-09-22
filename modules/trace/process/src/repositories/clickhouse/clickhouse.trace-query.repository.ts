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

import { FIELD_DEF_BY_NAME, KNOWN_FIELDS } from "./clickhouse.trace-query-fields.repository.ts";
import { ClickHouseTraceQuerySubqueryRepository } from "./clickhouse.trace-query-subquery.repository.ts";
import {
  EVENT_ATTRIBUTE_PREFIX,
  EVENT_ATTRIBUTE_PREFIX_LEGACY,
  MAX_VALUE_LENGTH,
  SPAN_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
  ClickHouseTraceQueryValuesRepository,
} from "./clickhouse.trace-query-values.repository.ts";

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
export class ClickHouseTraceQueryRepository {
  private constructor(
    private readonly subqueries: ClickHouseTraceQuerySubqueryRepository,
    private readonly values: ClickHouseTraceQueryValuesRepository,
  ) {}

  static create(): ClickHouseTraceQueryRepository {
    return new ClickHouseTraceQueryRepository(
      ClickHouseTraceQuerySubqueryRepository.create(),
      ClickHouseTraceQueryValuesRepository.create(),
    );
  }

  /** Whether an OR joins any two branches of the query, at any depth. */
  private containsOrOperator(node: LiqeQuery): boolean {
    switch (node.type) {
      case "LogicalExpression": {
        const logExpr = node as LogicalExpressionToken;
        return (
          logExpr.operator.operator === "OR" ||
          this.containsOrOperator(logExpr.left) ||
          this.containsOrOperator(logExpr.right)
        );
      }
      case "UnaryOperator":
        return this.containsOrOperator((node as UnaryOperatorToken).operand);
      case "ParenthesizedExpression":
        return this.containsOrOperator((node as ParenthesizedExpressionToken).expression);
      default:
        return false;
    }
  }

  /**
   * Walk the query, pushing every positively-asserted bare word onto `terms`.
   * A negated branch contributes nothing: excluding a word cannot also be a
   * search for it.
   */
  private collectFreeTextTerms(node: LiqeQuery, negated: boolean, terms: string[]): void {
    switch (node.type) {
      case "Tag": {
        const value = this.freeTextTermOf(node as TagToken, negated);
        if (value !== null) terms.push(value);
        return;
      }
      case "LogicalExpression": {
        const logExpr = node as LogicalExpressionToken;
        this.collectFreeTextTerms(logExpr.left, negated, terms);
        this.collectFreeTextTerms(logExpr.right, negated, terms);
        return;
      }
      case "UnaryOperator": {
        const unary = node as UnaryOperatorToken;
        const isNeg = unary.operator === "NOT" || unary.operator === "-";
        this.collectFreeTextTerms(unary.operand, negated !== isNeg, terms);
        return;
      }
      case "ParenthesizedExpression":
        this.collectFreeTextTerms(
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
   * Extracts bare search words; null if not a literal term.
   */
  private freeTextTermOf(tag: TagToken, negated: boolean): string | null {
    if (negated || tag.field.type !== "ImplicitField") return null;
    if (tag.expression.type !== "LiteralExpression") return null;
    const value = this.values.extractStringValue(tag);
    return value.length > 0 ? value : null;
  }

  private translateNode({
    node,
    negated,
    ctx,
    translateTag,
  }: {
    node: LiqeQuery;
    negated: boolean;
    ctx: TranslationContext;
    translateTag: FieldHandler;
  }): string {
    ctx.nodeCount++;
    if (ctx.nodeCount > MAX_FILTER_NODE_COUNT) {
      throw new FilterTooComplexError({ maxNodes: MAX_FILTER_NODE_COUNT });
    }

    const branch = (side: LiqeQuery, sideNegated: boolean): string =>
      this.translateNode({ node: side, negated: sideNegated, ctx, translateTag });

    switch (node.type) {
      case "EmptyExpression":
        return "1 = 1";

      case "Tag":
        return translateTag(node as TagToken, negated, ctx);

      case "LogicalExpression": {
        const logExpr = node as LogicalExpressionToken;
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

  private translateTag(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
    if (tag.field.type === "ImplicitField") {
      return this.translateFreeText(tag, negated, ctx);
    }

    const fieldName = tag.field.name;

    // Namespaced attribute prefixes — unique root keeps autocomplete clean.
    // `trace.attribute.<k>` and `span.attribute.<k>` are the canonical
    // forms; `attribute.<k>` and `event.<k>` (one dot) are kept as aliases
    // so saved queries from the previous schema still translate cleanly.
    if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX)) {
      const key = fieldName.slice(TRACE_ATTRIBUTE_PREFIX.length);
      return this.translateTraceAttribute(key, tag, negated, ctx);
    }
    if (fieldName.startsWith(SPAN_ATTRIBUTE_PREFIX)) {
      const key = fieldName.slice(SPAN_ATTRIBUTE_PREFIX.length);
      return this.translateSpanAttribute(key, tag, negated, ctx);
    }
    if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX)) {
      const key = fieldName.slice(EVENT_ATTRIBUTE_PREFIX.length);
      return this.translateEventAttribute(key, tag, negated, ctx);
    }
    // Legacy alias — `attribute.<k>`. Identical SQL to `trace.attribute.<k>`.
    if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX_LEGACY)) {
      const key = fieldName.slice(TRACE_ATTRIBUTE_PREFIX_LEGACY.length);
      return this.translateTraceAttribute(key, tag, negated, ctx);
    }
    // Legacy alias — `event.<k>` (single-dot form). Skips the bare `event`
    // field so `event:<name>` still routes to the static handler map.
    if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX_LEGACY) && fieldName !== "event") {
      const key = fieldName.slice(EVENT_ATTRIBUTE_PREFIX_LEGACY.length);
      return this.translateEventAttribute(key, tag, negated, ctx);
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

  private translateTraceAttribute(
    attrKey: string,
    tag: TagToken,
    negated: boolean,
    ctx: TranslationContext,
  ): string {
    if (!attrKey) {
      throw new FilterParseError("trace.attribute.<key> requires a key after the dot");
    }
    this.values.validateAttributeKey(attrKey);
    const value = this.values.extractStringValue(tag);
    this.values.validateValueLength(value);
    const pKey = this.values.nextParam(ctx, "attrKey");
    const pVal = this.values.nextParam(ctx, "attrValue");
    ctx.params[pKey] = attrKey;
    ctx.params[pVal] = value;
    return this.values.wrap(`Attributes[{${pKey}:String}] = {${pVal}:String}`, negated);
  }

  /**
   * Matches span events with Attributes[<key>]=<value> via partition-pruned subquery.
   */
  private translateEventAttribute(
    attrKey: string,
    tag: TagToken,
    negated: boolean,
    ctx: TranslationContext,
  ): string {
    if (!attrKey) {
      throw new FilterParseError("event.attribute.<key> requires a key after the dot");
    }
    this.values.validateAttributeKey(attrKey);
    const value = this.values.extractStringValue(tag);
    this.values.validateValueLength(value);
    const pKey = this.values.nextParam(ctx, "eventAttrKey");
    const pVal = this.values.nextParam(ctx, "eventAttrValue");
    ctx.params[pKey] = attrKey;
    ctx.params[pVal] = value;
    return this.values.wrap(
      this.subqueries.boundedSubquery(
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
  private translateSpanAttribute(
    attrKey: string,
    tag: TagToken,
    negated: boolean,
    ctx: TranslationContext,
  ): string {
    if (!attrKey) {
      throw new FilterParseError("span.attribute.<key> requires a key after the dot");
    }
    this.values.validateAttributeKey(attrKey);
    const value = this.values.extractStringValue(tag);
    this.values.validateValueLength(value);
    const pKey = this.values.nextParam(ctx, "spanAttrKey");
    const pVal = this.values.nextParam(ctx, "spanAttrValue");
    ctx.params[pKey] = attrKey;
    ctx.params[pVal] = value;
    return this.values.wrap(
      this.subqueries.boundedSubquery(
        "stored_spans",
        "StartTime",
        `SpanAttributes[{${pKey}:String}] = {${pVal}:String}`,
      ),
      negated,
    );
  }

  private translateFreeText(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
    const value = this.values.extractStringValue(tag);
    this.values.validateValueLength(value);
    const paramName = this.values.nextParam(ctx, "freeText");
    ctx.params[paramName] = `%${value}%`;
    const p = `{${paramName}:String}`;

    // Span names are part of free text, not just captured I/O — often the
    // only place a tool/agent identifier appears. TraceName covers the root
    // span off trace_summaries; the subquery covers every other span via
    // stored_spans.SpanName. Both branches evaluate to a definite true/false,
    // never NULL (parity suite pins this), keeping three-valued logic unchanged.
    const clause = `(ComputedInput ILIKE ${p} OR ComputedOutput ILIKE ${p} OR ifNull(TraceName, '') ILIKE ${p} OR ${this.subqueries.boundedSubquery(
      "stored_spans",
      "StartTime",
      `SpanName ILIKE ${p}`,
    )})`;
    return negated ? `NOT ${clause}` : clause;
  }

  /**
   * Normalizes query spacing for compatibility with liqe parser.
   */
  normalizeQuery(s: string): string {
    return s
      .replace(/([)\]])(?=(?:AND|OR|NOT)\b)/gi, "$1 ")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  /**
   * Extracts positive free-text terms, excluding OR queries and structured tags.
   */
  extractFreeTextTerms(queryText: string): string[] {
    const trimmed = this.normalizeQuery(queryText);
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
    if (this.containsOrOperator(ast)) return [];

    const terms: string[] = [];
    this.collectFreeTextTerms(ast, false, terms);
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
  translateFilter({
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

    const sql = this.translateFilterAst({
      queryText,
      ctx,
      translateTag: (tag, negated, tagCtx) => this.translateTag(tag, negated, tagCtx),
    });

    return sql === null ? null : { sql, params: ctx.params };
  }

  /**
   * The language's boolean structure, compiled with the tag translator given:
   * a second dialect over other tables supplies its own `translateTag`. Null
   * for an empty query, and the parameters land on `ctx.params`.
   */
  translateFilterAst({
    queryText,
    ctx,
    translateTag,
  }: {
    queryText: string;
    ctx: TranslationContext;
    translateTag: FieldHandler;
  }): string | null {
    const trimmed = this.normalizeQuery(queryText);
    if (!trimmed) return null;

    let ast: LiqeQuery;
    try {
      ast = parseTraceQuerySyntax(trimmed);
    } catch {
      throw new FilterParseError("Invalid filter syntax");
    }

    if (ast.type === "EmptyExpression") return null;

    const sql = this.translateNode({ node: ast, negated: false, ctx, translateTag });

    if (Object.keys(ctx.params).length > MAX_PARAM_COUNT) {
      throw new FilterParseError("Too many filter conditions");
    }

    return sql;
  }
}
