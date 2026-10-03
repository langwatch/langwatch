import type {
  LiqeQuery,
  LogicalExpressionToken,
  TagToken,
  UnaryOperatorToken,
} from "liqe";
import type { EvaluationRunData } from "../../evaluations/types";
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
import { latestEvaluationRunsSubquery } from "./subqueries";
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
 * exactly one evaluator, the result conditions next to it are judged against
 * X's own evaluations:
 *
 * - the conditions kept must all hold on one evaluation of X;
 * - a condition excluded with NOT must hold on no evaluation of X, so
 *   excluding `fail` hides a trace where any run of X failed.
 *
 * The chain is read once, from its top, so word order never changes the
 * result. It stops at parentheses: `(evaluator:X AND …) AND (evaluator:Y AND …)`
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

/** A result condition bound to the evaluator, kept or excluded. */
interface ScopedCondition {
  /** The chain operand: the tag, or the NOT around it. */
  node: LiqeQuery;
  tag: TagToken;
  /** The tag's field, one of {@link SCOPED_FACET_KEY_BY_FIELD}'s keys. */
  field: string;
  negated: boolean;
  /** AST nodes this condition spans: the tag, plus its NOT when negated. */
  nodeCount: number;
}

/** The evaluator and the result conditions bound to it. */
export interface EvaluationScope {
  anchor: TagToken;
  conditions: ScopedCondition[];
}

/** One AND chain, flattened, with its evaluator group when it has one. */
export interface AndChain {
  /** Null when the chain names no evaluator, more than one, or no result. */
  scope: EvaluationScope | null;
  /** The operands outside the group, compiled as they always were. */
  rest: LiqeQuery[];
  /**
   * AST nodes the chain's AND nodes and the bound group span, so the
   * complexity ceiling counts exactly what the tag-by-tag walk counted.
   */
  nodeCount: number;
}

/**
 * The AND chain rooted at `node`, or null when `node` is an OR. Callers walk
 * `rest` without re-reading its nested AND nodes as chains of their own: a
 * chain's binding is decided once, here.
 */
export function andChainOf(node: LogicalExpressionToken): AndChain | null {
  if (node.operator.operator === "OR") return null;
  const operands = andOperands(node);
  const andNodes = operands.length - 1;
  const scope = scopeOf(operands);
  if (!scope) return { scope: null, rest: operands, nodeCount: andNodes };

  const bound = new Set<LiqeQuery>([scope.anchor]);
  for (const condition of scope.conditions) bound.add(condition.node);
  const boundNodes = scope.conditions.reduce((sum, c) => sum + c.nodeCount, 1);
  return {
    scope,
    rest: operands.filter((operand) => !bound.has(operand)),
    nodeCount: andNodes + boundNodes,
  };
}

/** The bound group as `evaluation_runs` subqueries over X's latest rows. */
export function translateEvaluationScope(
  scope: EvaluationScope,
  ctx: TranslationContext,
): string {
  const evaluatorId = extractStringValue(scope.anchor);
  validateValueLength(evaluatorId);
  const p = nextParam(ctx, "evaluatorId");
  ctx.params[p] = evaluatorId;

  const runsOfX = (predicates: string[]): string =>
    latestEvaluationRunsSubquery({
      timeCol: TABLE_TIME_COLUMNS.evaluation_runs,
      scopeWhere: `EvaluatorId = {${p}:String}`,
      innerWhere: predicates.length > 0 ? predicates.join(" AND ") : "1 = 1",
    });

  const kept = scope.conditions.filter((c) => !c.negated);
  const excluded = scope.conditions.filter((c) => c.negated);
  return [
    runsOfX(kept.map((c) => conditionSql(c, ctx))),
    ...excluded.map((c) => `NOT ${runsOfX([conditionSql(c, ctx)])}`),
  ].join(" AND ");
}

/**
 * The bound group in memory, mirroring {@link translateEvaluationScope}. Each
 * condition reuses its field's own in-memory predicate over one evaluation, so
 * the two sides keep reading values the same way.
 */
export function evaluateEvaluationScope(
  scope: EvaluationScope,
  trace: InMemoryTrace,
): boolean | Unsupported {
  if (trace.evaluations == null) return UNSUPPORTED;
  const evaluatorId = extractStringValue(scope.anchor);
  const runsOfX = trace.evaluations.filter(
    (evaluation) => evaluation.evaluatorId === evaluatorId,
  );
  const holds = (evaluation: EvaluationRunData, c: ScopedCondition) =>
    FIELD_DEF_BY_NAME.get(c.field)?.evaluateInMemory(c.tag, false, {
      ...trace,
      evaluations: [evaluation],
    }) === true;

  const kept = scope.conditions.filter((c) => !c.negated);
  const excluded = scope.conditions.filter((c) => c.negated);
  return (
    runsOfX.some((evaluation) => kept.every((c) => holds(evaluation, c))) &&
    excluded.every((c) => !runsOfX.some((evaluation) => holds(evaluation, c)))
  );
}

/**
 * A condition's predicate on one `evaluation_runs` row, always in its kept
 * form: an excluded condition is applied by excluding the rows it matches. A
 * NULL column (no score, no label) matches no row either way.
 */
function conditionSql(
  { tag, field }: ScopedCondition,
  ctx: TranslationContext,
): string {
  const facet = scopedFacet(field);
  return facet.kind === "range"
    ? translateNumericField(facet.expression, tag, false, ctx, facet.key)
    : translateStringField(facet.expression, tag, false, ctx, facet.key);
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

/** The chain's single evaluator and the result conditions beside it. */
function scopeOf(operands: LiqeQuery[]): EvaluationScope | null {
  const anchors = operands.filter(isAnchor);
  if (anchors.length !== 1) return null;
  const conditions = operands.flatMap((operand) => {
    const condition = scopedCondition(operand);
    return condition ? [condition] : [];
  });
  if (conditions.length === 0) return null;
  return { anchor: anchors[0] as TagToken, conditions };
}

function isAnchor(node: LiqeQuery): boolean {
  return node.type === "Tag" && fieldOf(node as TagToken) === EVALUATOR_FIELD;
}

function scopedCondition(node: LiqeQuery): ScopedCondition | null {
  if (node.type === "Tag") {
    return conditionOn(node as TagToken, {
      node,
      negated: false,
      nodeCount: 1,
    });
  }
  if (node.type !== "UnaryOperator") return null;
  const unary = node as UnaryOperatorToken;
  const isNeg = unary.operator === "NOT" || unary.operator === "-";
  if (!isNeg || unary.operand.type !== "Tag") return null;
  return conditionOn(unary.operand as TagToken, {
    node,
    negated: true,
    nodeCount: 2,
  });
}

function conditionOn(
  tag: TagToken,
  shape: Pick<ScopedCondition, "node" | "negated" | "nodeCount">,
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
