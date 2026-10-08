/**
 * Query-string mutations: parse, mutate AST, re-serialize. Returns original on
 * parse failure. Helpers take destructured params to avoid positional errors.
 */

import type { LiqeQuery } from "liqe";

import { filterAST, walkAST } from "./trace-query-ast.ts";
import type { FacetState } from "./trace-query-metadata.ts";
import { isEmptyAST, parse, serialize } from "./trace-query-parser.ts";

/**
 * Toggle facet value through neutral/include/exclude states. `combinator`
 * controls gluing (AND default, OR for shift/ctrl-click alternatives).
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
 * Add new facet value OR-combined with existing same-field value (faceted search).
 * Rewrites to same-field OR group if lone bare include; else AND-appends.
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
  if (!currentQuery.trim()) {
    return appendClause(currentQuery, newClause);
  }

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
 * literal Tag — safe to fold into a same-field OR group. Null when absent,
 * negated, multi-valued, or already inside an OR group.
 */
function findLoneBareInclude(
  ast: LiqeQuery,
  fieldName: string,
): { value: string; start: number; end: number } | null {
  const candidates: { value: string; start: number; end: number }[] = [];
  walkAST(ast, (node, negated) => {
    if (negated) {
      return;
    }
    if (node.type !== "Tag") {
      return;
    }
    if (node.field.type === "ImplicitField") {
      return;
    }
    if (node.field.name !== fieldName) {
      return;
    }
    if (node.expression.type !== "LiteralExpression") {
      return;
    }
    candidates.push({
      value: String(node.expression.value),
      start: node.location.start,
      end: node.location.end,
    });
  });
  if (candidates.length !== 1) {
    return null;
  }
  const only = candidates.at(0);
  if (!only) {
    return null;
  }
  // Guard: if the lone value already lives inside an OR group, leave it to
  // the splice path. `walkAST` flattens structure, so check the parent.
  if (isInsideOrGroup(ast, only.start, only.end)) {
    return null;
  }
  return only;
}

/**
 * True when the Tag at [start, end) is a descendant of an OR
 * `LogicalExpression`. Used to keep `addSameFieldOrValue` from re-wrapping
 * a value that's already part of a same-field OR group.
 */
function isInsideOrGroup(ast: LiqeQuery, start: number, end: number): boolean {
  return containsTagUnderOr({ end, node: ast, start, underOr: false });
}

/** The walk `isInsideOrGroup` runs: whether the Tag at [start, end) sits below an OR. */
function containsTagUnderOr({
  end,
  node,
  start,
  underOr,
}: {
  end: number;
  node: LiqeQuery;
  start: number;
  underOr: boolean;
}): boolean {
  if (node.type === "Tag") {
    return underOr && node.location.start === start && node.location.end === end;
  }

  if (node.type === "LogicalExpression") {
    const nested = underOr || node.operator.operator === "OR";

    return (
      containsTagUnderOr({ end, node: node.left, start, underOr: nested }) ||
      containsTagUnderOr({ end, node: node.right, start, underOr: nested })
    );
  }

  if (node.type === "UnaryOperator") {
    return containsTagUnderOr({ end, node: node.operand, start, underOr });
  }

  if (node.type === "ParenthesizedExpression") {
    return containsTagUnderOr({ end, node: node.expression, start, underOr });
  }

  return false;
}

