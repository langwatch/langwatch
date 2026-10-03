import type {
  LiqeQuery,
  LogicalExpressionToken,
  TagToken,
  UnaryOperatorToken,
} from "liqe";
import {
  type ExpressionCategoricalDef,
  FACET_REGISTRY,
  type RangeFacetDef,
  TABLE_TIME_COLUMNS,
} from "../facet-registry";
import { FIELD_DEF_BY_NAME } from "./build-handlers";
import { type InMemoryTrace, UNSUPPORTED, type Unsupported } from "./field-def";
import {
  translateNumericField,
  translateStringField,
} from "./generic-translators";
import { boundedSubquery } from "./subqueries";
import {
  extractStringValue,
  nextParam,
  type TranslationContext,
  validateValueLength,
} from "./value-helpers";

/**
 * Binding an evaluator's result to that evaluator.
 *
 * `evaluator:X AND evaluatorVerdict:fail` reads as "X failed", and the
 * sidebar drilldown, the query examples and the AI search prompt all write it
 * that way. Compiled tag by tag, though, each half is its own trace-level
 * subquery and the pair means "X ran, and some evaluation failed" — a trace
 * where X passed and Y failed matches. So within one AND chain that names
 * exactly one evaluator, the result conditions next to it are compiled into
 * the same `evaluation_runs` row as the evaluator.
 *
 * The chain stops at parentheses: `(evaluator:X AND …) AND (evaluator:Y AND …)`
 * is two chains, one per group, which is the shape the drilldown emits for two
 * evaluators. Two evaluators in one flat chain are ambiguous and stay unbound,
 * as does a result condition with no evaluator next to it.
 *
 * @see https://github.com/langwatch/tasks/issues/918
 */

/** The evaluator anchor field. */
const EVALUATOR_FIELD = "evaluator";

/**
 * The result fields a named evaluator binds, keyed by field name, each with
 * the facet its SQL expression comes from (`evaluatorPassed` is the old name
 * of `evaluatorVerdict`).
 */
const SCOPED_FACET_KEY_BY_FIELD: ReadonlyMap<string, string> = new Map([
  ["evaluatorStatus", "evaluatorStatus"],
  ["evaluatorVerdict", "evaluatorVerdict"],
  ["evaluatorScore", "evaluatorScore"],
  ["evaluatorLabel", "evaluatorLabel"],
  ["evaluatorPassed", "evaluatorVerdict"],
]);

const SCOPED_TABLE = "evaluation_runs";

/** A result condition bound to the evaluator, with the polarity it holds under. */
interface ScopedCondition {
  tag: TagToken;
  /** The tag's field, one of {@link SCOPED_FACET_KEY_BY_FIELD}'s keys. */
  field: string;
  negated: boolean;
  /** AST nodes this condition spans: the tag, plus its NOT when negated. */
  nodeCount: number;
}

/** One AND chain, split into the bound evaluator group and everything else. */
export interface EvaluationScope {
  anchor: TagToken;
  conditions: ScopedCondition[];
  /** The chain's other operands, compiled as they always were. */
  rest: LiqeQuery[];
  /**
   * AST nodes the bound group and the chain's own AND nodes span, so the
   * complexity ceiling counts exactly what the tag-by-tag walk counted.
   */
  nodeCount: number;
}

/**
 * The evaluator group of an AND chain, or null when the chain names no
 * evaluator, more than one, or no result condition to bind to it.
 */
export function evaluationScopeOf(
  node: LogicalExpressionToken,
): EvaluationScope | null {
  const operands = andOperands(node);
  const anchors = operands.filter(isAnchor);
  if (anchors.length !== 1) return null;
  const anchor = anchors[0] as TagToken;

  const conditions: ScopedCondition[] = [];
  const rest: LiqeQuery[] = [];
  for (const operand of operands) {
    if (operand === anchor) continue;
    const condition = scopedCondition(operand);
    if (condition) conditions.push(condition);
    else rest.push(operand);
  }
  if (conditions.length === 0) return null;

  const andNodes = operands.length - 1;
  const boundNodes = conditions.reduce((sum, c) => sum + c.nodeCount, 1);
  return { anchor, conditions, rest, nodeCount: andNodes + boundNodes };
}

