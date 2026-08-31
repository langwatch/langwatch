import { createLogger } from "@langwatch/observability";
import {
  type LiqeQuery,
  type LogicalExpressionToken,
  type ParenthesizedExpressionToken,
  parseTraceQuerySyntax,
  type TagToken,
  type UnaryOperatorToken,
} from "@langwatch/trace-contract";
import {
  type FieldNeeds,
  type InMemoryTrace,
  UNSUPPORTED,
  type Unsupported,
} from "../adapters/trace-query-evaluation.adapter";
import {
  MAX_NODE_COUNT,
  normalizeQuery,
  translateFilterToClickHouse,
} from "../adapters/trace-query.clickhouse.adapter";
import { FIELD_DEF_BY_NAME } from "../adapters/trace-query-fields.clickhouse.adapter";
import { existenceNeeds } from "../adapters/trace-query-meta-fields.clickhouse.adapter";
import {
  EVENT_ATTRIBUTE_PREFIX,
  EVENT_ATTRIBUTE_PREFIX_LEGACY,
  extractStringValue,
  readAttribute,
  SPAN_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
} from "../adapters/trace-query-values.clickhouse.adapter";

const logger = createLogger("langwatch:traces:filter-evaluate");

/**
 * Evaluating a saved query against one trace, in memory.
 *
 * The same query also compiles to ClickHouse SQL, and an automation decides
 * whether to fire from THIS answer while the trace list shows the other, so
 * the two have to agree. That is why the walk below mirrors the compiler's
 * node for node rather than being written the way an in-memory matcher
 * naturally would be.
 *
 * Everything here fails CLOSED. A parse error, an unknown field, a query past
 * the node or parameter caps, or a tag that cannot be positively decided at
 * dispatch time all answer `false` — never a false `true`, because a false
 * `true` fires an automation on a trace nobody asked about.
 */
export class TraceQueryEvaluationService {
  /**
   * Evaluate a liqe query against an in-memory trace, mirroring the ClickHouse
   * compiler's node walk so the two agree.
   *
   * Fail-closed: the whole query returns `false` — never a false `true` — on any
   * parse error, unknown field, over-complex query (the exact MAX_NODE_COUNT /
   * MAX_PARAM_COUNT caps), or any tag that can't be positively evaluated at
   * dispatch time ({@link UNSUPPORTED}). An empty query has no constraints, so it
   * matches every trace (`true`), mirroring the compiler returning no WHERE clause.
   */
  static matches(queryText: string, trace: InMemoryTrace): boolean {
    // Reuse the compiler as the validation gate — it enforces the exact
    // MAX_NODE_COUNT / MAX_PARAM_COUNT caps, rejects invalid syntax, and throws
    // FilterFieldUnknownError for unknown fields. Anything it rejects fails closed.
    let compiled: { sql: string; params: Record<string, unknown> } | null;
    try {
      compiled = translateFilterToClickHouse(queryText, "__in_memory__", {
        from: 0,
        to: 0,
      });
    } catch {
      return false;
    }
    // `null` means no filter (empty / whitespace) — every trace matches.
    if (compiled === null) return true;

    let ast: LiqeQuery;
    try {
      ast = parseTraceQuerySyntax(normalizeQuery(queryText));
    } catch {
      return false;
    }

    const state: WalkState = { nodeCount: 0, unsupportedFields: [] };
    const result = TraceQueryEvaluationService.evaluateNode(ast, false, trace, state);

    // A field that can never evaluate positively at dispatch (span-scoped fields,
    // `size`, the scenario dimensions) compiles to valid SQL and passes the
    // save-time gate, so the query looks healthy — it just fails closed on every
    // trace, forever, and the automation silently never fires. Whether that
    // should be rejected at save time or made evaluable is a product call; until
    // then, at least make the silence audible.
    if (state.unsupportedFields.length > 0) {
      logger.warn(
        {
          traceId: trace.summary.traceId,
          // Field names only — filter *values* can carry customer content.
          unsupportedFields: [...new Set(state.unsupportedFields)],
        },
        "Filter query fails closed: field(s) cannot be evaluated at dispatch, so this query never matches any trace",
      );
    }

    // UNSUPPORTED anywhere ⇒ the query can't be positively evaluated ⇒ false.
    return result === true;
  }

  static needs(queryText: string): Set<FieldNeeds> {
    const needs = new Set<FieldNeeds>();
    let ast: LiqeQuery;
    try {
      ast = parseTraceQuerySyntax(normalizeQuery(queryText));
    } catch {
      return needs;
    }
    TraceQueryEvaluationService.collectNeeds(ast, needs);
    return needs;
  }

