/**
 * Evaluator-scoped group mutations. The sidebar's evaluator drilldown lets a
 * user pin verdict / score / label sub-conditions onto a single
 * `evaluator:<id>` filter. Those sub-conditions must stay scoped to that one
 * evaluation — `evaluator:X AND evaluatorVerdict:pass` as two flat top-level
 * clauses mis-binds the moment another OR/AND filter joins the query. So the
 * drilldown emits them as one parenthesised AND group:
 *
 *   (evaluator:X AND evaluatorVerdict:pass AND evaluatorScore:[0 TO 0.5])
 *
 * Every mutation here reads the evaluator's current group out of the AST,
 * applies the requested change, removes the whole group, then re-appends the
 * canonical form. Rebuilding (rather than splicing) keeps the group shape
 * stable and the toggle/clear semantics simple: clicking a sub-condition again
 * removes just that one; removing the evaluator removes the whole group.
 *
 * Scope note: sub-condition state is keyed by `(evaluatorId, field, value)`
 * within the located group, so multiple active evaluators each keep their own
 * verdict/score/label set. The one carried-over limitation from the previous
 * flat implementation is that two evaluators are still disambiguated purely by
 * the `evaluator:<id>` anchor inside their group — a hand-typed query that puts
 * two evaluators in the *same* parens will be treated as a single group.
 */

import type { LiqeQuery, TagToken } from "liqe";
import { isEmptyAST, parse, serialize } from "./parse";
import { filterAST, walkAST } from "./walk";

export const EVALUATOR_FIELD = "evaluator";
export const EVALUATOR_VERDICT_FIELD = "evaluatorVerdict";
export const EVALUATOR_SCORE_FIELD = "evaluatorScore";
/**
 * Per-evaluator emitted-label filter. Mirrors `evaluatorVerdict`: a categorical
 * value scoped to one evaluation's group, translated to an `evaluation_runs`
 * subquery on the `Label` column (see the `evaluatorLabel` facet definition).
 */
export const EVALUATOR_LABEL_FIELD = "evaluatorLabel";

/** The categorical sub-condition fields a single evaluator group can carry. */
const CATEGORICAL_SUB_FIELDS = new Set<string>([
  EVALUATOR_VERDICT_FIELD,
  EVALUATOR_LABEL_FIELD,
]);

export interface CategoricalSub {
  field: string;
  value: string;
  negated: boolean;
}

export interface ScoreSub {
  from?: number;
  to?: number;
}

export interface EvaluatorGroup {
  /** Whether the evaluator anchor exists anywhere in the query. */
  present: boolean;
  categorical: CategoricalSub[];
  score: ScoreSub | null;
}

function tagFieldName(node: TagToken): string | null {
  if (node.field.type === "ImplicitField") return null;
  return (node.field as { name: string }).name;
}

/**
 * Find the `ParenthesizedExpression` that wraps a non-negated
 * `evaluator:<id>` tag — the canonical group this module produces. Returns the
 * node so callers can read its sub-conditions and strip it by location.
 */
function findGroupNode(ast: LiqeQuery, evaluatorId: string): LiqeQuery | null {
  let found: LiqeQuery | null = null;
  const visit = (node: LiqeQuery): void => {
    if (found) return;
    if (node.type === "ParenthesizedExpression") {
      if (groupContainsEvaluator(node.expression, evaluatorId)) {
        found = node;
        return;
      }
      visit(node.expression);
      return;
    }
    if (node.type === "LogicalExpression") {
      visit(node.left);
      visit(node.right);
      return;
    }
    if (node.type === "UnaryOperator") {
      visit(node.operand);
    }
  };
  visit(ast);
  return found;
}

/**
 * True when an AND-chain has the evaluator anchor as a non-negated direct
 * member. We only follow AND `LogicalExpression`s — an OR inside the parens
 * isn't a drilldown-produced group, so we leave it alone.
 */
