/**
 * Read-only AST queries. Given an already-parsed AST, extract facet states,
 * range values, and structural properties. No string mutation here — for
 * that, see `mutations.ts`.
 */

import type { LiqeQuery } from "liqe";

import { filterAST, walkAST } from "./trace-query-ast.ts";
import type { FacetState } from "./trace-query-metadata.ts";
import { isEmptyAST, parse, serialize } from "./trace-query-parser.ts";

/**
 * Rejects queries liqe parses but the server can't execute — e.g. `field:`
 * (no value) becomes an `EmptyExpression` Tag the backend 422s on. Catching
 * it here lets the SearchBar show red-border feedback before commit.
 */
function missingValueMessage(ast: Extract<LiqeQuery, { type: "Tag" }>): string | null {
  if (ast.expression.type !== "EmptyExpression") return null;

  const fieldName = ast.field.type === "ImplicitField" ? "" : ast.field.name;

  return fieldName ? `Missing value after \`${fieldName}:\`` : "Missing value after `:`";
}

/**
 * Whether the query names `fieldName` as a structured term anywhere, negated
 * or not, at any depth. Empty and unparsable input names nothing.
 */
export function queryNamesField(queryText: string, fieldName: string): boolean {
  const trimmed = queryText.trim();
  if (!trimmed) return false;

  let ast: LiqeQuery;
  try {
    ast = parse(trimmed);
  } catch {
    return false;
  }

  let named = false;
  walkAST(ast, (node) => {
    if (node.type !== "Tag" || node.field.type === "ImplicitField") return;
    if (node.field.name === fieldName) named = true;
  });

  return named;
}

/** The ceiling the ClickHouse translator holds: one node per node visited. */
export const MAX_FILTER_NODE_COUNT = 20;

/**
 * What a filter past the ceiling says. The server answers the same refusal
 * with `filter_too_complex`; this is the client's copy, shown before sending.
 */
export const FILTER_TOO_COMPLEX_MESSAGE =
  "Too many separate terms. Put the sentence in quotes to search it as one phrase.";

/** Counts nodes the way the ClickHouse translator does: one per node visited. */
export function countFilterNodes(ast: LiqeQuery): number {
  switch (ast.type) {
    case "LogicalExpression":
      return 1 + countFilterNodes(ast.left) + countFilterNodes(ast.right);
    case "UnaryOperator":
      return 1 + countFilterNodes(ast.operand);
    case "ParenthesizedExpression":
      return 1 + countFilterNodes(ast.expression);
    default:
      return 1;
  }
}

export function validateAst(ast: LiqeQuery): string | null {
  if (countFilterNodes(ast) > MAX_FILTER_NODE_COUNT) {
    return FILTER_TOO_COMPLEX_MESSAGE;
  }
  switch (ast.type) {
    case "Tag":
      return missingValueMessage(ast);
    case "UnaryOperator":
      return validateAst(ast.operand);
    case "LogicalExpression":
      return validateAst(ast.left) ?? validateAst(ast.right);
    case "ParenthesizedExpression":
      return validateAst(ast.expression);
    default:
      return null;
  }
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
    const value = String(node.expression.value);
    if (negated) {
      exclude.push(value);
    } else {
      include.push(value);
    }
  });

  return { include, exclude };
}

export function getFacetValueState(ast: LiqeQuery, fieldName: string, value: string): FacetState {
  const { include, exclude } = getFacetValues(ast, fieldName);
  if (include.includes(value)) {
    return "include";
  }
  if (exclude.includes(value)) {
    return "exclude";
  }
  return "neutral";
}

/**
 * Single AST walk that captures every facet value's state, keyed by
 * `${field}|${value}`. Replaces dozens of per-row `getFacetValueState` calls
 * (N×M walks) with one walk per AST identity change.
 */
