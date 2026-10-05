import {
  EVALUATOR_FIELD,
  EVALUATOR_LABEL_FIELD,
  EVALUATOR_SCORE_FIELD,
  EVALUATOR_VERDICT_FIELD,
  type InMemoryTrace,
  type LiqeQuery,
  type LogicalExpressionToken,
  type TagToken,
  type TraceQueryEvaluationRun,
  type TranslationContext,
  type UnaryOperatorToken,
  UNSUPPORTED,
  type Unsupported,
} from "@langwatch/trace-contract";

import { expressionFacet, FIELD_DEF_BY_NAME } from "./trace-query-fields.rules.ts";
import { latestEvaluationRunsSubquery } from "./trace-query-subquery.rules.ts";
import {
  numericComparisonHandler,
  stringEqualityHandler,
} from "./trace-query-translators.rules.ts";
import { extractStringValue, nextParam, validateValueLength } from "./trace-query-values.rules.ts";

// Binds an evaluator's result to that evaluator: in one AND chain naming
// exactly one evaluator X, `evaluatorVerdict:fail` means "X failed", not "X
// ran and something failed". Kept conditions hold together on one run of X
// (several values of one categorical field are alternatives); an excluded one
// holds on no run of X. Parentheses end a chain; two evaluators stay unbound.

/** The result fields a named evaluator binds, each with its facet key. */
const SCOPED_FACET_KEY_BY_FIELD: ReadonlyMap<string, string> = new Map([
  [EVALUATOR_VERDICT_FIELD, "evaluatorVerdict"],
  [EVALUATOR_SCORE_FIELD, "evaluatorScore"],
  [EVALUATOR_LABEL_FIELD, "evaluatorLabel"],
  ["evaluatorStatus", "evaluatorStatus"],
  ["evaluatorPassed", "evaluatorVerdict"],
]);

/** A result condition bound to the evaluator, kept or excluded. */
interface ScopedCondition {
  /** The chain operand: the tag, or the NOT around it. */
  node: LiqeQuery;
  tag: TagToken;
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
  /** Absent when the chain names no evaluator, more than one, or no result. */
  scope?: EvaluationScope;
  /** The operands outside the group, compiled as they always were. */
  rest: LiqeQuery[];
  /** AST nodes the chain's AND nodes and the bound group span. */
  nodeCount: number;
}

interface KeptGroup {
  conditions: ScopedCondition[];
  anyOf: boolean;
}

/** Whether `node` roots an AND chain {@link readAndChain} can read. */
export function isAndChain(node: LogicalExpressionToken): boolean {
  return node.operator.operator !== "OR";
}

/**
 * The AND chain rooted at `node`. A chain's binding is decided once, here:
 * callers walk `rest` without re-reading its nested ANDs as chains.
 */
export function readAndChain(node: LogicalExpressionToken): AndChain {
  const operands = andOperands(node);
  const andNodes = operands.length - 1;
  const anchors = operands.filter(isAnchor);
  const conditions = operands.flatMap(scopedConditionsOf);
  if (anchors.length !== 1 || conditions.length === 0) {
    return { rest: operands, nodeCount: andNodes };
  }

  const scope: EvaluationScope = { anchor: anchors[0] as TagToken, conditions };
  const bound = new Set<LiqeQuery>([scope.anchor, ...scope.conditions.map((c) => c.node)]);
  const boundNodes = scope.conditions.reduce((sum, c) => sum + c.nodeCount, 1);
  return {
    scope,
    rest: operands.filter((operand) => !bound.has(operand)),
    nodeCount: andNodes + boundNodes,
  };
}