  private static evaluateNode(
    node: LiqeQuery,
    negated: boolean,
    trace: InMemoryTrace,
    state: WalkState,
  ): boolean | Unsupported {
    state.nodeCount++;
    if (state.nodeCount > MAX_NODE_COUNT) return UNSUPPORTED;

    switch (node.type) {
      case "EmptyExpression":
        return true;

      case "Tag": {
        const tag = node as TagToken;
        const result = TraceQueryEvaluationService.evaluateTag(tag, negated, trace);
        if (result === UNSUPPORTED && tag.field.type !== "ImplicitField") {
          state.unsupportedFields.push(tag.field.name);
        }
        return result;
      }

      case "LogicalExpression": {
        const logExpr = node as LogicalExpressionToken;
        // Negation threads down unchanged and the operator stays as-is — the
        // exact shape `translateNode` compiles, so both sides always agree.
        const left = TraceQueryEvaluationService.evaluateNode(logExpr.left, negated, trace, state);
        if (left === UNSUPPORTED) return UNSUPPORTED;
        const right = TraceQueryEvaluationService.evaluateNode(
          logExpr.right,
          negated,
          trace,
          state,
        );
        if (right === UNSUPPORTED) return UNSUPPORTED;
        return logExpr.operator.operator === "OR" ? left || right : left && right;
      }

      case "UnaryOperator": {
        const unary = node as UnaryOperatorToken;
        const isNeg = unary.operator === "NOT" || unary.operator === "-";
        return TraceQueryEvaluationService.evaluateNode(
          unary.operand,
          negated !== isNeg,
          trace,
          state,
        );
      }

      case "ParenthesizedExpression": {
        const paren = node as ParenthesizedExpressionToken;
        return TraceQueryEvaluationService.evaluateNode(paren.expression, negated, trace, state);
      }

      default:
        return UNSUPPORTED;
    }
  }

