/**
 * Query-string mutations. Every helper here takes a query string, parses it,
 * mutates the AST, and re-serialises — keeping liqe as the single source of
 * truth for AST structure. On parse failure, returns the original string so
 * mid-edit mutations don't blow up.
 *
 * All helpers take a single destructured params object — the location-based
 * mutators in particular have several positional primitives (start/end +
 * field/value) that were easy to mis-order with positional args.
 */

import type { LiqeQuery } from "liqe";
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
export function toggleFacetInQuery({
  currentQuery,
  fieldName,
  value,
  currentState,
  combinator = "AND",
}: {
  currentQuery: string;
  fieldName: string;
  value: string;
  currentState: FacetState;
  combinator?: "AND" | "OR";
}): string {
  const cleaned = removeFacetValueFromQuery({
    currentQuery,
    fieldName,
    value,
  });
  if (currentState === "neutral") {
    return appendClause(
      cleaned,
      `${fieldName}:${escapeValue(value)}`,
      combinator,
    );
  }
  if (currentState === "include") {
    // Negation always combines with AND — "NOT foo OR bar" reads
    // ambiguously and the facet UI never produces it.
    return appendClause(cleaned, `NOT ${fieldName}:${escapeValue(value)}`);
  }
  return cleaned;
}

/**
 * Add a new value to a facet, OR-combining it with an existing bare value
 * of the SAME field. Faceted-search semantics: picking two values of one
 * field means "either/or" — a trace's `origin` can't be both `sample` and
 * `application`, so AND-ing them matches nothing. This is the plain-click
 * (no modifier) default for adding a second value.
 *
 * Behaviour, driven by what the field already looks like in the AST:
 *   - Exactly one bare top-level include for the field (the common case
 *     after the user's first pick) → rewrite that tag in place into a
 *     parenthesised same-field OR group:
 *       `model:gpt-4o AND origin:sample`
 *         → `model:gpt-4o AND (origin:sample OR origin:application)`
 *     The parens are mandatory: liqe binds `A AND b OR c` as
 *     `(A AND b) OR c`, so an unparenthesised same-field OR would escape
 *     its scope and silently widen the whole query.
 *   - Anything else (field absent, already multi-valued via AND, or the
 *     lone value is negated) → fall back to a plain AND append. The
 *     splice into an *existing* OR group is a different path
 *     (`addToOrGroupAtLocation`), reached once the group exists.
 *
 * Returns the original string on parse failure, matching the rest of the
 * mutation helpers.
 */
export function addSameFieldOrValue({
  currentQuery,
  fieldName,
  value,
}: {
  currentQuery: string;
  fieldName: string;
  value: string;
}): string {
  const newClause = `${fieldName}:${escapeValue(value)}`;
  if (!currentQuery.trim()) return appendClause(currentQuery, newClause);

  let ast: LiqeQuery;
  try {
    ast = parse(currentQuery);
  } catch {
    return currentQuery;
  }

  const anchor = findLoneBareInclude(ast, fieldName);
  if (!anchor) {
    // No single bare value to fold into — append normally. (First-ever
    // value, an existing multi-AND state, or a negated lone value.)
    return appendClause(currentQuery, newClause);
  }

  // Splice `(field:existing OR field:new)` over the lone tag's
  // [start, end) span. Tag locations are in liqe's trimmed-text
  // coordinate space, so offset by any leading whitespace — the same
  // convention `setFacetValueAtLocation` / `addToOrGroupAtLocation` use.
  const trimmed = currentQuery.trimStart();
  const leadingWs = currentQuery.length - trimmed.length;
  const existingClause = `${fieldName}:${escapeValue(anchor.value)}`;
  const group = `(${existingClause} OR ${newClause})`;
  return (
    currentQuery.slice(0, leadingWs + anchor.start) +
    group +
    currentQuery.slice(leadingWs + anchor.end)
  );
}

/**
 * Locate the field's value when it appears exactly once, un-negated, as a
 * literal Tag — the shape we can safely fold into a same-field OR group.
 * Returns null when the field is absent, negated, multi-valued, or already
 * sitting inside an OR group (a value whose parent is an OR
 * `LogicalExpression` is handled by the splice path, not by wrapping).
 */
function findLoneBareInclude(
  ast: LiqeQuery,
  fieldName: string,
): { value: string; start: number; end: number } | null {
  const candidates: { value: string; start: number; end: number }[] = [];
  walkAST(ast, (node, negated) => {
    if (negated) return;
    if (node.type !== "Tag") return;
    if (node.field.type === "ImplicitField") return;
    if ((node.field as { name: string }).name !== fieldName) return;
    if (node.expression.type !== "LiteralExpression") return;
    candidates.push({
      value: String(node.expression.value),
      start: node.location.start,
      end: node.location.end,
    });
  });
  if (candidates.length !== 1) return null;
  const only = candidates[0]!;
  // Guard: if the lone value already lives inside an OR group, leave it to
  // the splice path. `walkAST` flattens structure, so check the parent.
  if (isInsideOrGroup(ast, only.start, only.end)) return null;
  return only;
}

/**
 * True when the Tag at [start, end) is a descendant of an OR
 * `LogicalExpression`. Used to keep `addSameFieldOrValue` from re-wrapping
 * a value that's already part of a same-field OR group.
 */
