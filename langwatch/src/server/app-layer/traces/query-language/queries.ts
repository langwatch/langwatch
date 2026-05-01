/**
 * Read-only AST queries. Given an already-parsed AST, extract facet states,
 * range values, and structural properties. No string mutation here — for
 * that, see `mutations.ts`.
 */

import type { LiqeQuery } from "liqe";
import type { FacetState } from "./metadata";
import { walkAST } from "./walk";

/**
 * Walk the AST after a successful syntactic parse and reject queries the
 * server can't execute. Catches `field:` (no value) — liqe parses it as a
 * `Tag` whose expression is `EmptyExpression`, but the backend rejects with a
 * 422. Returning the error here lets the SearchBar surface red-border feedback
 * and prevents the doomed query from being committed and re-fired by polling.
 */
export function validateAst(ast: LiqeQuery): string | null {
  if (ast.type === "Tag") {
    if (ast.expression.type === "EmptyExpression") {
      const fieldName =
        ast.field.type === "ImplicitField" ? "" : ast.field.name;
      return fieldName
        ? `Missing value after \`${fieldName}:\``
        : "Missing value after `:`";
    }
    return null;
  }
  if (ast.type === "UnaryOperator") return validateAst(ast.operand);
  if (ast.type === "LogicalExpression") {
    return validateAst(ast.left) ?? validateAst(ast.right);
  }
  if (ast.type === "ParenthesizedExpression") {
    return validateAst(ast.expression);
  }
  return null;
}

/**
 * Walk the AST and extract all Tag nodes for a given field name.
 * Returns include (non-negated) and exclude (negated) values.
 */
export function getFacetValues(
  ast: LiqeQuery,
  fieldName: string,
): { include: string[]; exclude: string[] } {
  const include: string[] = [];
  const exclude: string[] = [];

  walkAST(ast, (node, negated) => {
    if (node.type !== "Tag") return;
    if (node.field.type === "ImplicitField") return;
    if (node.field.name !== fieldName) return;
    if (node.expression.type !== "LiteralExpression") return;
    const value = String(node.expression.value);
    if (negated) {
      exclude.push(value);
    } else {
      include.push(value);
    }
  });

  return { include, exclude };
}

export function getFacetValueState(
  ast: LiqeQuery,
  fieldName: string,
  value: string,
): FacetState {
  const { include, exclude } = getFacetValues(ast, fieldName);
  if (include.includes(value)) return "include";
  if (exclude.includes(value)) return "exclude";
  return "neutral";
}

/**
 * Single AST walk that captures every facet value's state. Returns a flat
 * lookup keyed by `${field}|${value}`. The sidebar renders dozens of rows,
 * each of which used to call `getFacetValueState` — meaning N×M walks per
 * render. With this lookup the walk happens once per AST identity change.
 */
export function buildFacetStateLookup(
  ast: LiqeQuery,
): ReadonlyMap<string, FacetState> {
  const map = new Map<string, FacetState>();
  walkAST(ast, (node, negated) => {
    if (node.type !== "Tag") return;
    if (node.field.type === "ImplicitField") return;
    if (node.expression.type !== "LiteralExpression") return;
    const key = `${(node.field as { name: string }).name}|${String(
      node.expression.value,
    )}`;
    // Last write wins, matching `getFacetValueState`'s array-includes
    // semantics (it returns the first match, but for canonical queries
    // values appear once per field).
    map.set(key, negated ? "exclude" : "include");
  });
  return map;
}

/**
 * Get a range value for a field. Last matching node wins — the AST is
 * expected to hold a single range/comparison per field after a setRange call.
 */
export function getRangeValue(
  ast: LiqeQuery,
  fieldName: string,
): { from?: number; to?: number } | null {
  let result: { from?: number; to?: number } | null = null;

  walkAST(ast, (node, negated) => {
    if (negated) return;
    if (node.type !== "Tag") return;
    if (node.field.type === "ImplicitField") return;
    if (node.field.name !== fieldName) return;

    if (node.expression.type === "RangeExpression") {
      result = {
        from: node.expression.range.min,
        to: node.expression.range.max,
      };
      return;
    }

    if (node.expression.type !== "LiteralExpression") return;
    const op = node.operator.operator;
    if (op === ":") return;
    const raw = node.expression.value;
    const num = typeof raw === "number" ? raw : parseFloat(String(raw));
    if (!Number.isFinite(num)) return;
    if (op === ":>" || op === ":>=") result = { from: num };
    else if (op === ":<" || op === ":<=") result = { to: num };
  });

  return result;
}

/** Check if there's a cross-facet OR at the top level (or recursively). */
export function hasCrossFacetOR(ast: LiqeQuery): boolean {
  if (ast.type !== "LogicalExpression") return false;
  if (ast.operator.operator !== "OR") {
    return hasCrossFacetOR(ast.left) || hasCrossFacetOR(ast.right);
  }
  const leftField = topField(ast.left);
  const rightField = topField(ast.right);
  if (leftField && rightField && leftField !== rightField) return true;
  return hasCrossFacetOR(ast.left) || hasCrossFacetOR(ast.right);
}

function topField(ast: LiqeQuery): string | null {
  if (ast.type === "Tag") {
    return ast.field.type === "ImplicitField" ? null : ast.field.name;
  }
  if (ast.type === "UnaryOperator") return topField(ast.operand);
  return null;
}