/** The bound group as one `evaluation_runs` subquery. */
export function translateEvaluationScope(
  scope: EvaluationScope,
  ctx: TranslationContext,
): string {
  const evaluatorId = extractStringValue(scope.anchor);
  validateValueLength(evaluatorId);
  const p = nextParam(ctx, "evaluatorId");
  ctx.params[p] = evaluatorId;

  const predicates = [
    `EvaluatorId = {${p}:String}`,
    ...scope.conditions.map((condition) => conditionSql(condition, ctx)),
  ];
  return boundedSubquery(
    SCOPED_TABLE,
    TABLE_TIME_COLUMNS[SCOPED_TABLE],
    predicates.join(" AND "),
  );
}

/**
 * The bound group in memory: some evaluation of the named evaluator meets
 * every condition. Each condition reuses its field's own in-memory predicate
 * over that one evaluation, so the two sides keep reading values the same way.
 */
export function evaluateEvaluationScope(
  scope: EvaluationScope,
  trace: InMemoryTrace,
): boolean | Unsupported {
  if (trace.evaluations == null) return UNSUPPORTED;
  const evaluatorId = extractStringValue(scope.anchor);
  return trace.evaluations.some(
    (evaluation) =>
      evaluation.evaluatorId === evaluatorId &&
      scope.conditions.every(({ tag, field, negated }) => {
        const def = FIELD_DEF_BY_NAME.get(field);
        return (
          def?.evaluateInMemory(tag, negated, {
            ...trace,
            evaluations: [evaluation],
          }) === true
        );
      }),
  );
}

/**
 * A condition's predicate on one `evaluation_runs` row. A NULL column (no
 * score, no label) fails a positive condition and passes a negated one, which
 * is how the tag-by-tag form and the in-memory reads already treat a missing
 * value.
 */
function conditionSql(
  { tag, field, negated }: ScopedCondition,
  ctx: TranslationContext,
): string {
  const facet = scopedFacet(field);
  const positive =
    facet.kind === "range"
      ? translateNumericField(facet.expression, tag, false, ctx, facet.key)
      : translateStringField(facet.expression, tag, false, ctx, facet.key);
  return negated ? `NOT ifNull(${positive}, 0)` : positive;
}

function scopedFacet(field: string): ExpressionCategoricalDef | RangeFacetDef {
  const key = SCOPED_FACET_KEY_BY_FIELD.get(field);
  const facet = FACET_REGISTRY.find((def) => def.key === key);
  if (!facet || !("expression" in facet)) {
    throw new Error(`facet for '${field}' has no expression to bind`);
  }
  return facet;
}

/** The operands of an AND chain, without looking inside parentheses. */
function andOperands(node: LiqeQuery): LiqeQuery[] {
  if (node.type !== "LogicalExpression") return [node];
  const logExpr = node as LogicalExpressionToken;
  if (logExpr.operator.operator === "OR") return [node];
  return [...andOperands(logExpr.left), ...andOperands(logExpr.right)];
}

function isAnchor(node: LiqeQuery): boolean {
  return node.type === "Tag" && fieldOf(node as TagToken) === EVALUATOR_FIELD;
}

function scopedCondition(node: LiqeQuery): ScopedCondition | null {
  if (node.type === "Tag") {
    return conditionOn(node as TagToken, { negated: false, nodeCount: 1 });
  }
  if (node.type !== "UnaryOperator") return null;
  const unary = node as UnaryOperatorToken;
  const isNeg = unary.operator === "NOT" || unary.operator === "-";
  if (!isNeg || unary.operand.type !== "Tag") return null;
  return conditionOn(unary.operand as TagToken, {
    negated: true,
    nodeCount: 2,
  });
}

function conditionOn(
  tag: TagToken,
  shape: Pick<ScopedCondition, "negated" | "nodeCount">,
): ScopedCondition | null {
  const field = fieldOf(tag);
  return field !== null && SCOPED_FACET_KEY_BY_FIELD.has(field)
    ? { tag, field, ...shape }
    : null;
}

/** The tag's field name, or null for a bare search word. */
function fieldOf(tag: TagToken): string | null {
  return tag.field.type === "ImplicitField" ? null : tag.field.name;
}
