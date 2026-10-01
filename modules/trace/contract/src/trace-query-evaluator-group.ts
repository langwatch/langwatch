/**
 * Evaluator-scoped group mutations. Sub-conditions must stay scoped to one
 * evaluator via parentheses: (evaluator:X AND evaluatorVerdict:pass AND
 * evaluatorScore:[0 TO 0.5]). Rebuilds groups for stable toggle/clear semantics.
 */

import type { LiqeQuery, TagToken } from "liqe";

import { filterAST, walkAST } from "./trace-query-ast.ts";
import { escapeValue } from "./trace-query-mutations.ts";
import { isEmptyAST, parse, serialize } from "./trace-query-parser.ts";

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
const CATEGORICAL_SUB_FIELDS = new Set<string>([EVALUATOR_VERDICT_FIELD, EVALUATOR_LABEL_FIELD]);

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

function extractTagFieldName(node: TagToken): string | null {
  if (node.field.type === "ImplicitField") {
    return null;
  }
  return node.field.name;
}

/**
 * Find the `ParenthesizedExpression` that wraps a non-negated
 * `evaluator:<id>` tag — the canonical group this module produces. Returns the
 * node so callers can read its sub-conditions and strip it by location.
 */
function findGroupNode(ast: LiqeQuery, evaluatorId: string): LiqeQuery | null {
  let found: LiqeQuery | null = null;
  const visit = (node: LiqeQuery): void => {
    if (found) {
      return;
    }
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
      extractTagFieldName(node) === EVALUATOR_FIELD &&
      node.expression.type === "LiteralExpression" &&
      String(node.expression.value) === evaluatorId
    );
  }
  if (node.type === "LogicalExpression") {
    if (node.operator.operator !== "AND") {
      return false;
    }
    return (
      groupContainsEvaluator(node.left, evaluatorId) ||
      groupContainsEvaluator(node.right, evaluatorId)
    );
  }
  return false;
}

/** The score bound a `score:[a TO b]` / `score:>n` sub-condition names, or none. */
function parseScoreBound(
  tag: Extract<LiqeQuery, { type: "Tag" }>,
): { from?: number; to?: number } | null {
  if (tag.expression.type === "RangeExpression") {
    return { from: tag.expression.range.min, to: tag.expression.range.max };
  }
  if (tag.expression.type !== "LiteralExpression") return null;

  const op = tag.operator.operator;
  const raw = tag.expression.value;
  const num = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (!Number.isFinite(num)) return null;

  if (op === ":>" || op === ":>=") return { from: num };
  if (op === ":<" || op === ":<=") return { to: num };

  return null;
}

function readSubCondition(
  tag: Extract<LiqeQuery, { type: "Tag" }>,
  negated: boolean,
  group: EvaluatorGroup,
): void {
  const field = extractTagFieldName(tag);
  if (!field) return;

  if (CATEGORICAL_SUB_FIELDS.has(field)) {
    if (tag.expression.type !== "LiteralExpression") return;
    group.categorical.push({ field, value: String(tag.expression.value), negated });
    return;
  }

  if (field !== EVALUATOR_SCORE_FIELD || negated) return;

  const score = parseScoreBound(tag);
  if (score) group.score = score;
}

/** Collect verdict/label/score sub-conditions out of a located group's AND-chain. */
function readSubConditions(node: LiqeQuery, group: EvaluatorGroup): void {
  walkAST(node, (tag, negated) => {
    if (tag.type !== "Tag") return;
    readSubCondition(tag, negated, group);
  });
}

/**
 * Read evaluator group state from AST. Scopes verdict/label/score to one
 * evaluation without re-serialising (avoiding aliases across evaluators).
 */
