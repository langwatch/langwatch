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
  type TagToken,
  type UnaryOperatorToken,
  type LogicalExpressionToken,
  type ParenthesizedExpressionToken,
} from "liqe";

export type { LiqeQuery, TagToken, UnaryOperatorToken };

// Re-export parse/serialize with error handling
export { liqeSerialize as serialize };

export class ParseError extends Error {
  constructor(
    message: string,
    public position?: number,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export function parse(query: string): LiqeQuery {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { type: "EmptyExpression", location: { start: 0, end: 0 } };
  }
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

// ─── Known search fields ──────────────────────────────────────────────────────

export interface SearchFieldMeta {
  label: string;
  hasSidebar: boolean;
  facetField?: string;
  valueType: "categorical" | "range" | "text" | "existence";
}

export const SEARCH_FIELDS: Record<string, SearchFieldMeta> = {
  origin: {
    label: "Origin",
    hasSidebar: true,
    facetField: "origin",
    valueType: "categorical",
  },
  status: {
    label: "Status",
    hasSidebar: true,
    facetField: "status",
    valueType: "categorical",
  },
  model: {
    label: "Model",
    hasSidebar: true,
    facetField: "model",
    valueType: "categorical",
  },
  service: {
    label: "Service",
    hasSidebar: true,
    facetField: "service",
    valueType: "categorical",
  },
  cost: {
    label: "Cost",
    hasSidebar: true,
    facetField: "cost",
    valueType: "range",
  },
  duration: {
    label: "Duration",
    hasSidebar: true,
    facetField: "duration",
    valueType: "range",
  },
  tokens: {
    label: "Tokens",
    hasSidebar: true,
    facetField: "tokens",
    valueType: "range",
  },
  user: { label: "User", hasSidebar: false, valueType: "text" },
  conversation: { label: "Conversation", hasSidebar: false, valueType: "text" },
  has: { label: "Has", hasSidebar: false, valueType: "existence" },
  none: { label: "None", hasSidebar: false, valueType: "existence" },
  event: { label: "Event", hasSidebar: false, valueType: "text" },
  eval: { label: "Eval", hasSidebar: false, valueType: "text" },
  trace: { label: "Trace", hasSidebar: false, valueType: "text" },
};

export const FIELD_NAMES = Object.keys(SEARCH_FIELDS);

/** Known values for autocomplete suggestions */
const HAS_NONE_VALUES = [
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

export const FIELD_VALUES: Record<string, string[]> = {
  status: ["error", "warning", "ok"],
  origin: ["application", "simulation", "evaluation"],
  has: HAS_NONE_VALUES,
  none: HAS_NONE_VALUES,
};

// ─── AST walking utilities ────────────────────────────────────────────────────

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

    const val = String(node.expression.value);
    if (negated) {
      exclude.push(val);
    } else {
      include.push(val);
    }
  });

  return { include, exclude };
}

/** Get the state of a specific facet value */
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

/** Get a range value from the AST for a field */
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
    } else if (
      node.expression.type === "LiteralExpression" &&
      node.operator.operator !== ":"
    ) {
      const val =
        typeof node.expression.value === "number"
          ? node.expression.value
          : parseFloat(String(node.expression.value));
      if (node.operator.operator === ":>") result = { from: val };
      if (node.operator.operator === ":<") result = { to: val };
      if (node.operator.operator === ":>=") result = { from: val };
      if (node.operator.operator === ":<=") result = { to: val };
    }
  });

  return result;
}

/** Check if there's a cross-facet OR at the top level */
export function hasCrossFacetOR(ast: LiqeQuery): boolean {
  if (ast.type !== "LogicalExpression") return false;
  const logExpr = ast as LogicalExpressionToken;
  if (logExpr.operator.operator !== "OR") return false;

  const leftField = getTopField(logExpr.left);
  const rightField = getTopField(logExpr.right);
  if (leftField && rightField && leftField !== rightField) return true;

  // Recurse
  return hasCrossFacetOR(logExpr.left) || hasCrossFacetOR(logExpr.right);
}

function getTopField(ast: LiqeQuery): string | null {
  if (ast.type === "Tag") {
    const tag = ast as TagToken;
    return tag.field.type === "ImplicitField" ? null : tag.field.name;
  }
  if (ast.type === "UnaryOperator") {
    return getTopField((ast as UnaryOperatorToken).operand);
  }
  return null;
}