function groupContainsEvaluator(node: LiqeQuery, evaluatorId: string): boolean {
  if (node.type === "Tag") {
    return (
      tagFieldName(node) === EVALUATOR_FIELD &&
      node.expression.type === "LiteralExpression" &&
      String(node.expression.value) === evaluatorId
    );
  }
  if (node.type === "LogicalExpression") {
    if (node.operator.operator !== "AND") return false;
    return (
      groupContainsEvaluator(node.left, evaluatorId) ||
      groupContainsEvaluator(node.right, evaluatorId)
    );
  }
  return false;
}

/** Collect verdict/label/score sub-conditions out of a located group's AND-chain. */
function readSubConditions(node: LiqeQuery, group: EvaluatorGroup): void {
  walkAST(node, (tag, negated) => {
    if (tag.type !== "Tag") return;
    const field = tagFieldName(tag);
    if (!field) return;
    if (CATEGORICAL_SUB_FIELDS.has(field)) {
      if (tag.expression.type !== "LiteralExpression") return;
      group.categorical.push({
        field,
        value: String(tag.expression.value),
        negated,
      });
      return;
    }
    if (field === EVALUATOR_SCORE_FIELD && !negated) {
      if (tag.expression.type === "RangeExpression") {
        group.score = {
          from: tag.expression.range.min,
          to: tag.expression.range.max,
        };
        return;
      }
      if (tag.expression.type === "LiteralExpression") {
        const op = tag.operator.operator;
        const raw = tag.expression.value;
        const num = typeof raw === "number" ? raw : parseFloat(String(raw));
        if (!Number.isFinite(num)) return;
        if (op === ":>" || op === ":>=") group.score = { from: num };
        else if (op === ":<" || op === ":<=") group.score = { to: num };
      }
    }
  });
}

/**
 * Read the current state of an evaluator's group directly from a parsed AST.
 * When the evaluator anchor sits outside any group (e.g. a bare top-level
 * `evaluator:X`), `present` is still true but sub-conditions are empty.
 *
 * Exposed so the sidebar drilldown can render verdict / label / score active
 * state scoped to one evaluation without re-serialising — the global readers
 * (`getFacetValueState`, `getRangeValue`) would alias two active evaluators
 * that share a verdict value.
 */
export function readEvaluatorGroupFromAst(
  ast: LiqeQuery,
  evaluatorId: string,
): EvaluatorGroup {
  const group: EvaluatorGroup = {
    present: false,
    categorical: [],
    score: null,
  };

  // Anchor presence anywhere in the query (grouped or bare).
  walkAST(ast, (tag, negated) => {
    if (tag.type !== "Tag" || negated) return;
    if (
      tagFieldName(tag) === EVALUATOR_FIELD &&
      tag.expression.type === "LiteralExpression" &&
      String(tag.expression.value) === evaluatorId
    ) {
      group.present = true;
    }
  });

  const node = findGroupNode(ast, evaluatorId);
  if (node) readSubConditions(node, group);
  return group;
}

/** Convenience wrapper that parses a query string then reads its group state. */
export function readEvaluatorGroup(
  currentQuery: string,
  evaluatorId: string,
): EvaluatorGroup {
  if (!currentQuery.trim()) {
    return { present: false, categorical: [], score: null };
  }
  try {
    return readEvaluatorGroupFromAst(parse(currentQuery), evaluatorId);
  } catch {
    return { present: false, categorical: [], score: null };
  }
}

function escapeValue(value: string): string {
  if (value === "" || !/^[A-Za-z0-9_.-]+$/.test(value)) {
    return `"${value.replace(/[\\"]/g, "\\$&")}"`;
  }
  return value;
}

function categoricalClause(sub: CategoricalSub): string {
  const tag = `${sub.field}:${escapeValue(sub.value)}`;
  return sub.negated ? `NOT ${tag}` : tag;
}

/** Serialise the canonical group clause for an evaluator + its sub-conditions. */
function buildGroupClause(evaluatorId: string, group: EvaluatorGroup): string {
  const parts = [`${EVALUATOR_FIELD}:${escapeValue(evaluatorId)}`];
  for (const sub of group.categorical) parts.push(categoricalClause(sub));
  if (group.score) {
    const { from, to } = group.score;
    if (from !== undefined && to !== undefined) {
      parts.push(`${EVALUATOR_SCORE_FIELD}:[${from} TO ${to}]`);
    } else if (from !== undefined) {
      parts.push(`${EVALUATOR_SCORE_FIELD}:>=${from}`);
    } else if (to !== undefined) {
      parts.push(`${EVALUATOR_SCORE_FIELD}:<=${to}`);
    }
  }
  // A lone anchor needs no parens — `(evaluator:X)` just adds noise.
  if (parts.length === 1) return parts[0]!;
  return `(${parts.join(" AND ")})`;
}

