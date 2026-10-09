import {
  EVALUATOR_FIELD,
  EVALUATOR_LABEL_FIELD,
  EVALUATOR_SCORE_FIELD,
  EVALUATOR_VERDICT_FIELD,
  type LiqeQuery,
  type LogicalExpressionToken,
  type TagToken,
  type UnaryOperatorToken,
} from "@langwatch/trace-contract";

/**
 * Binds an evaluator's result to that evaluator: within one AND chain naming
 * exactly one evaluator, its verdict, score and label conditions hold on that
 * evaluator's own latest runs.
 * @see https://github.com/langwatch/tasks/issues/918
 */

/**
 * The result fields a named evaluator binds, keyed by field name, each with
 * the facet its SQL expression comes from. `evaluatorStatus` is typed by hand;
 * `evaluatorPassed` is the old name of `evaluatorVerdict`.
 */
export const SCOPED_FACET_KEY_BY_FIELD: ReadonlyMap<string, string> = new Map([
  [EVALUATOR_VERDICT_FIELD, "evaluatorVerdict"],
  [EVALUATOR_SCORE_FIELD, "evaluatorScore"],
  [EVALUATOR_LABEL_FIELD, "evaluatorLabel"],
  ["evaluatorStatus", "evaluatorStatus"],
  ["evaluatorPassed", "evaluatorVerdict"],
]);

/** A result condition bound to the evaluator, kept or excluded. */
export interface ScopedCondition {
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
 * The AND chain rooted at `node`, which must not be an OR. Callers walk
 * `rest` without re-reading its nested AND nodes as chains of their own: a
 * chain's binding is decided once, here.
 */
export function buildAndChain(node: LogicalExpressionToken): AndChain {
  const operands = andOperands(node);
  const andNodes = operands.length - 1;
  const anchors = operands.filter(isAnchor);
  const conditions = anchors.length === 1 ? operands.flatMap(scopedConditionsOf) : [];
  if (conditions.length === 0) return { scope: null, rest: operands, nodeCount: andNodes };

  const scope: EvaluationScope = { anchor: anchors[0] as TagToken, conditions };

  const bound = new Set<LiqeQuery>([scope.anchor]);
  for (const condition of scope.conditions) bound.add(condition.node);
  const boundNodes = scope.conditions.reduce((sum, c) => sum + c.nodeCount, 1);
  return {
    scope,
    rest: operands.filter((operand) => !bound.has(operand)),
    nodeCount: andNodes + boundNodes,
  };
}

/** The operands of an AND chain, without looking inside parentheses. */
function andOperands(node: LiqeQuery): LiqeQuery[] {
  if (node.type !== "LogicalExpression") return [node];
  const logExpr = node as LogicalExpressionToken;
  if (logExpr.operator.operator === "OR") return [node];
  return [...andOperands(logExpr.left), ...andOperands(logExpr.right)];
}

function isAnchor(node: LiqeQuery): boolean {
  return node.type === "Tag" && fieldNameOf(node as TagToken) === EVALUATOR_FIELD;
}

/** The operand as a bound condition: none, or the one it is. */
function scopedConditionsOf(node: LiqeQuery): ScopedCondition[] {
  if (node.type === "Tag") {
    return conditionsOn(node as TagToken, { node, negated: false, nodeCount: 1 });
  }
  if (node.type !== "UnaryOperator") return [];
  const unary = node as UnaryOperatorToken;
  const isNeg = unary.operator === "NOT" || unary.operator === "-";
  if (!isNeg || unary.operand.type !== "Tag") return [];
  return conditionsOn(unary.operand as TagToken, { node, negated: true, nodeCount: 2 });
}

function conditionsOn(
  tag: TagToken,
  shape: Pick<ScopedCondition, "node" | "negated" | "nodeCount">,
): ScopedCondition[] {
  const field = fieldNameOf(tag);
  return SCOPED_FACET_KEY_BY_FIELD.has(field) ? [{ tag, field, ...shape }] : [];
}

/** The tag's field name, empty for a bare search word. */
function fieldNameOf(tag: TagToken): string {
  return tag.field.type === "ImplicitField" ? "" : tag.field.name;
}