// ─── AST mutation (build query strings, let liqe re-parse) ───────────────────

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
  // Remove the value from the current query first
  const cleaned = removeFacetValueFromQuery(currentQuery, fieldName, value);

  if (currentState === "neutral") {
    // neutral → include: add field:value
    return appendClause(cleaned, `${fieldName}:${escapeValue(value)}`);
  }
  if (currentState === "include") {
    // include → exclude: add NOT field:value
    return appendClause(cleaned, `NOT ${fieldName}:${escapeValue(value)}`);
  }
  // exclude → neutral: just return cleaned
  return cleaned;
}

/** Set a range filter in the query string */
export function setRangeInQuery(
  currentQuery: string,
  fieldName: string,
  from: string,
  to: string,
): string {
  const cleaned = removeFieldFromQuery(currentQuery, fieldName);
  return appendClause(cleaned, `${fieldName}:[${from} TO ${to}]`);
}

/** Remove all clauses for a field from the query */
export function removeFieldFromQuery(
  currentQuery: string,
  fieldName: string,
): string {
  if (!currentQuery.trim()) return "";
  try {
    const ast = parse(currentQuery);
    const newAst = removeFieldFromAST(ast, fieldName);
    if (isEmptyAST(newAst)) return "";
    return liqeSerialize(newAst);
  } catch {
    return currentQuery;
  }
}

/** Remove a specific value for a field from the query */
export function removeFacetValueFromQuery(
  currentQuery: string,
  fieldName: string,
  value: string,
): string {
  if (!currentQuery.trim()) return "";
  try {
    const ast = parse(currentQuery);
    const newAst = removeValueFromAST(ast, fieldName, value);
    if (isEmptyAST(newAst)) return "";
    return liqeSerialize(newAst);
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
  if (/[\s"()]/.test(value)) {
    return `"${value}"`;
  }
  return value;
}

// ─── AST tree surgery ─────────────────────────────────────────────────────────

function removeFieldFromAST(ast: LiqeQuery, fieldName: string): LiqeQuery {
  return filterAST(ast, (node) => {
    if (node.type !== "Tag") return true;
    const tag = node as TagToken;
    if (tag.field.type === "ImplicitField") return true;
    return tag.field.name !== fieldName;
  });
}

function removeValueFromAST(
  ast: LiqeQuery,
  fieldName: string,
  value: string,
): LiqeQuery {
  return filterAST(ast, (node) => {
    if (node.type !== "Tag") return true;
    const tag = node as TagToken;
    if (tag.field.type === "ImplicitField") return true;
    if (tag.field.name !== fieldName) return true;
    if (tag.expression.type !== "LiteralExpression") return true;
    return String(tag.expression.value) !== value;
  });
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
    return predicate(ast)
      ? ast
      : { type: "EmptyExpression", location: { start: 0, end: 0 } };
  }

  if (ast.type === "UnaryOperator") {
    const unary = ast as UnaryOperatorToken;
    const inner = filterAST(unary.operand, predicate);
    if (isEmptyAST(inner)) {
      return { type: "EmptyExpression", location: { start: 0, end: 0 } };
    }
    // Check if the inner tag should be removed
    if (!predicate(unary.operand)) {
      return { type: "EmptyExpression", location: { start: 0, end: 0 } };
    }
    return ast;
  }

  if (ast.type === "LogicalExpression") {
    const logExpr = ast as LogicalExpressionToken;
    const left = filterAST(logExpr.left, predicate);
    const right = filterAST(logExpr.right, predicate);

    if (isEmptyAST(left) && isEmptyAST(right)) {
      return { type: "EmptyExpression", location: { start: 0, end: 0 } };
    }
    if (isEmptyAST(left)) return right;
    if (isEmptyAST(right)) return left;

    return { ...logExpr, left, right } as LiqeQuery;
  }

  if (ast.type === "ParenthesizedExpression") {
    const paren = ast as ParenthesizedExpressionToken;
    const inner = filterAST(paren.expression, predicate);
    if (isEmptyAST(inner)) {
      return { type: "EmptyExpression", location: { start: 0, end: 0 } };
    }
    return { ...paren, expression: inner } as LiqeQuery;
  }

  return ast;
}

/** Walk all nodes in the AST, tracking negation context */
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
    const unary = ast as UnaryOperatorToken;
    const isNeg =
      unary.operator === "NOT" || unary.operator === "-";
    walkAST(unary.operand, callback, negated !== isNeg);
    return;
  }

  if (ast.type === "LogicalExpression") {
    const logExpr = ast as LogicalExpressionToken;
    walkAST(logExpr.left, callback, negated);
    walkAST(logExpr.right, callback, negated);
    return;
  }

  if (ast.type === "ParenthesizedExpression") {
    const paren = ast as ParenthesizedExpressionToken;
    walkAST(paren.expression, callback, negated);
    return;
  }
}
