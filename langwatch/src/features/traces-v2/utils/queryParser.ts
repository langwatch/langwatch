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
 *   spans:>5                        — span count comparison
 *   spans:[10 TO 50]                — span count range
 *   "refund policy"                 — free-text search
 *   refund                          — unquoted free-text
 */

import {
  parse as liqeParse,
  serialize as liqeRawSerialize,
  SyntaxError as LiqeSyntaxError,
  type LiqeQuery,
} from "liqe";

export type { LiqeQuery };

/**
 * `liqe`'s serializer occasionally emits queries that its own parser then
 * rejects — most reliably the range form: `cost:[0.01 TO 1]AND foo:bar` (no
 * space between `]` and the next boolean operator). It also leaves runs of
 * whitespace intact when inner clauses are removed. Both round-trip into the
 * same `Invalid filter syntax` 422 from the backend.
 *
 * Normalise post-serialisation: insert a space between `]` / `)` and a
 * following `AND` / `OR` / `NOT`, and collapse adjacent whitespace.
 */
function normalizeQueryString(s: string): string {
  return s
    .replace(/([\]\)])(?=(?:AND|OR|NOT)\b)/gi, "$1 ")
    .replace(/\b(?:AND|OR|NOT)\b\s+/gi, (m) => m.replace(/\s+/g, " "))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function serialize(ast: LiqeQuery): string {
  return normalizeQueryString(liqeRawSerialize(ast));
}

const liqeSerialize = serialize;

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

const TOKEN_START_PRECEDERS = new Set([" ", "\t", "\n", "("]);

/**
 * Strip the `@` autocomplete trigger sigil before parsing. The `@` opens the
 * suggestion dropdown but is not valid liqe syntax — once the user submits,
 * any stray triggers need to be removed. Only strip `@` at token-start
 * positions and outside quoted strings, so a literal `@` inside a value like
 * `"user@example.com"` is preserved.
 */
export function stripAtSigils(text: string): string {
  let out = "";
  let inQuotes = false;
  let quoteChar = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      out += ch;
      if (ch === quoteChar) inQuotes = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      out += ch;
      inQuotes = true;
      quoteChar = ch;
      continue;
    }
    if (ch === "@") {
      const prev = i === 0 ? undefined : text[i - 1];
      if (prev === undefined || TOKEN_START_PRECEDERS.has(prev)) continue;
    }
    out += ch;
  }
  return out;
}

export function parse(query: string): LiqeQuery {
  const trimmed = stripAtSigils(query).trim();
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

/**
 * Walk the AST after a successful syntactic parse and reject queries the
 * server can't execute. Catches `field:` (no value) — liqe parses it as a
 * `Tag` whose expression is `EmptyExpression`, but the backend rejects with a
 * 422. Returning the error here lets the SearchBar surface red-border feedback
 * and prevents the doomed query from being committed and re-fired by polling.
 */
export function validateAst(ast: LiqeQuery): string | null {
  if (ast.type === "Tag") {
    if (ast.expression.type === "EmptyExpression") {
      const fieldName =
        ast.field.type === "ImplicitField" ? "" : ast.field.name;
      return fieldName
        ? `Missing value after \`${fieldName}:\``
        : "Missing value after `:`";
    }
    return null;
  }
  if (ast.type === "UnaryOperator") return validateAst(ast.operand);
  if (ast.type === "LogicalExpression") {
    return validateAst(ast.left) ?? validateAst(ast.right);
  }
  if (ast.type === "ParenthesizedExpression") {
    return validateAst(ast.expression);
  }
  return null;
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
  evaluatorStatus: { label: "Evaluator Status", hasSidebar: true, facetField: "evaluatorStatus", valueType: "categorical" },
  evaluatorPassed: { label: "Evaluator Verdict", hasSidebar: true, facetField: "evaluatorPassed", valueType: "categorical" },
  evaluatorScore: { label: "Evaluator Score", hasSidebar: true, facetField: "evaluatorScore", valueType: "range" },
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
  evaluatorStatus: ["scheduled", "in_progress", "processed", "skipped", "error"],
  evaluatorPassed: ["pass", "fail", "unknown"],
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