  private static evaluateTag(
    tag: TagToken,
    negated: boolean,
    trace: InMemoryTrace,
  ): boolean | Unsupported {
    if (tag.field.type === "ImplicitField") {
      return TraceQueryEvaluationService.evaluateFreeText(tag, negated, trace);
    }

    const fieldName = tag.field.name;

    // Attribute prefixes — mirror `translateTag`'s routing order exactly.
    if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX)) {
      return TraceQueryEvaluationService.evaluateTraceAttribute(
        fieldName.slice(TRACE_ATTRIBUTE_PREFIX.length),
        tag,
        negated,
        trace,
      );
    }
    if (fieldName.startsWith(SPAN_ATTRIBUTE_PREFIX)) {
      // span.attribute.<k> resolves via stored_spans; spans aren't derived at
      // dispatch time yet.
      return UNSUPPORTED;
    }
    if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX)) {
      return TraceQueryEvaluationService.evaluateEventAttribute(
        fieldName.slice(EVENT_ATTRIBUTE_PREFIX.length),
        tag,
        negated,
        trace,
      );
    }
    if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX_LEGACY)) {
      return TraceQueryEvaluationService.evaluateTraceAttribute(
        fieldName.slice(TRACE_ATTRIBUTE_PREFIX_LEGACY.length),
        tag,
        negated,
        trace,
      );
    }
    if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX_LEGACY) && fieldName !== "event") {
      return TraceQueryEvaluationService.evaluateEventAttribute(
        fieldName.slice(EVENT_ATTRIBUTE_PREFIX_LEGACY.length),
        tag,
        negated,
        trace,
      );
    }

    // `.get()` — own keys only, so `constructor` / `toString` / `__proto__` are
    // unknown fields rather than inherited `Object.prototype` members that pass
    // this guard and then blow up on `def.evaluateInMemory(...)`.
    const def = FIELD_DEF_BY_NAME.get(fieldName);
    // Unknown field — the gate already rejected it; defensive fail-closed.
    if (!def) return UNSUPPORTED;
    return def.evaluateInMemory(tag, negated, trace);
  }

  private static evaluateFreeText(tag: TagToken, negated: boolean, trace: InMemoryTrace): boolean {
    // Mirrors `translateFreeText`'s `(ComputedInput ILIKE %v% OR ComputedOutput
    // ILIKE %v% OR ifNull(TraceName,'') ILIKE %v% OR <span-name subquery>)`,
    // including ClickHouse's three-valued logic over the Nullable(String) I/O
    // columns: `NULL ILIKE …` is NULL, `NULL OR true` is true, `NULL OR false` is
    // NULL, `NOT NULL` is NULL, and a NULL predicate excludes the row. So a match
    // on one column counts even when the other is NULL, but a negated free-text
    // filter never matches a trace whose non-matching side includes a NULL column.
    //
    // `traceName` mirrors the SQL side's `ifNull(...)` wrapper: a definite
    // true/false, never a NULL that propagates.
    //
    // Span names are the one branch that needs rows the dispatcher may not have
    // loaded (`needs` asks for them; today's callers still pass none). When
    // they are absent this mirror is deliberately NARROWER than the SQL clause:
    // it can miss a span-name-only match. The alternative, treating unloaded
    // spans as unknown and failing the tag closed, would make every negated
    // free-text filter stop matching, which is a live dispatch behaviour. Missing
    // the narrow span-name-only case costs less than breaking that, and a
    // dispatcher that starts loading spans becomes exact with no change here.
    const value = extractStringValue(tag).toLowerCase();
    const inputMatch = TraceQueryEvaluationService.ilikeContains(
      trace.summary.computedInput,
      value,
    );
    const outputMatch = TraceQueryEvaluationService.ilikeContains(
      trace.summary.computedOutput,
      value,
    );
    // `?? ""` rather than a bare deref: the type says string, but the only place
    // that coalesce actually happens is the analytics repository's row mapping, so
    // a summary built from a fold state that predates the field would throw here
    // and take the whole evaluation (including trigger dispatch) down with it.
    const nameMatch = (trace.summary.traceName ?? "").toLowerCase().includes(value);
    const spanMatch = trace.spans?.some((s) => s.name.toLowerCase().includes(value)) ?? false;

    const matched =
      inputMatch === true || outputMatch === true || nameMatch || spanMatch
        ? true
        : inputMatch === null || outputMatch === null
          ? null
          : false;
    const result = negated ? (matched === null ? null : !matched) : matched;
    return result === true;
  }

  /** `column ILIKE %value%` with SQL semantics: NULL column → NULL, not false. */
  private static ilikeContains(
    column: string | null | undefined,
    lowerValue: string,
  ): boolean | null {
    if (column == null) return null;
    return column.toLowerCase().includes(lowerValue);
  }

  private static evaluateTraceAttribute(
    key: string,
    tag: TagToken,
    negated: boolean,
    trace: InMemoryTrace,
  ): boolean | Unsupported {
    // Empty key throws on the SQL side (422) — fail closed.
    if (!key) return UNSUPPORTED;
    const value = extractStringValue(tag);
    const matched = readAttribute(trace.summary.attributes, key) === value;
    return negated ? !matched : matched;
  }

  private static evaluateEventAttribute(
    key: string,
    tag: TagToken,
    negated: boolean,
    trace: InMemoryTrace,
  ): boolean | Unsupported {
    if (!key) return UNSUPPORTED;
    if (trace.events == null) return UNSUPPORTED;
    const value = extractStringValue(tag);
    const matched = trace.events.some((e) => readAttribute(e.attributes, key) === value);
    return negated ? !matched : matched;
  }

  private static collectNeeds(node: LiqeQuery, needs: Set<FieldNeeds>): void {
    switch (node.type) {
      case "Tag":
        TraceQueryEvaluationService.collectTagNeeds(node as TagToken, needs);
        return;
      case "LogicalExpression": {
        const logExpr = node as LogicalExpressionToken;
        TraceQueryEvaluationService.collectNeeds(logExpr.left, needs);
        TraceQueryEvaluationService.collectNeeds(logExpr.right, needs);
        return;
      }
      case "UnaryOperator":
        TraceQueryEvaluationService.collectNeeds((node as UnaryOperatorToken).operand, needs);
        return;
      case "ParenthesizedExpression":
        TraceQueryEvaluationService.collectNeeds(
          (node as ParenthesizedExpressionToken).expression,
          needs,
        );
        return;
      default:
        return;
    }
  }

  private static collectTagNeeds(tag: TagToken, needs: Set<FieldNeeds>): void {
    // Free text reaches span names through a `stored_spans` subquery, so the
    // in-memory mirror needs the span rows to answer it without failing closed.
    if (tag.field.type === "ImplicitField") {
      needs.add("spans");
      return;
    }
    const fieldName = tag.field.name;

    if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX)) return;
    if (fieldName.startsWith(SPAN_ATTRIBUTE_PREFIX)) {
      needs.add("spans");
      return;
    }
    if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX)) {
      needs.add("events");
      return;
    }
    if (fieldName.startsWith(TRACE_ATTRIBUTE_PREFIX_LEGACY)) return;
    if (fieldName.startsWith(EVENT_ATTRIBUTE_PREFIX_LEGACY) && fieldName !== "event") {
      needs.add("events");
      return;
    }

    // has/none are value-polymorphic — resolve the referenced collection (if any)
    // from the value rather than a static `FieldDef.needs`.
    if (fieldName === "has" || fieldName === "none") {
      try {
        const need = existenceNeeds(extractStringValue(tag));
        if (need) needs.add(need);
      } catch {
        // Non-literal value — nothing to resolve.
      }
      return;
    }

    const def = FIELD_DEF_BY_NAME.get(fieldName);
    if (def?.needs) needs.add(def.needs);
  }
}

interface WalkState {
  nodeCount: number;
  /** Fields that returned {@link UNSUPPORTED}, for the fail-closed warning. */
  unsupportedFields: string[];
}

// ---------------------------------------------------------------------------
// needs — which auxiliary collections a query references, so a dispatcher
// can load only what it needs (parallels `triggerFiltersReferenceEvents`).
// ---------------------------------------------------------------------------
