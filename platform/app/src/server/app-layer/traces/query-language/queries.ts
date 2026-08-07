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
function validateTagAst(
  ast: Extract<LiqeQuery, { type: "Tag" }>,
): string | null {
  if (ast.expression.type !== "EmptyExpression") return null;
  const fieldName = ast.field.type === "ImplicitField" ? "" : ast.field.name;
  return fieldName
    ? `Missing value after \`${fieldName}:\``
    : "Missing value after `:`";
}

export function validateAst(ast: LiqeQuery): string | null {
  if (ast.type === "Tag") return validateTagAst(ast);
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
/** The literal value of a Tag matching `fieldName`, or null when the node doesn't match. */
function facetTagValue(node: LiqeQuery, fieldName: string): string | null {
  if (node.type !== "Tag") return null;
  if (node.field.type === "ImplicitField") return null;
  if (node.field.name !== fieldName) return null;
  if (node.expression.type !== "LiteralExpression") return null;
  return String(node.expression.value);
}

export function getFacetValues(
  ast: LiqeQuery,
  fieldName: string,
): { include: string[]; exclude: string[] } {
  const include: string[] = [];
  const exclude: string[] = [];

  walkAST(ast, (node, negated) => {
    const value = facetTagValue(node, fieldName);
    if (value === null) return;
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

/** The `{ from?, to? }` bounds a literal comparison operator carries, or null. */
function deriveRangeFromComparison(
  op: string,
  raw: unknown,
): { from?: number; to?: number } | null {
  if (op === ":") return null;
  const num = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (!Number.isFinite(num)) return null;
  if (op === ":>" || op === ":>=") return { from: num };
  if (op === ":<" || op === ":<=") return { to: num };
  return null;
}

/** The range/comparison bounds carried by a Tag matching `fieldName`, or null. */
function deriveRangeFromTag(
  node: LiqeQuery,
  fieldName: string,
): { from?: number; to?: number } | null {
  if (node.type !== "Tag") return null;
  if (node.field.type === "ImplicitField") return null;
  if (node.field.name !== fieldName) return null;

  if (node.expression.type === "RangeExpression") {
    return { from: node.expression.range.min, to: node.expression.range.max };
  }

  if (node.expression.type !== "LiteralExpression") return null;
  return deriveRangeFromComparison(
    node.operator.operator,
    node.expression.value,
  );
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
    const derived = deriveRangeFromTag(node, fieldName);
    if (derived) result = derived;
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
 * Cross-facet OR group: a `LogicalExpression` whose OR-joined branches
 * span more than one field. The sidebar reads this to render its
 * "linked" badge + connector and to decide which facet rows belong to
 * which OR group.
 *
 * `id` is a stable hash of the group's location so consumers can use
 * it for coloring / connector-line keying without having to re-derive
 * it on every render.
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
   * Field → list of group ids whose members include this field. A field
   * can appear in multiple disjoint OR groups, so this is a list rather
   * than a single id (e.g. `(status:error OR model:gpt-4) AND
   * (status:warning OR service:api)` — `status` is in both groups).
   * Sidebar consumers that want a single representative group should
   * pick `[0]`; consumers that want all peers should iterate.
   */
  fieldToGroupIds: Map<string, string[]>;
}

function memberKey(field: string, value: string): string {
  return `${field}|${value}`;
}

interface OrGroupsState {
  groups: OrGroup[];
  memberToGroupId: Map<string, string>;
  fieldToGroupIds: Map<string, string[]>;
}

/** Record a located OR group and index its members/fields into `state`. */
function recordOrGroup(
  node: Extract<LiqeQuery, { type: "LogicalExpression" }>,
  members: OrGroupMember[],
  state: OrGroupsState,
): void {
  const id = `or-${node.location.start}-${node.location.end}`;
  const fields = new Set(members.map((m) => m.field));
  state.groups.push({
    id,
    fields,
    members,
    start: node.location.start,
    end: node.location.end,
  });
  for (const m of members) {
    state.memberToGroupId.set(memberKey(m.field, m.value), id);
  }
  for (const f of fields) {
    const existing = state.fieldToGroupIds.get(f);
    if (existing) {
      if (!existing.includes(id)) existing.push(id);
    } else {
      state.fieldToGroupIds.set(f, [id]);
    }
  }
}

function visitForOrGroups(node: LiqeQuery, state: OrGroupsState): void {
  if (node.type === "LogicalExpression") {
    if (node.operator.operator === "OR") {
      const members = collectOrMembers(node);
      if (members.length > 1) {
        recordOrGroup(node, members, state);
        return;
      }
    }
    visitForOrGroups(node.left, state);
    visitForOrGroups(node.right, state);
    return;
  }
  if (node.type === "UnaryOperator") {
    visitForOrGroups(node.operand, state);
    return;
  }
  if (node.type === "ParenthesizedExpression") {
    visitForOrGroups(node.expression, state);
  }
}

/**
 * Walk the AST and produce a structured map of every OR group. A
 * group is any `LogicalExpression` (op = OR) with two or more Tag
 * descendants — *including* same-field ORs like
 * `(status:error OR status:warning)`, which the sidebar can already
 * render as multiple selected values within one section but for
 * which the user still wants the connector line as visual
 * confirmation that those values are linked. Nested OR subtrees are
 * flattened into the same group — the visual treatment doesn't
 * distinguish `(a OR b OR c)` from `((a OR b) OR c)`.
 */
export function analyzeOrGroups(ast: LiqeQuery): OrGroupAnalysis {
  const state: OrGroupsState = {
    groups: [],
    memberToGroupId: new Map<string, string>(),
    fieldToGroupIds: new Map<string, string[]>(),
  };

  visitForOrGroups(ast, state);

  return state;
}

/** The single-Tag OR member `node` represents, or [] when it can't be one. */
function tagToOrMember(
  node: Extract<LiqeQuery, { type: "Tag" }>,
  negated: boolean,
): OrGroupMember[] {
  if (node.field.type === "ImplicitField") return [];
  if (node.expression.type !== "LiteralExpression") return [];
  return [
    {
      field: (node.field as { name: string }).name,
      value: String(node.expression.value),
      negated,
      start: node.location.start,
      end: node.location.end,
    },
  ];
}

function collectOrMembers(node: LiqeQuery, negated = false): OrGroupMember[] {
  // Flatten nested OR LogicalExpressions but stop at AND boundaries —
  // an AND inside an OR group is treated as opaque (the sidebar can't
  // represent it), so the caller's group.members may not enumerate
  // every Tag. That's fine for visualisation; the warning still
  // surfaces if the user expects the sidebar to be authoritative.
  if (node.type === "LogicalExpression") {
    if (node.operator.operator === "OR") {
      return [
        ...collectOrMembers(node.left, negated),
        ...collectOrMembers(node.right, negated),
      ];
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
    return tagToOrMember(node, negated);
  }
  return [];
}