/** The bound group as `evaluation_runs` subqueries over X's latest rows. */
export function translateEvaluationScope(scope: EvaluationScope, ctx: TranslationContext): string {
  const evaluatorId = extractStringValue(scope.anchor);
  validateValueLength(evaluatorId);
  const p = nextParam(ctx, "evaluatorId");
  ctx.params[p] = evaluatorId;

  const runsOfX = (predicates: string[]): string =>
    latestEvaluationRunsSubquery({
      timeCol: "ScheduledAt",
      scopeWhere: `EvaluatorId = {${p}:String}`,
      innerWhere: predicates.length > 0 ? predicates.join(" AND ") : "1 = 1",
    });

  const keptSql = keptGroups(scope).map(({ conditions, anyOf }) => {
    const joined = conditions.map((c) => conditionSql(c, ctx)).join(anyOf ? " OR " : " AND ");
    return conditions.length > 1 ? `(${joined})` : joined;
  });
  const excluded = scope.conditions.filter((c) => c.negated);
  return [runsOfX(keptSql), ...excluded.map((c) => `NOT ${runsOfX([conditionSql(c, ctx)])}`)].join(
    " AND ",
  );
}

/**
 * The bound group in memory, mirroring {@link translateEvaluationScope}. Each
 * condition reuses its field's own predicate over one evaluation.
 */
export function evaluateEvaluationScope(
  scope: EvaluationScope,
  trace: InMemoryTrace,
): boolean | Unsupported {
  if (trace.evaluations == null) return UNSUPPORTED;
  const evaluatorId = extractStringValue(scope.anchor);
  const runsOfX = trace.evaluations.filter((evaluation) => evaluation.evaluatorId === evaluatorId);
  const holds = (evaluation: TraceQueryEvaluationRun, c: ScopedCondition) =>
    FIELD_DEF_BY_NAME.get(c.field)?.evaluateInMemory(c.tag, false, {
      ...trace,
      evaluations: [evaluation],
    }) === true;

  const groups = keptGroups(scope);
  const excluded = scope.conditions.filter((c) => c.negated);
  return (
    runsOfX.some((evaluation) =>
      groups.every(({ conditions, anyOf }) =>
        anyOf
          ? conditions.some((c) => holds(evaluation, c))
          : conditions.every((c) => holds(evaluation, c)),
      ),
    ) && !excluded.some((c) => runsOfX.some((evaluation) => holds(evaluation, c)))
  );
}

/** Kept conditions grouped by facet: categorical groups are alternatives. */
function keptGroups(scope: EvaluationScope): KeptGroup[] {
  const groups = new Map<string, KeptGroup>();
  for (const condition of scope.conditions) {
    if (condition.negated) continue;
    const facet = scopedFacet(condition.field);
    const group = groups.get(facet.key) ?? { conditions: [], anyOf: facet.kind !== "range" };
    group.conditions.push(condition);
    groups.set(facet.key, group);
  }
  return [...groups.values()];
}

/**
 * A condition's predicate on one `evaluation_runs` row, in its kept form: an
 * excluded condition is applied by excluding the rows it matches.
 */
function conditionSql({ tag, field }: ScopedCondition, ctx: TranslationContext): string {
  const facet = scopedFacet(field);
  const handler =
    facet.kind === "range"
      ? numericComparisonHandler(facet.expression, facet.key)
      : stringEqualityHandler(facet.expression, facet.key);
  return handler(tag, false, ctx);
}

function scopedFacet(field: string) {
  return expressionFacet(SCOPED_FACET_KEY_BY_FIELD.get(field) ?? field);
}

/** The operands of an AND chain, without looking inside parentheses. */
function andOperands(node: LiqeQuery): LiqeQuery[] {
  if (node.type !== "LogicalExpression") return [node];
  const logExpr = node as LogicalExpressionToken;
  if (logExpr.operator.operator === "OR") return [node];
  return [...andOperands(logExpr.left), ...andOperands(logExpr.right)];
}

function isAnchor(node: LiqeQuery): boolean {
  const tag = node as TagToken;
  return (
    node.type === "Tag" && tag.field.type !== "ImplicitField" && tag.field.name === EVALUATOR_FIELD
  );
}

/** The operand as a bound result condition: one, or none when it is not one. */
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
  if (tag.field.type === "ImplicitField") return [];
  const field = tag.field.name;
  return SCOPED_FACET_KEY_BY_FIELD.has(field) ? [{ tag, field, ...shape }] : [];
}
