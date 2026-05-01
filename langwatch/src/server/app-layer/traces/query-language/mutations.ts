/**
 * Query-string mutations. Every helper here takes a query string, parses it,
 * mutates the AST, and re-serialises — keeping liqe as the single source of
 * truth for AST structure. On parse failure, returns the original string so
 * mid-edit mutations don't blow up.
 */

import type { FacetState } from "./metadata";
import { isEmptyAST, parse, serialize } from "./parse";
import { filterAST } from "./walk";

/**
 * Toggle a facet value through three states: neutral → include → exclude → neutral.
 * Instead of mutating the AST directly, we serialize → modify string → re-parse.
 */
export function toggleFacetInQuery(
  currentQuery: string,
  fieldName: string,
  value: string,
  currentState: FacetState,
): string {
  const cleaned = removeFacetValueFromQuery(currentQuery, fieldName, value);
  if (currentState === "neutral") {
    return appendClause(cleaned, `${fieldName}:${escapeValue(value)}`);
  }
  if (currentState === "include") {
    return appendClause(cleaned, `NOT ${fieldName}:${escapeValue(value)}`);
  }
  return cleaned;
}

export function setRangeInQuery(
  currentQuery: string,
  fieldName: string,
  from: string,
  to: string,
): string {
  const cleaned = removeFieldFromQuery(currentQuery, fieldName);
  return appendClause(cleaned, `${fieldName}:[${from} TO ${to}]`);
}

export function removeFieldFromQuery(
  currentQuery: string,
  fieldName: string,
): string {
  if (!currentQuery.trim()) return "";
  try {
    const next = filterAST(parse(currentQuery), (node) => {
      if (node.type !== "Tag") return true;
      if (node.field.type === "ImplicitField") return true;
      return node.field.name !== fieldName;
    });
    return isEmptyAST(next) ? "" : serialize(next);
  } catch {
    return currentQuery;
  }
}

export function removeFacetValueFromQuery(
  currentQuery: string,
  fieldName: string,
  value: string,
): string {
  if (!currentQuery.trim()) return "";
  try {
    const next = filterAST(parse(currentQuery), (node) => {
      if (node.type !== "Tag") return true;
      if (node.field.type === "ImplicitField") return true;
      if (node.field.name !== fieldName) return true;
      if (node.expression.type !== "LiteralExpression") return true;
      return String(node.expression.value) !== value;
    });
    return isEmptyAST(next) ? "" : serialize(next);
  } catch {
    return currentQuery;
  }
}

/**
 * Drop the Tag node at the given liqe location (start/end relative to the
 * @-stripped query string). Used by the inline X-button on each token —
 * `filterAST` collapses any orphaned logical/parenthesized parents so we
 * don't end up with stray operators or empty parens.
 */
export function removeNodeAtLocation(
  currentQuery: string,
  start: number,
  end: number,
): string {
  if (!currentQuery.trim()) return "";
  try {
    const next = filterAST(parse(currentQuery), (node) => {
      if (node.type !== "Tag") return true;
      return !(node.location.start === start && node.location.end === end);
    });
    return isEmptyAST(next) ? "" : serialize(next);
  } catch {
    return currentQuery;
  }
}

function appendClause(query: string, clause: string): string {
  const trimmed = query.trim();
  if (!trimmed) return clause;
  return `${trimmed} AND ${clause}`;
}

function escapeValue(value: string): string {
  if (/[\s"()]/.test(value)) return `"${value}"`;
  return value;
}
