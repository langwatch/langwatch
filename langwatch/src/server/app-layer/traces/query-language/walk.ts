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
    if (!predicate(ast.operand)) return EMPTY_AST;
    const inner = filterAST(ast.operand, predicate);
    return isEmptyAST(inner) ? EMPTY_AST : ast;
  }

  if (ast.type === "LogicalExpression") {
    const left = filterAST(ast.left, predicate);
    const right = filterAST(ast.right, predicate);
    if (isEmptyAST(left) && isEmptyAST(right)) return EMPTY_AST;
    if (isEmptyAST(left)) return right;
    if (isEmptyAST(right)) return left;
    return { ...ast, left, right };
  }

  if (ast.type === "ParenthesizedExpression") {
    const inner = filterAST(ast.expression, predicate);
    if (isEmptyAST(inner)) return EMPTY_AST;
    // Unwrap parens that no longer wrap a logical group — `(status:error)`
    // after a sibling is removed adds noise without changing precedence.
    if (inner.type !== "LogicalExpression") return inner;
    return { ...ast, expression: inner };
  }

  return ast;
}
