import {
  type FieldHandler,
  FilterParseError,
  FilterTooComplexError,
  MAX_FILTER_NODE_COUNT,
  type LiqeQuery,
  type LogicalExpressionToken,
  type ParenthesizedExpressionToken,
  parseTraceQuerySyntax,
  type TagToken,
  type UnaryOperatorToken,
  type TranslationContext,
} from "@langwatch/trace-contract";

import {
  type AndChain,
  buildAndChain,
  type EvaluationScope,
} from "./trace-query-evaluation-scope.rules.ts";
import {
  EVENT_ATTRIBUTE_PREFIX,
  EVENT_ATTRIBUTE_PREFIX_LEGACY,
  MAX_VALUE_LENGTH,
  SPAN_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
  extractStringValue,
} from "./trace-query-values.rules.ts";

const MAX_PARAM_COUNT = 50;

/**
 * How many free-text terms the transcript-content search will carry. A
 * handful is a search; dozens is a scan of `log_records` wearing a query's
 * clothes, and the trace-level filter still applies every one of them.
 */
const MAX_CONTENT_TERMS = 8;

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

/**
 * How the walker joins what the tags compile to: SQL text for the text dialects, builder
 * conditions for a built read. `group` is a parenthesis, which only text spells.
 */
export interface FilterLogic<T> {
  always: () => T;
  and: (left: T, right: T) => T;
  or: (left: T, right: T) => T;
  group: (inner: T) => T;
}

/** The text dialects' joins, byte for byte what the walker always wrote. */
export const TEXT_FILTER_LOGIC: FilterLogic<string> = {
  always: () => "1 = 1",
  and: (left, right) => `(${left} AND ${right})`,
  or: (left, right) => `(${left} OR ${right})`,
  group: (inner) => `(${inner})`,
};

type TagTranslator<T> = (tag: TagToken, negated: boolean, ctx: TranslationContext) => T;
type ScopeTranslator<T> = (scope: EvaluationScope, ctx: TranslationContext) => T;

function translateNode<T>({
  node,
  negated,
  ctx,
  translateTag,
  translateScope,
  logic,
}: {
  node: LiqeQuery;
  negated: boolean;
  ctx: TranslationContext;
  translateTag: TagTranslator<T>;
  translateScope: ScopeTranslator<T> | undefined;
  logic: FilterLogic<T>;
}): T {
  ctx.nodeCount++;
  if (ctx.nodeCount > MAX_FILTER_NODE_COUNT) {
    throw new FilterTooComplexError({ maxNodes: MAX_FILTER_NODE_COUNT });
  }

  const branch = (side: LiqeQuery, sideNegated: boolean): T =>
    translateNode({ node: side, negated: sideNegated, ctx, translateTag, translateScope, logic });

  switch (node.type) {
    case "EmptyExpression":
      return logic.always();

    case "Tag":
      return translateTag(node as TagToken, negated, ctx);

    case "LogicalExpression": {
      const logExpr = node as LogicalExpressionToken;
      const chain =
        translateScope && !negated && logExpr.operator.operator !== "OR"
          ? buildAndChain(logExpr)
          : null;
      if (chain && translateScope) {
        return translateAndChain({ chain, ctx, branch, translateScope, logic });
      }
      // A negation reaches both sides with the operator kept: main's rows, De Morgan or not.
      const join = logExpr.operator.operator === "OR" ? logic.or : logic.and;
      return join(branch(logExpr.left, negated), branch(logExpr.right, negated));
    }

    case "UnaryOperator": {
      const unary = node as UnaryOperatorToken;
      const isNeg = unary.operator === "NOT" || unary.operator === "-";
      return branch(unary.operand, negated !== isNeg);
    }

    case "ParenthesizedExpression": {
      const paren = node as ParenthesizedExpressionToken;
      return logic.group(branch(paren.expression, negated));
    }

    default:
      throw new FilterParseError(`Unsupported query syntax: ${(node as { type: string }).type}`);
  }
}

/**
 * An AND chain read once from its top: the bound evaluator group, if any, as
 * one condition, ANDed with the chain's other operands walked as usual. The
 * operands are folded left, the shape the parser gave the chain.
 */