/**
 * Append new value into OR group at liqe location. Sidebar smart-toggle:
 * adds to same group rather than AND-combining at top level.
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
  if (!currentQuery.trim()) {
    return currentQuery;
  }
  const trimmed = currentQuery.trimStart();
  const leadingWs = currentQuery.length - trimmed.length;
  const absEnd = leadingWs + groupEnd;
  if (absEnd <= leadingWs + groupStart) {
    return currentQuery;
  }
  const newClause = `${fieldName}:${escapeValue(value)}`;
  return currentQuery.slice(0, absEnd) + ` OR ${newClause}` + currentQuery.slice(absEnd);
}

/**
 * Replace Tag value at liqe location, preserving field and NOT.
 * Drives search bar edit-value popover.
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
  if (!currentQuery.trim()) {
    return currentQuery;
  }
  try {
    const ast = parse(currentQuery);
    const found: { fieldName: string | null } = { fieldName: null };
    walkAST(ast, (node) => {
      if (node.type !== "Tag") {
        return;
      }
      if (node.location.start !== start || node.location.end !== end) {
        return;
      }
      if (node.field.type === "ImplicitField") {
        return;
      }
      if (node.expression.type !== "LiteralExpression") {
        return;
      }
      found.fieldName = node.field.name;
    });
    const { fieldName } = found;
    if (fieldName === null) {
      return currentQuery;
    }
    // Tag.location covers only `field:value` — any wrapping `NOT ` /
    // `-` lives in the surrounding text outside [start, end), so we
    // splice just the field:value form and leave the negation intact.
    const trimmed = currentQuery.trimStart();
    const leadingWs = currentQuery.length - trimmed.length;
    const replacement = `${fieldName}:${escapeValue(newValue)}`;
    return (
      currentQuery.slice(0, leadingWs + start) + replacement + currentQuery.slice(leadingWs + end)
    );
  } catch {
    return currentQuery;
  }
}

/**
 * Flip the boolean operator at the given liqe location between AND and OR.
 * Locations are in liqe's @-stripped trimmed-text coordinate space — the
 * same convention `removeNodeAtLocation` uses.
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
  if (!currentQuery.trim()) {
    return currentQuery;
  }
  // Literal string swap of "AND" ↔ "OR" at those coordinates: the AST walk
  // only emits operator slots for real booleans (never inside a quoted
  // value), so no re-parse is needed.
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
  if (!currentQuery.trim()) {
    return "";
  }
  try {
    const next = filterAST(parse(currentQuery), (node) => {
      if (node.type !== "Tag") {
        return true;
      }
      if (node.field.type === "ImplicitField") {
        return true;
      }
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
  if (!currentQuery.trim()) {
    return "";
  }
  try {
    const next = filterAST(parse(currentQuery), (node) => {
      if (node.type !== "Tag") {
        return true;
      }
      if (node.field.type === "ImplicitField") {
        return true;
      }
      if (node.field.name !== fieldName) {
        return true;
      }
      if (node.expression.type !== "LiteralExpression") {
        return true;
      }
      return String(node.expression.value) !== value;
    });
    return isEmptyAST(next) ? "" : serialize(next);
  } catch {
    return currentQuery;
  }
}

/**
 * Remove free-text literal from query (breakdown chips). Removes only
 * FIRST match; single-shot semantics for UI chip-per-occurrence.
 */
export function removeImplicitTermFromQuery({
  currentQuery,
  value,
}: {
  currentQuery: string;
  value: string;
}): string {
  if (!currentQuery.trim()) {
    return "";
  }
  try {
    let removed = false;
    const next = filterAST(parse(currentQuery), (node) => {
      if (removed) {
        return true;
      }
      if (node.type !== "Tag") {
        return true;
      }
      if (node.field.type !== "ImplicitField") {
        return true;
      }
      if (node.expression.type !== "LiteralExpression") {
        return true;
      }
      if (String(node.expression.value) !== value) {
        return true;
      }
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
 * @-stripped query string). `filterAST` collapses any orphaned
 * logical/parenthesized parents so no stray operators or empty parens remain.
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
  if (!currentQuery.trim()) {
    return "";
  }
  try {
    const next = filterAST(parse(currentQuery), (node) => {
      if (node.type !== "Tag") {
        return true;
      }
      return !(node.location.start === start && node.location.end === end);
    });
    return isEmptyAST(next) ? "" : serialize(next);
  } catch {
    return currentQuery;
  }
}

function appendClause(query: string, clause: string, combinator: "AND" | "OR" = "AND"): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return clause;
  }
  // OR has lower precedence than AND in the query language, so wrapping
  // both sides in parens preserves the user's intent regardless of how
  // the existing query was built (e.g. `a AND b` OR-combined with `c`
  // must read as `(a AND b) OR c`, not `a AND b OR c` which liqe would
  // re-bind as `a AND (b OR c)`).
  if (combinator === "OR") {
    return `(${trimmed}) OR (${clause})`;
  }
  return `${trimmed} AND ${clause}`;
}

/**
 * Wrap value in liqe-compatible quotes unless bare safe-character token.
 * Escapes embedded quotes and backslashes for clean round-trip.
 */
export function escapeValue(value: string): string {
  if (value === "" || !/^[A-Za-z0-9_.-]+$/.test(value)) {
    return `"${value.replace(/[\\"]/g, "\\$&")}"`;
  }
  return value;
}

/**
 * Whether joining this query with AND would rebind an OR it already holds.
 * Read from the parsed top level: `(a) OR (b)` starts with `(` and ends with
 * `)` without being one group. Unparseable text is grouped if it spells `OR`.
 */