/**
 * Strip the entire evaluator group (the anchor tag plus every sub-condition
 * tag that travels with it) from the query, leaving unrelated clauses intact.
 * `filterAST` collapses the orphaned parens / operators.
 */
function stripGroup(ast: LiqeQuery, evaluatorId: string): LiqeQuery {
  const node = findGroupNode(ast, evaluatorId);
  // Tags that belong to the group — by reference identity, so we never strip an
  // identical sub-condition that belongs to a *different* evaluator's group.
  const groupTags = new Set<LiqeQuery>();
  if (node) {
    walkAST(node, (tag) => {
      if (tag.type === "Tag") groupTags.add(tag);
    });
  }
  return filterAST(ast, (n) => {
    if (n.type !== "Tag") return true;
    // Drop the located group's tags.
    if (groupTags.has(n)) return false;
    // Also drop any bare (ungrouped) anchor for this evaluator.
    if (
      tagFieldName(n) === EVALUATOR_FIELD &&
      n.expression.type === "LiteralExpression" &&
      String(n.expression.value) === evaluatorId
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Core mutation: read the evaluator's group, apply `transform`, then rebuild
 * the query with the group removed and re-appended in canonical form. On parse
 * failure the original query is returned unchanged (matching the rest of the
 * mutation helpers).
 */
function mutateEvaluatorGroup(
  currentQuery: string,
  evaluatorId: string,
  transform: (group: EvaluatorGroup) => void,
): string {
  let ast: LiqeQuery;
  try {
    ast = currentQuery.trim() ? parse(currentQuery) : parse("");
  } catch {
    return currentQuery;
  }

  const group = readEvaluatorGroup(currentQuery, evaluatorId);
  transform(group);

  const stripped = stripGroup(ast, evaluatorId);
  const base = isEmptyAST(stripped) ? "" : serialize(stripped);
  const clause = buildGroupClause(evaluatorId, group);

  if (!base) return clause;
  return `${base} AND ${clause}`;
}

/**
 * Toggle a categorical sub-condition (verdict / label) through
 * neutral → include → exclude → neutral, scoped to the evaluator's group.
 * Adding any sub-condition implicitly ensures the evaluator anchor exists.
 */
export function toggleEvaluatorSubFilterInQuery({
  currentQuery,
  evaluatorId,
  field,
  value,
}: {
  currentQuery: string;
  evaluatorId: string;
  field: string;
  value: string;
}): string {
  return mutateEvaluatorGroup(currentQuery, evaluatorId, (group) => {
    const idx = group.categorical.findIndex(
      (s) => s.field === field && s.value === value,
    );
    if (idx < 0) {
      group.categorical.push({ field, value, negated: false });
    } else if (!group.categorical[idx]!.negated) {
      group.categorical[idx]!.negated = true;
    } else {
      group.categorical.splice(idx, 1);
    }
  });
}

/** Set the evaluator group's score range, ensuring the anchor exists. */
export function setEvaluatorScoreRangeInQuery({
  currentQuery,
  evaluatorId,
  from,
  to,
}: {
  currentQuery: string;
  evaluatorId: string;
  from: string;
  to: string;
}): string {
  return mutateEvaluatorGroup(currentQuery, evaluatorId, (group) => {
    group.score = { from: Number(from), to: Number(to) };
  });
}

/** Clear just the score range from the evaluator group, keeping other subs. */
export function removeEvaluatorScoreRangeInQuery({
  currentQuery,
  evaluatorId,
}: {
  currentQuery: string;
  evaluatorId: string;
}): string {
  if (!currentQuery.trim()) return "";
  return mutateEvaluatorGroup(currentQuery, evaluatorId, (group) => {
    group.score = null;
  });
}