function isInsideOrGroup(ast: LiqeQuery, start: number, end: number): boolean {
  let inside = false;
  const visit = (node: LiqeQuery, underOr: boolean): void => {
    if (inside) return;
    if (node.type === "Tag") {
      if (
        underOr &&
        node.location.start === start &&
        node.location.end === end
      ) {
        inside = true;
      }
      return;
    }
    if (node.type === "LogicalExpression") {
      const isOr = node.operator.operator === "OR";
      visit(node.left, underOr || isOr);
      visit(node.right, underOr || isOr);
      return;
    }
    if (node.type === "UnaryOperator") {
      visit(node.operand, underOr);
      return;
    }
    if (node.type === "ParenthesizedExpression") {
      visit(node.expression, underOr);
    }
  };
  visit(ast, false);
  return inside;
}

/**
 * Append a new `field:value` Tag into the OR group at the given liqe
 * location. The group's coordinates come from
 * `analyzeOrGroups(...).groups[].{start,end}` — that's the inner
 * LogicalExpression's range (not including surrounding parens), so
 * splicing ` OR field:value` after the group's end keeps any
 * wrapping parens intact and OR's left-associativity does the rest:
 * `(a OR b) AND c` → `(a OR b OR x) AND c`.
 *
 * Used by the sidebar's smart-toggle: clicking a new value in a
 * facet that's part of an OR group adds it to the same group rather
 * than AND-combining at the top level.
 */
export function addToOrGroupAtLocation({
  currentQuery,
  groupStart,
  groupEnd,
  fieldName,
  value,
}: {
  currentQuery: string;
  groupStart: number;
  groupEnd: number;
  fieldName: string;
  value: string;
}): string {
  if (!currentQuery.trim()) return currentQuery;
  const trimmed = currentQuery.trimStart();
  const leadingWs = currentQuery.length - trimmed.length;
  const absEnd = leadingWs + groupEnd;
  if (absEnd <= leadingWs + groupStart) return currentQuery;
  const newClause = `${fieldName}:${escapeValue(value)}`;
  return (
    currentQuery.slice(0, absEnd) +
    ` OR ${newClause}` +
    currentQuery.slice(absEnd)
  );
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
export function setFacetValueAtLocation({
  currentQuery,
  start,
  end,
  newValue,
}: {
  currentQuery: string;
  start: number;
  end: number;
  newValue: string;
}): string {
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
export function swapOperatorAtLocation({
  currentQuery,
  start,
  end,
}: {
  currentQuery: string;
  start: number;
  end: number;
}): string {
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
  return currentQuery.slice(0, absStart) + next + currentQuery.slice(absEnd);
}

export function setRangeInQuery({
  currentQuery,
  fieldName,
  from,
  to,
}: {
  currentQuery: string;
  fieldName: string;
  from: string;
  to: string;
}): string {
  const cleaned = removeFieldFromQuery({ currentQuery, fieldName });
  return appendClause(cleaned, `${fieldName}:[${from} TO ${to}]`);
}

export function removeFieldFromQuery({
  currentQuery,
  fieldName,
}: {
  currentQuery: string;
  fieldName: string;
}): string {
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

export function removeFacetValueFromQuery({
  currentQuery,
  fieldName,
  value,
}: {
  currentQuery: string;
  fieldName: string;
  value: string;
}): string {
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
 * Remove a free-text (ImplicitField) literal from the query. Used by
 * the empty-state query breakdown chips when the user wants to drop a
 * single bare token (e.g. "Ω" they typed by accident) without
 * clearing the whole query. `filterAST` collapses any orphaned logical
 * parents so we don't leave stray ANDs/ORs behind.
 *
 * Removes only the FIRST matching bare term — a query like
 * `foo AND foo AND bar` collapses to `foo AND bar` after one removal
 * (the chip the user clicked), not just `bar`. Without the
 * single-shot semantics the breakdown UI would silently nuke every
 * duplicate token in one click, which doesn't match what the user sees
 * (one chip per occurrence in the breakdown panel).
 */
export function removeImplicitTermFromQuery({
  currentQuery,
  value,
}: {
  currentQuery: string;
  value: string;
}): string {
  if (!currentQuery.trim()) return "";
  try {
    let removed = false;
    const next = filterAST(parse(currentQuery), (node) => {
      if (removed) return true;
      if (node.type !== "Tag") return true;
      if (node.field.type !== "ImplicitField") return true;
      if (node.expression.type !== "LiteralExpression") return true;
      if (String(node.expression.value) !== value) return true;
      removed = true;
      return false;
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
export function removeNodeAtLocation({
  currentQuery,
  start,
  end,
}: {
  currentQuery: string;
  start: number;
  end: number;
}): string {
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

/**
 * Wrap a value in liqe-compatible quotes unless it's a "bare" token of
 * safe characters. Liqe's unquoted literal only accepts a limited set,
 * so anything beyond `[A-Za-z0-9_.-]` — a slash in a model id like
 * `anthropic/claude-sonnet-4-6`, a colon, whitespace, quotes, parens —
 * must be quoted or it produces a syntax error. Embedded `"` and `\` are
 * escaped so values like `He said "no"` round-trip cleanly. The empty
 * string quotes to `""` rather than emitting a bare `field:`.
 */
function escapeValue(value: string): string {
  if (value === "" || !/^[A-Za-z0-9_.-]+$/.test(value)) {
    return `"${value.replace(/[\\"]/g, "\\$&")}"`;
  }
  return value;
}