export function readEvaluatorGroupFromAst(ast: LiqeQuery, evaluatorId: string): EvaluatorGroup {
  const group: EvaluatorGroup = {
    present: false,
    categorical: [],
    score: null,
  };

  // Anchor presence anywhere in the query (grouped or bare).
  walkAST(ast, (tag, negated) => {
    if (tag.type !== "Tag" || negated) {
      return;
    }
    const isEvaluatorAnchor =
      extractTagFieldName(tag) === EVALUATOR_FIELD &&
      tag.expression.type === "LiteralExpression" &&
      String(tag.expression.value) === evaluatorId;
    if (isEvaluatorAnchor) {
      group.present = true;
    }
  });

  const node = findGroupNode(ast, evaluatorId);
  if (node) {
    readSubConditions(node, group);
  }
  return group;
}

/** Convenience wrapper that parses a query string then reads its group state. */
export function readEvaluatorGroup(currentQuery: string, evaluatorId: string): EvaluatorGroup {
  if (!currentQuery.trim()) {
    return { present: false, categorical: [], score: null };
  }
  try {
    return readEvaluatorGroupFromAst(parse(currentQuery), evaluatorId);
  } catch {
    return { present: false, categorical: [], score: null };
  }
}

function categoricalClause(sub: CategoricalSub): string {
  const tag = `${sub.field}:${escapeValue(sub.value)}`;
  return sub.negated ? `NOT ${tag}` : tag;
}

/** Serialise the canonical group clause for an evaluator + its sub-conditions. */
function buildGroupClause(evaluatorId: string, group: EvaluatorGroup): string {
  const parts = [`${EVALUATOR_FIELD}:${escapeValue(evaluatorId)}`];
  for (const sub of group.categorical) {
    parts.push(categoricalClause(sub));
  }
  if (group.score) {
    const { from, to } = group.score;
    if (from !== void 0 && to !== void 0) {
      parts.push(`${EVALUATOR_SCORE_FIELD}:[${from} TO ${to}]`);
    } else if (from !== void 0) {
      parts.push(`${EVALUATOR_SCORE_FIELD}:>=${from}`);
    } else if (to !== void 0) {
      parts.push(`${EVALUATOR_SCORE_FIELD}:<=${to}`);
    }
  }
  // A lone anchor needs no parens — `(evaluator:X)` just adds noise.
  if (parts.length === 1) {
    return parts.join("");
  }
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
      if (tag.type === "Tag") {
        groupTags.add(tag);
      }
    });
  }
  return filterAST(ast, (n) => {
    if (n.type !== "Tag") {
      return true;
    }
    // Drop the located group's tags.
    if (groupTags.has(n)) {
      return false;
    }
    // Also drop any bare (ungrouped) anchor for this evaluator.
    const isBareEvaluatorAnchor =
      extractTagFieldName(n) === EVALUATOR_FIELD &&
      n.expression.type === "LiteralExpression" &&
      String(n.expression.value) === evaluatorId;
    if (isBareEvaluatorAnchor) {
      return false;
    }
    return true;
  });
}

/**
 * Core mutation: read the evaluator's group, apply `transform`, then rebuild
 * the query with the group removed and re-appended in canonical form. On
 * parse failure the original query returns unchanged.
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

  if (!base) {
    return clause;
  }
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
    const idx = group.categorical.findIndex((s) => s.field === field && s.value === value);
    if (idx < 0) {
      group.categorical.push({ field, value, negated: false });
    } else {
      const category = group.categorical[idx];
      if (category && !category.negated) {
        category.negated = true;
      } else {
        group.categorical.splice(idx, 1);
      }
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
    const fromNum = Number(from);
    const toNum = Number(to);
    // Guard non-numeric bounds — `Number("")`/`Number("x")` is NaN, and
    // `evaluatorScore:[NaN TO NaN]` is a liqe SyntaxError. Mirror the read
    // side, which only treats finite bounds as a real range.
    const hasFiniteBounds = Number.isFinite(fromNum) && Number.isFinite(toNum);
    group.score = hasFiniteBounds ? { from: fromNum, to: toNum } : null;
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
  if (!currentQuery.trim()) {
    return "";
  }
  return mutateEvaluatorGroup(currentQuery, evaluatorId, (group) => {
    group.score = null;
  });
}
