import { createLogger } from "@langwatch/observability";
import {
  type FieldNeeds,
  type InMemoryTrace,
  type LiqeQuery,
  type LogicalExpressionToken,
  MAX_FILTER_NODE_COUNT,
  type ParenthesizedExpressionToken,
  parseTraceQuerySyntax,
  type TagToken,
  type UnaryOperatorToken,
  UNSUPPORTED,
  type Unsupported,
} from "@langwatch/trace-contract";

import { type AndChain, buildAndChain } from "../rules/trace-query-evaluation-scope.rules.ts";
import { collectQueryNeeds, evaluateTraceTag } from "../rules/trace-query-evaluation.rules.ts";
import { normalizeQuery } from "../rules/trace-query.rules.ts";
import type { TraceQueryEvaluationScopeService } from "./trace-query-evaluation-scope.service.ts";
import type { TraceQueryFieldsService } from "./trace-query-fields.service.ts";
import type { TraceQueryTranslationService } from "./trace-query-translation.service.ts";

const logger = createLogger("langwatch:traces:filter-evaluate");

interface WalkState {
  nodeCount: number;
  /** Fields that returned {@link UNSUPPORTED}, for the fail-closed warning. */
  unsupportedFields: string[];
}

/** Evaluates saved queries against traces in memory, mirroring the CH compiler. */
export class TraceQueryEvaluationService {
  readonly #fields: TraceQueryFieldsService;
  readonly #evaluationScope: TraceQueryEvaluationScopeService;
  readonly #translation: TraceQueryTranslationService;

  static create({
    fields,
    evaluationScope,
    translation,
  }: {
    fields: TraceQueryFieldsService;
    evaluationScope: TraceQueryEvaluationScopeService;
    translation: TraceQueryTranslationService;
  }): TraceQueryEvaluationService {
    return new TraceQueryEvaluationService(fields, evaluationScope, translation);
  }

  private constructor(
    fields: TraceQueryFieldsService,
    evaluationScope: TraceQueryEvaluationScopeService,
    translation: TraceQueryTranslationService,
  ) {
    this.#fields = fields;
    this.#evaluationScope = evaluationScope;
    this.#translation = translation;
  }

  /**
   * Evaluates a query against an in-memory trace, fail-closed on any error.
   */
  traceMatchesQuery(queryText: string, trace: InMemoryTrace): boolean {
    // Reuse the compiler as the validation gate — it enforces the exact
    // MAX_FILTER_NODE_COUNT / MAX_PARAM_COUNT caps, rejects invalid syntax, and throws
    // FilterFieldUnknownError for unknown fields. Anything it rejects fails closed.
    let compiled: { sql: string; params: Record<string, unknown> } | null;
    try {
      compiled = this.#translation.translateFilter({
        queryText,
        tenantId: "__in_memory__",
        timeRange: { from: 0, to: 0 },
      });
    } catch {
      return false;
    }

    // `null` means no filter (empty / whitespace) — every trace matches.
    if (compiled === null) {
      return true;
    }

    let ast: LiqeQuery;
    try {
      ast = parseTraceQuerySyntax(normalizeQuery(queryText));
    } catch {
      return false;
    }

    const state: WalkState = { nodeCount: 0, unsupportedFields: [] };
    const result = this.#evaluateNode({
      node: ast,
      negated: false,
      trace,
      state,
    });

    // A field that can never evaluate positively at dispatch (span-scoped
    // fields, size, scenario dimensions) compiles to valid SQL and passes the
    // save-time gate, so the query looks healthy — it just fails closed on
    // every trace forever, silently never firing. Rejecting at save time vs.
    // making it evaluable is a product call; until then, make the silence audible.
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

  traceQueryFieldNeeds(queryText: string): Set<FieldNeeds> {
    const needs = new Set<FieldNeeds>();
    let ast: LiqeQuery;
    try {
      ast = parseTraceQuerySyntax(normalizeQuery(queryText));
    } catch {
      return needs;
    }

    collectQueryNeeds({ node: ast, needs, fieldDefs: this.#fields.fieldDefByName });

    return needs;
  }

  #evaluateNode({
    node,
    negated,
    trace,
    state,
  }: {
    node: LiqeQuery;
    negated: boolean;
    trace: InMemoryTrace;
    state: WalkState;
  }): boolean | Unsupported {
    state.nodeCount++;
    if (state.nodeCount > MAX_FILTER_NODE_COUNT) {
      return UNSUPPORTED;
    }

    switch (node.type) {
      case "EmptyExpression":
        return true;

      case "Tag": {
        const tag = node as TagToken;
        const result = evaluateTraceTag({
          tag,
          negated,
          trace,
          fieldDefs: this.#fields.fieldDefByName,
        });
        if (result === UNSUPPORTED && tag.field.type !== "ImplicitField") {
          state.unsupportedFields.push(tag.field.name);
        }

        return result;
      }

      case "LogicalExpression":
        return this.#evaluateLogical({
          node: node as LogicalExpressionToken,
          negated,
          trace,
          state,
        });

      case "UnaryOperator": {
        const unary = node as UnaryOperatorToken;
        const isNeg = unary.operator === "NOT" || unary.operator === "-";

        return this.#evaluateNode({
          node: unary.operand,
          negated: negated !== isNeg,
          trace,
          state,
        });
      }

      case "ParenthesizedExpression": {
        const paren = node as ParenthesizedExpressionToken;

        return this.#evaluateNode({
          node: paren.expression,
          negated,
          trace,
          state,
        });
      }

      default:
        return UNSUPPORTED;
    }
  }

  /**
   * Negation threads down unchanged and the operator stays as-is: the exact shape
   * `translateNode` compiles, so both sides always agree.
   */
  #evaluateLogical({
    node,
    negated,
    trace,
    state,
  }: {
    node: LogicalExpressionToken;
    negated: boolean;
    trace: InMemoryTrace;
    state: WalkState;
  }): boolean | Unsupported {
    // An AND chain is read once from its top, binding an evaluator to its
    // result conditions exactly as `translateNode` does.
    const chain = negated || node.operator.operator === "OR" ? null : buildAndChain(node);
    if (chain) return this.#evaluateAndChain({ chain, trace, state });
    const left = this.#evaluateNode({ node: node.left, negated, trace, state });
    if (left === UNSUPPORTED) return UNSUPPORTED;
    const right = this.#evaluateNode({ node: node.right, negated, trace, state });
    if (right === UNSUPPORTED) return UNSUPPORTED;
    return node.operator.operator === "OR" ? left || right : left && right;
  }

  /** Mirrors `translateAndChain`: the bound group, ANDed with the rest. */
  #evaluateAndChain({
    chain,
    trace,
    state,
  }: {
    chain: AndChain;
    trace: InMemoryTrace;
    state: WalkState;
  }): boolean | Unsupported {
    state.nodeCount += chain.nodeCount - 1;
    if (state.nodeCount > MAX_FILTER_NODE_COUNT) return UNSUPPORTED;
    let matched = true;
    if (chain.scope) {
      const bound = this.#evaluationScope.evaluateEvaluationScope(chain.scope, trace);
      if (bound === UNSUPPORTED) {
        state.unsupportedFields.push("evaluator");
        return UNSUPPORTED;
      }
      matched = bound;
    }
    for (const operand of chain.rest) {
      const result = this.#evaluateNode({ node: operand, negated: false, trace, state });
      if (result === UNSUPPORTED) return UNSUPPORTED;
      matched = matched && result;
    }
    return matched;
  }
}
