/**
 * Generic AST traversal helpers used by both the read-side (`queries.ts`)
 * and the write-side (`mutations.ts`). Knows nothing about field names or
 * facet semantics — pure structure work.
 */

import type { LiqeQuery } from "liqe";
import { EMPTY_AST, isEmptyAST } from "./parse";

/** Walk all nodes in the AST, tracking negation context. */
export function walkAST(
  ast: LiqeQuery,
  callback: (node: LiqeQuery, negated: boolean) => void,
  negated = false,
): void {
  if (ast.type === "Tag") {
    callback(ast, negated);
    return;
  }
  if (ast.type === "UnaryOperator") {
    const isNeg = ast.operator === "NOT" || ast.operator === "-";
    walkAST(ast.operand, callback, negated !== isNeg);
    return;
  }
  if (ast.type === "LogicalExpression") {
    walkAST(ast.left, callback, negated);
    walkAST(ast.right, callback, negated);
    return;
  }
  if (ast.type === "ParenthesizedExpression") {
    walkAST(ast.expression, callback, negated);
  }
}

function filterUnaryOperatorNode(
  ast: Extract<LiqeQuery, { type: "UnaryOperator" }>,
  predicate: (node: LiqeQuery) => boolean,
): LiqeQuery {
  if (!predicate(ast.operand)) return EMPTY_AST;
  const inner = filterAST(ast.operand, predicate);
  return isEmptyAST(inner) ? EMPTY_AST : ast;
}

function filterLogicalExpressionNode(
  ast: Extract<LiqeQuery, { type: "LogicalExpression" }>,
  predicate: (node: LiqeQuery) => boolean,
): LiqeQuery {
  const left = filterAST(ast.left, predicate);
  const right = filterAST(ast.right, predicate);
  if (isEmptyAST(left) && isEmptyAST(right)) return EMPTY_AST;
  if (isEmptyAST(left)) return right;
  if (isEmptyAST(right)) return left;
  return { ...ast, left, right };
}

function filterParenthesizedExpressionNode(
  ast: Extract<LiqeQuery, { type: "ParenthesizedExpression" }>,
  predicate: (node: LiqeQuery) => boolean,
): LiqeQuery {
  const inner = filterAST(ast.expression, predicate);
  if (isEmptyAST(inner)) return EMPTY_AST;
  // Unwrap parens that no longer wrap a logical group — `(status:error)`
  // after a sibling is removed adds noise without changing precedence.
  if (inner.type !== "LogicalExpression") return inner;
  return { ...ast, expression: inner };
}

/**
 * Filter AST nodes, removing those for which predicate returns false.
 * Reconstructs the tree, collapsing logical expressions as needed.
 */
export function filterAST(
  ast: LiqeQuery,
  predicate: (node: LiqeQuery) => boolean,
): LiqeQuery {
  if (ast.type === "Tag") {
    return predicate(ast) ? ast : EMPTY_AST;
  }

  if (ast.type === "UnaryOperator") {
    return filterUnaryOperatorNode(ast, predicate);
  }

  if (ast.type === "LogicalExpression") {
    return filterLogicalExpressionNode(ast, predicate);
  }

  if (ast.type === "ParenthesizedExpression") {
    return filterParenthesizedExpressionNode(ast, predicate);
  }

  return ast;
}
