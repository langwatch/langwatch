/**
 * Query language utilities built on top of liqe (Lucene-like parser).
 *
 * Syntax examples:
 *   status:error                    — exact match
 *   status:error AND model:gpt-4o   — boolean AND
 *   status:error OR model:gpt-4o    — boolean OR
 *   NOT status:error                — negation
 *   -status:error                   — negation (shorthand)
 *   (status:error OR status:warning) AND model:gpt-4o — grouping
 *   model:gpt*                      — wildcard
 *   cost:>0.01                      — comparison
 *   cost:[0.01 TO 1.00]             — range
 *   "refund policy"                 — free-text search
 *   refund                          — unquoted free-text
 */

import {
  parse as liqeParse,
  serialize as liqeSerialize,
  SyntaxError as LiqeSyntaxError,
  type LiqeQuery,
} from "liqe";

export type { LiqeQuery };
export { liqeSerialize as serialize };

const EMPTY_AST: LiqeQuery = {
  type: "EmptyExpression",
  location: { start: 0, end: 0 },
};

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly position?: number,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export function parse(query: string): LiqeQuery {
  const trimmed = query.trim();
  if (trimmed.length === 0) return EMPTY_AST;
  try {
    return liqeParse(trimmed);
  } catch (e) {
    if (e instanceof LiqeSyntaxError) {
      throw new ParseError(e.message, (e as { offset?: number }).offset);
    }
    throw new ParseError(
      "Invalid query syntax — check for unmatched quotes or parentheses.",
    );
  }
}

export function isEmptyAST(ast: LiqeQuery): boolean {
  return ast.type === "EmptyExpression";
}

export interface SearchFieldMeta {
  label: string;
  hasSidebar: boolean;
  facetField?: string;
  valueType: "categorical" | "range" | "text" | "existence";
}

export const SEARCH_FIELDS: Readonly<Record<string, SearchFieldMeta>> = {
  origin: { label: "Origin", hasSidebar: true, facetField: "origin", valueType: "categorical" },
  status: { label: "Status", hasSidebar: true, facetField: "status", valueType: "categorical" },
  model: { label: "Model", hasSidebar: true, facetField: "model", valueType: "categorical" },
  service: { label: "Service", hasSidebar: true, facetField: "service", valueType: "categorical" },
  cost: { label: "Cost", hasSidebar: true, facetField: "cost", valueType: "range" },
  duration: { label: "Duration", hasSidebar: true, facetField: "duration", valueType: "range" },
  tokens: { label: "Tokens", hasSidebar: true, facetField: "tokens", valueType: "range" },
  user: { label: "User", hasSidebar: false, valueType: "text" },
  conversation: { label: "Conversation", hasSidebar: false, valueType: "text" },
  scenario: { label: "Scenario", hasSidebar: false, valueType: "text" },
  scenarioRun: { label: "Scenario run", hasSidebar: false, valueType: "text" },
  scenarioSet: { label: "Scenario set", hasSidebar: false, valueType: "text" },
  scenarioBatch: { label: "Scenario batch", hasSidebar: false, valueType: "text" },
  scenarioVerdict: { label: "Scenario verdict", hasSidebar: false, valueType: "categorical" },
  scenarioStatus: { label: "Scenario status", hasSidebar: false, valueType: "categorical" },
  has: { label: "Has", hasSidebar: false, valueType: "existence" },
  none: { label: "None", hasSidebar: false, valueType: "existence" },
  event: { label: "Event", hasSidebar: false, valueType: "text" },
  eval: { label: "Eval", hasSidebar: false, valueType: "text" },
  trace: { label: "Trace", hasSidebar: false, valueType: "text" },
};

/** Field names whose tokens render with the scenario accent in the search bar. */
export const SCENARIO_FIELDS: ReadonlySet<string> = new Set([
  "scenario",
  "scenarioRun",
  "scenarioSet",
  "scenarioBatch",
  "scenarioVerdict",
  "scenarioStatus",
]);

export const FIELD_NAMES: ReadonlyArray<string> = Object.keys(SEARCH_FIELDS);

const HAS_NONE_VALUES: string[] = [
  "error",
  "eval",
  "feedback",
  "annotation",
  "conversation",
  "user",
  "topic",
  "subtopic",
  "label",
];

/** Known values for autocomplete suggestions. */
export const FIELD_VALUES: Record<string, string[]> = {
  status: ["error", "warning", "ok"],
  origin: ["application", "simulation", "evaluation"],
  has: HAS_NONE_VALUES,
  none: HAS_NONE_VALUES,
  scenarioVerdict: ["success", "failure", "inconclusive"],
  scenarioStatus: [
    "running",
    "success",
    "failed",
    "error",
    "cancelled",
    "stalled",
    "pending",
    "queued",
  ],
};

export type FacetState = "neutral" | "include" | "exclude";

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
  const leftField = getTopField(ast.left);
  const rightField = getTopField(ast.right);
  if (leftField && rightField && leftField !== rightField) return true;
  return hasCrossFacetOR(ast.left) || hasCrossFacetOR(ast.right);
}

function getTopField(ast: LiqeQuery): string | null {
  if (ast.type === "Tag") {
    return ast.field.type === "ImplicitField" ? null : ast.field.name;
  }
  if (ast.type === "UnaryOperator") return getTopField(ast.operand);
  return null;
}

/**
 * Toggle a facet value through three states: neutral → include → exclude → neutral.
 * Instead of mutating the AST directly, we serialize → modify string → re-parse.
 * This keeps liqe as the single source of truth for AST structure.
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
    return isEmptyAST(next) ? "" : liqeSerialize(next);
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
    return isEmptyAST(next) ? "" : liqeSerialize(next);
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

/**
 * Filter AST nodes, removing those for which predicate returns false.
 * Reconstructs the tree, collapsing logical expressions as needed.
 */
function filterAST(
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
    return { ...ast, expression: inner };
  }

  return ast;
}

/** Walk all nodes in the AST, tracking negation context. */
function walkAST(
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