export function buildFacetStateLookup(ast: LiqeQuery): ReadonlyMap<string, FacetState> {
  const map = new Map<string, FacetState>();
  walkAST(ast, (node, negated) => {
    if (node.type !== "Tag") {
      return;
    }
    if (node.field.type === "ImplicitField") {
      return;
    }
    if (node.expression.type !== "LiteralExpression") {
      return;
    }
    const key = `${node.field.name}|${String(node.expression.value)}`;
    // Last write wins, matching `getFacetValueState`'s array-includes
    // semantics (it returns the first match, but for canonical queries
    // values appear once per field).
    map.set(key, negated ? "exclude" : "include");
  });
  return map;
}

/** The explicit `field:[a TO b]` range on one Tag, or none when it is not one. */
function explicitRange(
  node: Extract<LiqeQuery, { type: "Tag" }>,
): { from?: number; to?: number } | null {
  if (node.expression.type !== "RangeExpression") return null;

  return { from: node.expression.range.min, to: node.expression.range.max };
}

/** The open-ended range a `field:>n` / `field:<n` comparison stands for. */
function comparisonRange(
  node: Extract<LiqeQuery, { type: "Tag" }>,
): { from?: number; to?: number } | null {
  if (node.expression.type !== "LiteralExpression") return null;

  const op = node.operator.operator;
  if (op === ":") return null;

  const raw = node.expression.value;
  const num = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (!Number.isFinite(num)) return null;

  if (op === ":>" || op === ":>=") return { from: num };
  if (op === ":<" || op === ":<=") return { to: num };

  return null;
}

/** Whether this node is an un-negated `Tag` naming `fieldName`. */
function isRangeCandidate(
  node: LiqeQuery,
  negated: boolean,
  fieldName: string,
): node is Extract<LiqeQuery, { type: "Tag" }> {
  if (negated || node.type !== "Tag") return false;
  if (node.field.type === "ImplicitField") return false;

  return node.field.name === fieldName;
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
    if (!isRangeCandidate(node, negated, fieldName)) return;

    const range = explicitRange(node) ?? comparisonRange(node);
    if (range) result = range;
  });

  return result;
}

/**
 * One member of a cross-facet OR group: a single Tag value within the
 * group's parenthesised expression.
 */
export interface OrGroupMember {
  field: string;
  value: string;
  /** true when the Tag is wrapped in `NOT` / `-`. Excluded values still
   * belong to the group — the sidebar renders them as exclude chips. */
  negated: boolean;
  /** Liqe-text-coordinate range of the Tag (for value swap / removal). */
  start: number;
  end: number;
}

/**
 * Cross-facet OR group with stable hash ID for coloring and connector keying
 * without re-derivation on each render.
 */
export interface OrGroup {
  id: string;
  fields: ReadonlySet<string>;
  members: OrGroupMember[];
  /** Liqe-text-coordinate range of the group's outermost OR
   * expression — used by mutations that add/remove members. */
  start: number;
  end: number;
}

export interface OrGroupAnalysis {
  groups: OrGroup[];
  /**
   * `${field}|${value}` → group id. An exact (field, value) participates
   * in at most one OR group, so a single-id map is sound here.
   * Use this for membership lookups from chip/row hover handlers.
   */
  memberToGroupId: Map<string, string>;
  /**
   * Field → list of group ids whose members include this field (a field can
   * appear in multiple disjoint OR groups). Consumers wanting one
   * representative group pick `[0]`; consumers wanting all peers iterate.
   */
  fieldToGroupIds: Map<string, string[]>;
}

function memberKey(field: string, value: string): string {
  return `${field}|${value}`;
}

/**
 * Walk AST, produce structured map of OR groups. Includes same-field ORs,
 * flattens nested OR subtrees into same group.
 */
type OrGroupAccumulator = Readonly<{
  groups: OrGroup[];
  memberToGroupId: Map<string, string>;
  fieldToGroupIds: Map<string, string[]>;
}>;

/** Records the group this OR node forms, or reports that it forms none. */
function recordOrGroup(
  acc: OrGroupAccumulator,
  node: Extract<LiqeQuery, { type: "LogicalExpression" }>,
): boolean {
  const members = collectOrMembers(node);
  if (members.length <= 1) return false;

  const id = `or-${node.location.start}-${node.location.end}`;
  const fields = new Set(members.map((m) => m.field));
  acc.groups.push({ id, fields, members, start: node.location.start, end: node.location.end });
  for (const m of members) {
    acc.memberToGroupId.set(memberKey(m.field, m.value), id);
  }
  for (const f of fields) {
    const existing = acc.fieldToGroupIds.get(f);
    if (!existing) {
      acc.fieldToGroupIds.set(f, [id]);
      continue;
    }
    if (!existing.includes(id)) existing.push(id);
  }

  return true;
}