function bindsAsOr(query: string): boolean {
  try {
    const ast = parse(query);
    return ast.type === "LogicalExpression" && ast.operator.operator === "OR";
  } catch {
    return /\bOR\b/.test(query);
  }
}

/** Join two queries with AND, grouping either side that binds as an OR. */
export function combineQueries({ base, addition }: { base: string; addition: string }): string {
  const left = base.trim();
  const right = addition.trim();
  if (!left) return right;
  if (!right) return left;
  const guard = (query: string): string => (bindsAsOr(query) ? `(${query})` : query);
  return `${guard(left)} AND ${guard(right)}`;
}

/**
 * A sentence as one free-text clause. Several words become one quoted phrase
 * (substring semantics, one AST node), a single safe word stays bare. Empty
 * input yields an empty clause so the caller can append it without a check.
 */
export function quoteAsPhrase(sentence: string): string {
  const collapsed = sentence.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  return escapeValue(collapsed);
}

/** A tag the sentence may take: bare, unquoted, un-negated, outside any `OR`. */
type BareWordTag = Extract<LiqeQuery, { type: "Tag" }> & {
  expression: Extract<
    Extract<LiqeQuery, { type: "Tag" }>["expression"],
    { type: "LiteralExpression" }
  >;
};

/**
 * Whether the node contributes a word to the sentence. Everything else was
 * written the way the writer meant it, and stays in the explicit query.
 */
function isBareWord(node: LiqeQuery, keepExplicit: ReadonlySet<LiqeQuery>): node is BareWordTag {
  return (
    node.type === "Tag" &&
    !keepExplicit.has(node) &&
    node.field.type === "ImplicitField" &&
    node.expression.type === "LiteralExpression" &&
    !node.expression.quoted
  );
}

/**
 * Every tag with an `OR` above it, at any depth. Such a tag cannot be taken
 * out on its own: what is left behind rebinds, and the caller rejoins the two
 * halves with AND.
 */
function tagsUnderOr(
  ast: LiqeQuery,
  inOr = false,
  found: Set<LiqeQuery> = new Set(),
): Set<LiqeQuery> {
  if (ast.type === "Tag") {
    if (inOr) found.add(ast);
    return found;
  }
  if (ast.type === "UnaryOperator") {
    return tagsUnderOr(ast.operand, inOr, found);
  }
  if (ast.type === "ParenthesizedExpression") {
    return tagsUnderOr(ast.expression, inOr, found);
  }
  if (ast.type === "LogicalExpression") {
    const underOr = inOr || ast.operator.operator === "OR";
    tagsUnderOr(ast.left, underOr, found);
    tagsUnderOr(ast.right, underOr, found);
  }
  return found;
}

/**
 * The two halves of a typed search: the bare words as one sentence, and the
 * explicit query left when they are taken out. A quoted phrase, a negated
 * word and a word under an `OR` stay explicit. @see ADR-144
 */
export function splitBareWords(currentQuery: string): {
  sentence: string;
  explicitQuery: string;
} {
  const trimmed = currentQuery.trim();
  if (!trimmed) return { sentence: "", explicitQuery: "" };
  try {
    const ast = parse(trimmed);
    // `filterAST` hands the predicate a negated word's operand with no sign of
    // the negation, so the negated tags are marked first.
    const negatedTags = new Set<LiqeQuery>();
    walkAST(ast, (node, negated) => {
      if (negated) negatedTags.add(node);
    });
    const keepExplicit = new Set<LiqeQuery>([...negatedTags, ...tagsUnderOr(ast)]);
    const bare: string[] = [];
    const explicit = filterAST(ast, (node) => {
      if (!isBareWord(node, keepExplicit)) return true;
      bare.push(String(node.expression.value));
      return false;
    });
    if (bare.length === 0) return { sentence: "", explicitQuery: trimmed };
    return {
      sentence: bare.join(" "),
      explicitQuery: isEmptyAST(explicit) ? "" : serialize(explicit),
    };
  } catch {
    return { sentence: "", explicitQuery: trimmed };
  }
}

/**
 * The same query with its bare words collapsed into one quoted phrase, the
 * explicit `field:value` terms kept as typed: what "search it as one phrase"
 * applies, and what an undo restores after the router wrote a filter.
 */
export function requoteBareTerms(currentQuery: string): string {
  const { sentence, explicitQuery } = splitBareWords(currentQuery);
  if (!sentence) return currentQuery;
  return combineQueries({ base: explicitQuery, addition: quoteAsPhrase(sentence) });
}