function translateAndChain<T>({
  chain,
  ctx,
  branch,
  translateScope,
  logic,
}: {
  chain: AndChain;
  ctx: TranslationContext;
  branch: (side: LiqeQuery, sideNegated: boolean) => T;
  translateScope: ScopeTranslator<T>;
  logic: FilterLogic<T>;
}): T {
  // The chain's own node is already counted; its nested AND nodes and the
  // bound group are not walked, so they are counted here.
  ctx.nodeCount += chain.nodeCount - 1;
  if (ctx.nodeCount > MAX_FILTER_NODE_COUNT) {
    throw new FilterTooComplexError({ maxNodes: MAX_FILTER_NODE_COUNT });
  }
  const parts = [
    ...(chain.scope ? [translateScope(chain.scope, ctx)] : []),
    ...chain.rest.map((operand) => branch(operand, false)),
  ];
  const [first = logic.always(), ...others] = parts;
  if (others.length === 0) return logic.group(first);
  return others.reduce((acc, part) => logic.and(acc, part), first);
}

/** Which table a namespaced attribute field reads its key on. */
export type AttributeTarget = "trace" | "span" | "event";

/**
 * The attribute a namespaced field names. `trace.attribute.<k>` and `span.attribute.<k>` are
 * canonical; `attribute.<k>` and `event.<k>` (one dot) stay as aliases for saved queries, and
 * the bare `event` field keeps routing to the static handler map.
 */
export function attributeTargetOf(
  fieldName: string,
): { kind: "attribute"; key: string; target: AttributeTarget } | { kind: "field" } {
  const routes: [string, AttributeTarget][] = [
    [TRACE_ATTRIBUTE_PREFIX, "trace"],
    [SPAN_ATTRIBUTE_PREFIX, "span"],
    [EVENT_ATTRIBUTE_PREFIX, "event"],
    [TRACE_ATTRIBUTE_PREFIX_LEGACY, "trace"],
    [EVENT_ATTRIBUTE_PREFIX_LEGACY, "event"],
  ];
  for (const [prefix, target] of routes) {
    if (prefix === EVENT_ATTRIBUTE_PREFIX_LEGACY && fieldName === "event") continue;
    if (fieldName.startsWith(prefix)) {
      return { kind: "attribute", key: fieldName.slice(prefix.length), target };
    }
  }
  return { kind: "field" };
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

/** What a walk compiled: nothing for an empty query, else the compiled filter. */
export type FilterWalk<T> = { kind: "empty" } | { kind: "compiled"; compiled: T };

/**
 * The language's boolean structure, compiled with the tag translator and joins
 * given: a second dialect over other tables supplies its own `translateTag`,
 * a built read its conditions. Parameters land on `ctx.params`.
 */
export function walkFilterAst<T>({
  queryText,
  ctx,
  translateTag,
  translateScope,
  logic,
}: {
  queryText: string;
  ctx: TranslationContext;
  translateTag: TagTranslator<T>;
  /**
   * Compile an evaluator and the result conditions beside it as one
   * evaluation. Only the `trace_summaries` dialect has the evaluator fields.
   */
  translateScope?: ScopeTranslator<T>;
  logic: FilterLogic<T>;
}): FilterWalk<T> {
  const trimmed = normalizeQuery(queryText);
  if (!trimmed) return { kind: "empty" };

  let ast: LiqeQuery;
  try {
    ast = parseTraceQuerySyntax(trimmed);
  } catch {
    throw new FilterParseError("Invalid filter syntax");
  }

  if (ast.type === "EmptyExpression") return { kind: "empty" };

  const compiled = translateNode({
    node: ast,
    negated: false,
    ctx,
    translateTag,
    translateScope,
    logic,
  });

  if (Object.keys(ctx.params).length > MAX_PARAM_COUNT) {
    throw new FilterParseError("Too many filter conditions");
  }

  return { kind: "compiled", compiled };
}

/** {@link walkFilterAst} as SQL text, for the LangWatchQL dialect a statement carries. */
export function translateFilterAst({
  queryText,
  ctx,
  translateTag,
  translateScope,
}: {
  queryText: string;
  ctx: TranslationContext;
  translateTag: FieldHandler;
  translateScope?: ScopeTranslator<string>;
}): string | null {
  const walk = walkFilterAst({
    queryText,
    ctx,
    translateTag,
    translateScope,
    logic: TEXT_FILTER_LOGIC,
  });
  return walk.kind === "empty" ? null : walk.compiled;
}
