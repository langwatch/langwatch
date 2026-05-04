/**
 * Query-string mutations. Every helper here takes a query string, parses it,
 * mutates the AST, and re-serialises — keeping liqe as the single source of
 * truth for AST structure. On parse failure, returns the original string so
 * mid-edit mutations don't blow up.
 */

import type { FacetState } from "./metadata";
import { isEmptyAST, parse, serialize } from "./parse";
import { filterAST, walkAST } from "./walk";

/**
 * Toggle a facet value through three states: neutral → include → exclude → neutral.
 * Instead of mutating the AST directly, we serialize → modify string → re-parse.
 *
 * `combinator` controls how a newly-added clause is glued to the existing
 * query. Defaults to AND (the historical behaviour); pass "OR" when the
 * user is shift/ctrl-clicking to add an alternative rather than narrowing
 * the result set further.
 */
export function toggleFacetInQuery(
  currentQuery: string,
  fieldName: string,
  value: string,
  currentState: FacetState,
  combinator: "AND" | "OR" = "AND",
): string {
  const cleaned = removeFacetValueFromQuery(currentQuery, fieldName, value);
  if (currentState === "neutral") {
    return appendClause(cleaned, `${fieldName}:${escapeValue(value)}`, combinator);
  }
  if (currentState === "include") {
    // Negation always combines with AND — "NOT foo OR bar" reads
    // ambiguously and the facet UI never produces it.
    return appendClause(cleaned, `NOT ${fieldName}:${escapeValue(value)}`);
  }
  return cleaned;
}

/**
 * Replace the value of the Tag at the given liqe location with
 * `newValue`, preserving the field name and any leading NOT. Drives the
 * click-a-token-to-edit-value popover in the search bar — given the
 * Tag's [start, end] coordinates and a candidate replacement, swap the
 * value in place without touching the rest of the query.
 *
 * Returns the original query if the location doesn't resolve to a Tag
 * with a literal expression (e.g. range tokens, structural mismatch).
 */
export function setFacetValueAtLocation(
  currentQuery: string,
  start: number,
  end: number,
  newValue: string,
): string {
  if (!currentQuery.trim()) return currentQuery;
  try {
    const ast = parse(currentQuery);
    let fieldName: string | null = null;
    walkAST(ast, (node) => {
      if (node.type !== "Tag") return;
      if (node.location.start !== start || node.location.end !== end) return;
      if (node.field.type === "ImplicitField") return;
      if (node.expression.type !== "LiteralExpression") return;
      fieldName = (node.field as { name: string }).name;
    });
    if (fieldName === null) return currentQuery;
    // Tag.location covers only `field:value` — any wrapping `NOT ` /
    // `-` lives in the surrounding text outside [start, end), so we
    // splice just the field:value form and leave the negation intact.
    const trimmed = currentQuery.trimStart();
    const leadingWs = currentQuery.length - trimmed.length;
    const replacement = `${fieldName}:${escapeValue(newValue)}`;
    return (
      currentQuery.slice(0, leadingWs + start) +
      replacement +
      currentQuery.slice(leadingWs + end)
    );
  } catch {
    return currentQuery;
  }
}

/**
 * Flip the boolean operator at the given liqe location between AND and
 * OR. Drives the click-to-cycle affordance on operator keywords in the
 * search bar. Locations are in liqe's @-stripped trimmed-text coordinate
 * space — the same convention `removeNodeAtLocation` uses.
 */
export function swapOperatorAtLocation(
  currentQuery: string,
  start: number,
  end: number,
): string {
  if (!currentQuery.trim()) return currentQuery;
  // The operator keyword's text content lives at [start, end) in the
  // trimmed-string projection. We don't need to re-parse: a literal
  // string swap of "AND" ↔ "OR" at those coordinates is unambiguous
  // because the AST walk only emits operator slots for real boolean
  // operators in the parsed query — they can't sit inside a quoted
  // value. Working at the string level avoids re-serialisation
  // reformatting the surrounding query.
  const trimmed = currentQuery.trimStart();
  const leadingWs = currentQuery.length - trimmed.length;
  const absStart = leadingWs + start;
  const absEnd = leadingWs + end;
  const fragment = currentQuery.slice(absStart, absEnd);
  const upper = fragment.toUpperCase();
  let next: string;
  if (upper === "AND") {
    next = "OR";
  } else if (upper === "OR") {
    next = "AND";
  } else {
    return currentQuery;
  }
  return (
    currentQuery.slice(0, absStart) + next + currentQuery.slice(absEnd)
  );
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

function appendClause(
  query: string,
  clause: string,
  combinator: "AND" | "OR" = "AND",
): string {
  const trimmed = query.trim();
  if (!trimmed) return clause;
  // OR has lower precedence than AND in the query language, so wrapping
  // both sides in parens preserves the user's intent regardless of how
  // the existing query was built (e.g. `a AND b` OR-combined with `c`
  // must read as `(a AND b) OR c`, not `a AND b OR c` which liqe would
  // re-bind as `a AND (b OR c)`).
  if (combinator === "OR") return `(${trimmed}) OR (${clause})`;
  return `${trimmed} AND ${clause}`;
}

function escapeValue(value: string): string {
  if (/[\s"()]/.test(value)) return `"${value}"`;
  return value;
}
