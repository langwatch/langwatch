import {
  describeAstProblem,
  DYNAMIC_PREFIXES,
  FIELD_VALUES,
  ParseError,
  parse,
  SCENARIO_FIELDS,
  SEARCH_FIELDS,
  stripAtSigils,
  walkAST,
  type SearchFieldMeta,
} from "@langwatch/trace-contract";
/**
 * Bridges condition builder and liqe queries; null when query exceeds builder representation.
 */
import type { LiqeQuery, ParserAst, TagToken } from "liqe";

/** Comparators the builder exposes. Categorical / text / existence fields get
 *  `is` / `is_not`; range fields get the numeric comparators plus `between`. */
export type ConditionOperator = "is" | "is_not" | "gt" | "gte" | "lt" | "lte" | "between";

export interface Condition {
  /** Stable key for React list rendering — never serialised. */
  id: string;
  /** Raw query field, e.g. `status`, `cost`, `trace.metadata.user_id`. */
  field: string;
  operator: ConditionOperator;
  /** The (single) value, or the lower bound for `between`. */
  value: string;
  /** Upper bound, used only by `between`. */
  valueTo?: string;
}

export type ConditionValueType = SearchFieldMeta["valueType"];

const RANGE_OPERATORS: ConditionOperator[] = ["gt", "gte", "lt", "lte", "between"];
const MEMBERSHIP_OPERATORS: ConditionOperator[] = ["is", "is_not"];

/** Which comparators apply to a field, keyed off its value-type. Unknown
 *  fields (dynamic attributes, custom metadata) are treated as free text. */
export function operatorsForValueType(
  valueType: SearchFieldMeta["valueType"] | undefined,
): ConditionOperator[] {
  return valueType === "range" ? RANGE_OPERATORS : MEMBERSHIP_OPERATORS;
}

export function valueTypeOfField(field: string): ConditionValueType | undefined {
  return SEARCH_FIELDS[field]?.valueType;
}

/** The comparator a freshly-added row for `field` starts on. */
export function defaultOperatorForField(field: string): ConditionOperator {
  return valueTypeOfField(field) === "range" ? "gt" : "is";
}

// ── serialize ──────────────────────────────────────────────────────────────

/** A value needs quoting when it isn't a plain token — spaces and query
 *  metacharacters would otherwise re-parse into a different structure. `*`
 *  (wildcard) and the path chars `._-/:@` are left bare on purpose. */
function needsQuoting(value: string): boolean {
  return value.length === 0 || !/^[\w.*/@:+-]+$/.test(value);
}