function visitOrGroups(acc: OrGroupAccumulator, node: LiqeQuery): void {
  if (node.type === "LogicalExpression") {
    if (node.operator.operator === "OR" && recordOrGroup(acc, node)) return;

    visitOrGroups(acc, node.left);
    visitOrGroups(acc, node.right);
    return;
  }
  if (node.type === "UnaryOperator") {
    visitOrGroups(acc, node.operand);
    return;
  }
  if (node.type === "ParenthesizedExpression") {
    visitOrGroups(acc, node.expression);
  }
}

export function analyzeOrGroups(ast: LiqeQuery): OrGroupAnalysis {
  const acc: OrGroupAccumulator = {
    groups: [],
    memberToGroupId: new Map<string, string>(),
    fieldToGroupIds: new Map<string, string[]>(),
  };

  visitOrGroups(acc, ast);

  return acc;
}

function collectOrMembers(node: LiqeQuery, negated = false): OrGroupMember[] {
  // Flatten nested OR LogicalExpressions but stop at AND boundaries —
  // an AND inside an OR group is treated as opaque (the sidebar can't
  // represent it), so the caller's group.members may not enumerate
  // every Tag. That's fine for visualisation; the warning still
  // surfaces if the user expects the sidebar to be authoritative.
  if (node.type === "LogicalExpression") {
    if (node.operator.operator === "OR") {
      return [...collectOrMembers(node.left, negated), ...collectOrMembers(node.right, negated)];
    }
    return [];
  }
  if (node.type === "ParenthesizedExpression") {
    return collectOrMembers(node.expression, negated);
  }
  if (node.type === "UnaryOperator") {
    const isNeg = node.operator === "NOT" || node.operator === "-";
    return collectOrMembers(node.operand, negated !== isNeg);
  }
  if (node.type === "Tag") {
    if (node.field.type === "ImplicitField") {
      return [];
    }
    if (node.expression.type !== "LiteralExpression") {
      return [];
    }
    return [
      {
        field: node.field.name,
        value: String(node.expression.value),
        negated,
        start: node.location.start,
        end: node.location.end,
      },
    ];
  }
  return [];
}

/**
 * Whether a tag names the facet's field, or one of its dotted sub-fields
 * (`evaluator.verdict` belongs to the `evaluator` facet, `event.attribute.x`
 * to `event`).
 */
function tagBelongsToFacet(node: LiqeQuery, facetKey: string): boolean {
  if (node.type !== "Tag") return false;
  if (node.field.type === "ImplicitField") return false;
  const name = node.field.name;
  return name === facetKey || name.startsWith(`${facetKey}.`);
}

/**
 * Whether the query has a term on the facet's field. Free-text terms and other
 * fields do not count, so a facet the query never names keeps the whole query.
 */
export function queryNamesFacet({
  queryText,
  facetKey,
}: {
  queryText: string;
  facetKey: string;
}): boolean {
  if (!queryText.trim()) return false;
  let named = false;
  try {
    filterAST(parse(queryText), (node) => {
      if (tagBelongsToFacet(node, facetKey)) named = true;
      return true;
    });
  } catch {
    return false;
  }
  return named;
}

/**
 * The query with every term on the facet's own field removed, so the facet
 * keeps counting its other values while the rest of the query applies. A
 * query that only named this facet becomes empty.
 */
export function queryWithoutFacet({
  queryText,
  facetKey,
}: {
  queryText: string;
  facetKey: string;
}): string {
  if (!queryText.trim()) return "";
  const next = filterAST(parse(queryText), (node) => !tagBelongsToFacet(node, facetKey));
  return isEmptyAST(next) ? "" : serialize(next);
}