function escapeValue(value: string): string {
  return needsQuoting(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;
}

/** True when a row carries everything its comparator needs to serialise. A
 *  half-filled row (field picked, value still blank) is simply skipped so the
 *  query stays valid while the user is mid-edit. */
export function isConditionComplete(c: Condition): boolean {
  if (!c.field) return false;
  if (c.operator === "between")
    return c.value.trim().length > 0 && (c.valueTo ?? "").trim().length > 0;
  return c.value.trim().length > 0;
}

function serializeCondition(c: Condition): string {
  const value = c.value.trim();
  const valueTo = (c.valueTo ?? "").trim();
  switch (c.operator) {
    case "is":
      return `${c.field}:${escapeValue(value)}`;
    case "is_not":
      return `-${c.field}:${escapeValue(value)}`;
    case "gt":
      return `${c.field}:>${value}`;
    case "gte":
      return `${c.field}:>=${value}`;
    case "lt":
      return `${c.field}:<${value}`;
    case "lte":
      return `${c.field}:<=${value}`;
    case "between":
      return `${c.field}:[${value} TO ${valueTo}]`;
  }
}

export function serializeConditions(conditions: Condition[]): string {
  return conditions.filter(isConditionComplete).map(serializeCondition).join(" AND ");
}

// ── parse ────────────────────────────────────────────────────────────────

interface Conjunct {
  tag: TagToken;
  negated: boolean;
}

/**
 * Flattens a top-level AND chain into tag leaves, or bails (`null`) at
 * anything unrepresentable: an OR, a negated group (needs De Morgan), or
 * free-text. Negation is accepted only wrapping a single tag directly.
 */
function collectConjuncts(node: ParserAst, negated: boolean, out: Conjunct[]): boolean {
  switch (node.type) {
    case "EmptyExpression":
      return true;
    case "Tag":
      // An implicit field is bare free-text (`refund`) — not structurable.
      if (node.field.type !== "Field") return false;
      out.push({ tag: node, negated });
      return true;
    case "UnaryOperator":
      if (node.operator !== "NOT" && node.operator !== "-") return false;
      // Only negate a single tag — never distribute NOT across a group.
      if (node.operand.type !== "Tag") return false;
      return collectConjuncts(node.operand, true, out);
    case "LogicalExpression":
      // BooleanOperator ("AND"/"OR") and ImplicitBooleanOperator ("AND") both
      // carry `.operator`; only a literal AND is a conjunction.
      if (node.operator.operator !== "AND") return false;
      return (
        collectConjuncts(node.left, negated, out) && collectConjuncts(node.right, negated, out)
      );
    case "ParenthesizedExpression":
      return collectConjuncts(node.expression, negated, out);
    default:
      return false;
  }
}

function tagToCondition(
  { tag, negated }: Conjunct,
  normalized: string,
  index: number,
): Condition | null {
  // `collectConjuncts` only admits Field tags, but re-narrow for the type
  // checker (and defence in depth).
  if (tag.field.type !== "Field") return null;
  const field = normalized.slice(tag.field.location.start, tag.field.location.end);
  if (!field) return null;

  const expr = tag.expression;

  // A range literal — `field:[min TO max]`. The builder only speaks inclusive
  // ranges and never negates one, so anything else falls back to Code mode.
  if (expr.type === "RangeExpression") {
    if (negated) return null;
    if (!expr.range.minInclusive || !expr.range.maxInclusive) return null;
    return {
      id: `c${index}`,
      field,
      operator: "between",
      value: String(expr.range.min),
      valueTo: String(expr.range.max),
    };
  }

  if (expr.type !== "LiteralExpression") return null; // regex / empty

  const value = typeof expr.value === "string" ? expr.value : String(expr.value);

  const comparison = tag.operator.operator;
  if (comparison === ":>" || comparison === ":>=" || comparison === ":<" || comparison === ":<=") {
    // A comparator is a range concept; negating it (`-cost:>1`) has no builder
    // representation.
    if (negated) return null;
    const COMPARATOR_OPERATOR: Record<":>" | ":>=" | ":<" | ":<=", ConditionOperator> = {
      ":>": "gt",
      ":>=": "gte",
      ":<": "lt",
      ":<=": "lte",
    };
    const operator: ConditionOperator = COMPARATOR_OPERATOR[comparison];
    return { id: `c${index}`, field, operator, value };
  }

  // Plain equality (`:` or `:=`).
  return {
    id: `c${index}`,
    field,
    operator: negated ? "is_not" : "is",
    value,
  };
}

/**
 * Parse a query string into builder rows, or `null` when it's too rich for the
 * builder (the caller then shows Code mode). An empty query is an empty row
 * list, not `null` — a blank builder is a perfectly good starting point.
 */
export function queryToConditions(query: string): Condition[] | null {
  const normalized = stripAtSigils(query).trim();
  if (normalized.length === 0) return [];

  let ast: LiqeQuery;
  try {
    ast = parse(query);
  } catch {
    return null;
  }

  const conjuncts: Conjunct[] = [];
  if (!collectConjuncts(ast, false, conjuncts)) return null;

  const conditions: Condition[] = [];
  for (let i = 0; i < conjuncts.length; i++) {
    const condition = tagToCondition(conjuncts[i]!, normalized, i);
    if (!condition) return null;
    conditions.push(condition);
  }
  return conditions;
}

/** Whether a query can be shown in the structured builder without loss. */
export function queryIsStructurable(query: string): boolean {
  return queryToConditions(query) !== null;
}

/** What the Code tab says about a query: a blocking `error` when it cannot
 *  run, and `warnings` for clauses that parse but look like typos. */
export interface QueryCheck {
  error: string | null;
  warnings: string[];
}

/** Legacy aliases the translator still accepts beside `DYNAMIC_PREFIXES`. */
const LEGACY_FIELD_PREFIXES = ["attribute.", "event.", "eval."];

/** Fields the translator reads that `SEARCH_FIELDS` does not list, kept here so the
 *  browser does not bundle the SQL registry. */
const TRANSLATOR_ONLY_FIELDS = new Set(["trace", "evaluatorPassed"]);

function isKnownField(field: string): boolean {
  const isListed = Object.hasOwn(SEARCH_FIELDS, field);
  const isScenario = SCENARIO_FIELDS.has(field);
  const isTranslatorOnly = TRANSLATOR_ONLY_FIELDS.has(field);
  if (isListed || isScenario || isTranslatorOnly) return true;
  return [...DYNAMIC_PREFIXES.map((d) => d.prefix), ...LEGACY_FIELD_PREFIXES].some(
    (prefix) => field.startsWith(prefix) && field.length > prefix.length,
  );
}

/** Fields whose `FIELD_VALUES` list is the whole domain, not a suggestion. */
const CLOSED_VALUE_FIELDS = new Set([
  "status",
  "spanStatus",
  "has",
  "none",
  "scenarioVerdict",
  "scenarioStatus",
  "evaluatorStatus",
  "evaluatorVerdict",
]);

/** The closed domain of a field's values; empty when the field is open. */
function closedValuesOf(field: string): string[] {
  if (!CLOSED_VALUE_FIELDS.has(field)) return [];
  return FIELD_VALUES[field] ?? [];
}

/** Check a query the way the search bar does: the parser and semantic guard
 *  decide `error`; an unknown field or a value outside a closed set
 *  (`status:error#simplified`) is a warning: it can never match. */
export function checkQuery(query: string): QueryCheck {
  if (stripAtSigils(query).trim().length === 0) {
    return { error: null, warnings: [] };
  }
  let ast: LiqeQuery;
  try {
    ast = parse(query);
  } catch (e) {
    return {
      error:
        e instanceof ParseError
          ? e.message
          : "Invalid query syntax: check for unmatched quotes or parentheses.",
      warnings: [],
    };
  }
  const semanticError = describeAstProblem(ast);
  if (semanticError) return { error: semanticError, warnings: [] };

  const warnings: string[] = [];
  walkAST(ast, (node) => {
    if (node.type !== "Tag" || node.field.type !== "Field") return;
    const field = node.field.name;
    if (!isKnownField(field)) {
      warnings.push(`Unknown field \`${field}\`: it will never match.`);
      return;
    }
    if (node.expression.type !== "LiteralExpression") return;
    const value = String(node.expression.value);
    const known = closedValuesOf(field);
    const isWildcard = value.includes("*");
    const isKnownValue = known.includes(value.toLowerCase());
    if (known.length > 0 && !isWildcard && !isKnownValue) {
      warnings.push(`\`${field}\` is never \`${value}\`: expected one of ${known.join(", ")}.`);
    }
  });
  return { error: null, warnings };
}

/** True when a query is set, parses, and carries nothing suspicious. */
export function queryIsValid(query: string | null): boolean {
  const q = query ?? "";
  if (stripAtSigils(q).trim().length === 0) return false;
  const check = checkQuery(q);
  return check.error === null && check.warnings.length === 0;
}
