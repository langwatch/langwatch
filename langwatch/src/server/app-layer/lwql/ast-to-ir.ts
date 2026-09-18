/**
 * LWQL AST-to-IR walker — the front-end's default-deny gate.
 *
 * ADR-081 decision 9 adopts a general-purpose SQL parser for the text surface,
 * with one discipline that must not slip: **the walker is default-deny on node
 * kinds**. Every switch here enumerates the node types, operators and function
 * names LWQL accepts and throws on everything else. There is no branch that
 * passes an unrecognised node through, so the parser's breadth — it happily
 * parses joins, subqueries, window functions and `INTO OUTFILE` — never widens
 * the language.
 *
 * The second rule is the same one the compiler keeps (issue #6346 decision 2):
 * an identifier is *looked up* in the closed catalogue, never carried. Field,
 * entity and function names reach the IR only by matching a catalogue key;
 * aliases, the one free-text position, are shape-checked against the IR's own
 * identifier grammar. No caller-supplied string survives into an identifier.
 *
 * Errors are deliberately shaped like the ones the hand-rolled parser produced:
 * `parse_error` for a malformed query, and the shared `unknown*Error`
 * constructors for a name outside the allowlist, so both entrances to the
 * language report a bad name identically.
 */

import ms from "ms";

import {
  AGGREGATION_NAMES,
  ENTITY_NAMES,
  fieldNames,
  getEntity,
  getField,
  type LwqlEntityDef,
} from "./catalog";
import {
  LwqlError,
  unknownEntityError,
  unknownFieldError,
  unknownFunctionError,
} from "./errors";
import {
  type LwqlComparison,
  type LwqlComparisonOperator,
  type LwqlLiteral,
  type LwqlOrderBy,
  type LwqlPredicate,
  type LwqlQuery,
  type LwqlSelectItem,
  MAX_PREDICATE_DEPTH,
} from "./ir";

/** An AST node, before this file has decided whether it is one LWQL accepts. */
type SqlNode = Record<string, unknown>;

const GRAMMAR_HINT =
  "Queries read SELECT … FROM … [WHERE …] [GROUP BY …] [ORDER BY …] [LIMIT n] [OFFSET n].";

const COMPARISON_HINT = "Use =, !=, >, >=, <, <=, IN, LIKE or IS NULL.";

const DURATION_HINT =
  "Write now() - INTERVAL 24 HOUR, or the shorthand now() - INTERVAL '24h'.";

/** Units `ms` understands, named the way an author would write them. */
const DURATION_UNITS =
  "millisecond, second, minute, hour, day, week, year (months are not supported)";

/** Identifier grammar the IR enforces; aliases are checked against it here. */
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

/** Caps how much caller text an error may echo back. */
const MAX_ECHO_LENGTH = 40;

const isRecord = (value: unknown): value is SqlNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A node's declared kind, or `""` for anything without one. */
const kindOf = (node: SqlNode): string =>
  typeof node.type === "string" ? node.type : "";

/** Truncates caller text before it is quoted back in an error message. */
const echo = (value: string): string =>
  value.length > MAX_ECHO_LENGTH
    ? `${value.slice(0, MAX_ECHO_LENGTH)}…`
    : value;

const refuse = (message: string, hint: string): LwqlError =>
  new LwqlError("parse_error", message, { hint });

/** Narrows to a node, refusing the primitives and arrays that are not one. */
const asNode = (value: unknown, what: string): SqlNode => {
  if (!isRecord(value)) {
    throw refuse(`Unsupported ${what}.`, GRAMMAR_HINT);
  }
  return value;
};

/**
 * `ms` is typed for string literals, but durations here are assembled at
 * runtime and may be nonsense. This is the one place that widens the input,
 * and it narrows the result to what the library really returns for a duration
 * it cannot read — including the throw it raises for an over-long string.
 */
const durationToMs = (text: string): number | undefined => {
  try {
    return (ms as (value: string) => number | undefined)(text);
  } catch {
    return undefined;
  }
};

/** Everything a walk needs to resolve a name against the catalogue. */
interface WalkContext {
  readonly entity: LwqlEntityDef;
  readonly entityName: string;
  readonly now: number;
}

// ---------------------------------------------------------------------------
// identifiers — the only path from caller text to a name in the IR
// ---------------------------------------------------------------------------

/** Resolves a field against the entity's catalogue, or refuses it by name. */
const catalogueField = (name: string, ctx: WalkContext): string => {
  const normalised = name.toLowerCase();
  if (!getField(ctx.entity, normalised)) {
    throw unknownFieldError(
      echo(normalised),
      ctx.entityName,
      fieldNames(ctx.entity),
    );
  }
  return normalised;
};

/**
 * Reads a plain, unqualified column name.
 *
 * Quoted and table-qualified forms are refused rather than unwrapped: a quoted
 * name is how a caller smuggles a shape the catalogue lookup was not written
 * for, and `traces.trace_id` implies a join the language does not have.
 */
const columnName = (node: SqlNode): string => {
  if (node.table != null) {
    throw refuse(
      "Table-qualified column names are not supported.",
      "Write the field name on its own, e.g. trace_id.",
    );
  }
  if (node.collate != null) {
    throw refuse("COLLATE is not supported.", GRAMMAR_HINT);
  }

  const column = node.column;
  if (column === "*") return "*";

  const expr = isRecord(column) ? column.expr : undefined;
  if (!isRecord(expr) || expr.type !== "default") {
    throw refuse(
      "Quoted column names are not supported.",
      "Write the field name unquoted, e.g. trace_id.",
    );
  }
  if (typeof expr.value !== "string") {
    throw refuse("Expected a field name.", GRAMMAR_HINT);
  }
  return expr.value;
};

/** Reads a column reference and resolves it against the catalogue. */
const columnField = (node: SqlNode, ctx: WalkContext): string =>
  catalogueField(columnName(node), ctx);

/** Reads a single-part function name, e.g. the `p95` of `p95(duration_ms)`. */
const functionName = (node: SqlNode): string => {
  const parts = isRecord(node.name) ? node.name.name : undefined;
  const part = Array.isArray(parts) && parts.length === 1 ? parts[0] : undefined;
  if (!isRecord(part) || typeof part.value !== "string") {
    throw refuse("Unsupported function call.", GRAMMAR_HINT);
  }
  return part.value;
};

/**
 * Resolves an aggregate against the closed function list.
 *
 * The author's own spelling is carried as `fnRaw` so an error echoes what they
 * typed; `fn` — the normalised form — is the only thing ever looked up.
 */
const aggregate = (raw: string): { fn: string; fnRaw: string } => {
  const fn = raw.toLowerCase();
  if (!(AGGREGATION_NAMES as readonly string[]).includes(fn)) {
    throw unknownFunctionError(echo(raw), AGGREGATION_NAMES);
  }
  return { fn, fnRaw: raw };
};

/** Validates the one free-text position in the language. */
const aliasName = (value: unknown): string => {
  const alias = typeof value === "string" ? value.toLowerCase() : "";
  if (!IDENTIFIER.test(alias)) {
    throw refuse(
      `'${echo(String(value))}' is not a valid alias.`,
      "Aliases are lowercase letters, digits and underscores, e.g. AS total_cost.",
    );
  }
  return alias;
};

// ---------------------------------------------------------------------------
// literals
// ---------------------------------------------------------------------------

/** Explains the refusal for the shapes callers most often reach for. */
const refuseLiteral = (node: SqlNode): never => {
  if (node.ast !== undefined) {
    throw refuse(
      "Subqueries are not supported.",
      "Write the values out, e.g. model IN ('gpt-4o', 'claude-opus-5').",
    );
  }

  const kind = kindOf(node);
  if (kind === "column_ref") {
    throw refuse(
      "Expected a value but found a column name.",
      "Quote text values with single quotes, e.g. model = 'gpt-4o'.",
    );
  }
  if (kind === "param" || kind === "var") {
    throw refuse(
      "Query placeholders are not supported.",
      "Write the value into the query, e.g. model = 'gpt-4o'.",
    );
  }
  throw refuse(
    "Expected a value.",
    "Values are quoted strings, numbers, true/false, null, or now() arithmetic.",
  );
};

/** Unescapes SQL's doubled quote, so `'o''brien'` binds as `o'brien`. */
const stringLiteral = (node: SqlNode): string => {
  if (typeof node.value !== "string") return refuseLiteral(node);
  return node.value.replaceAll("''", "'");
};

const numberLiteral = (node: SqlNode): number => {
  const raw = node.value;
  const parsed =
    typeof raw === "number" || typeof raw === "string"
      ? Number(raw)
      : Number.NaN;

  if (!Number.isFinite(parsed)) {
    throw refuse(
      `'${echo(String(raw))}' is not a valid number.`,
      "Write a bare number, e.g. 100, 1e5 or .5.",
    );
  }
  return parsed;
};

/** `now()`, and only `now()`. */
const nowLiteral = (node: SqlNode, ctx: WalkContext): number => {
  const args = isRecord(node.args) ? node.args.value : undefined;
  const isNow =
    kindOf(node) === "function" &&
    functionName(node).toLowerCase() === "now" &&
    Array.isArray(args) &&
    args.length === 0;

  if (!isNow) {
    throw refuse("Only now() may be used as a value.", DURATION_HINT);
  }
  return ctx.now;
};

/** Converts an `INTERVAL n unit` node to milliseconds via the `ms` package. */
const intervalMs = (node: SqlNode): number => {
  if (kindOf(node) !== "interval") {
    throw refuse("Expected an INTERVAL after now().", DURATION_HINT);
  }

  const amount = asNode(node.expr, "duration");
  const value =
    kindOf(amount) === "single_quote_string"
      ? stringLiteral(amount)
      : String(numberLiteral(amount));
  const unit = typeof node.unit === "string" ? node.unit : "";
  const text = unit ? `${value} ${unit}` : value;

  // A bare `INTERVAL 24` names no unit, and `ms` would read it as 24ms.
  const parsed = /[a-z]/i.test(text) ? durationToMs(text) : undefined;
  if (parsed === undefined || !Number.isFinite(parsed)) {
    throw refuse(
      `'${echo(text)}' is not a valid duration.`,
      `Supported units: ${DURATION_UNITS}.`,
    );
  }
  return parsed;
};

/**
 * `now() - INTERVAL 24 HOUR` and its `+` twin, resolved to epoch milliseconds
 * at parse time so the IR carries an absolute instant. Two callers running the
 * same saved text a day apart each get a window anchored to their own "now",
 * and a stored IR always means what it said.
 */
const nowArithmetic = (node: SqlNode, ctx: WalkContext): number => {
  const sign = node.operator === "-" ? -1 : node.operator === "+" ? 1 : 0;
  if (sign === 0) {
    throw refuse(
      `Arithmetic with '${echo(String(node.operator))}' is not supported in a value.`,
      DURATION_HINT,
    );
  }

  const base = nowLiteral(asNode(node.left, "value"), ctx);
  return base + sign * intervalMs(asNode(node.right, "duration"));
};

const walkLiteral = (value: unknown, ctx: WalkContext): LwqlLiteral => {
  const node = asNode(value, "value");

  switch (kindOf(node)) {
    case "single_quote_string":
      return stringLiteral(node);
    case "number":
    case "bigint":
      return numberLiteral(node);
    case "bool":
      return typeof node.value === "boolean"
        ? node.value
        : refuseLiteral(node);
    case "null":
      return null;
    case "function":
      return nowLiteral(node, ctx);
    case "binary_expr":
      return nowArithmetic(node, ctx);
    default:
      return refuseLiteral(node);
  }
};

// ---------------------------------------------------------------------------
// WHERE
// ---------------------------------------------------------------------------

/** Operators accepted verbatim, mapped to their IR spelling. */
const BINARY_OPERATORS: Record<string, LwqlComparisonOperator> = {
  "=": "=",
  "!=": "!=",
  "<>": "!=",
  ">": ">",
  ">=": ">=",
  "<": "<",
  "<=": "<=",
};

/** The field side of a comparison: always a plain, catalogued column. */
const comparisonField = (value: unknown, ctx: WalkContext): string => {
  const node = asNode(value, "condition");
  if (kindOf(node) !== "column_ref") {
    throw refuse(
      "A condition must start with a field name.",
      "Write conditions as field = value, e.g. has_error = true.",
    );
  }
  return columnField(node, ctx);
};

const nullComparison = (
  node: SqlNode,
  field: string,
  op: LwqlComparisonOperator,
): LwqlComparison => {
  const right = asNode(node.right, "condition");
  if (kindOf(right) !== "null") {
    throw refuse("IS may only be compared to NULL.", COMPARISON_HINT);
  }
  return { field, op };
};

const listComparison = (
  node: SqlNode,
  ctx: WalkContext,
  op: LwqlComparisonOperator,
): LwqlComparison => {
  const right = asNode(node.right, "value list");
  const values = right.value;
  if (kindOf(right) !== "expr_list" || !Array.isArray(values)) {
    throw refuse(
      "IN expects a list of values.",
      "Write model IN ('gpt-4o', 'claude-opus-5').",
    );
  }
  return { field: comparisonField(node.left, ctx), op, value: values.map((item) => walkLiteral(item, ctx)) };
};

/** Comparisons — the leaves of a predicate. Default-deny on the operator. */
const walkComparison = (node: SqlNode, ctx: WalkContext): LwqlComparison => {
  const operator = String(node.operator ?? "").toUpperCase();
  const binary = BINARY_OPERATORS[operator];
  if (binary) {
    return {
      field: comparisonField(node.left, ctx),
      op: binary,
      value: walkLiteral(node.right, ctx),
    };
  }

  switch (operator) {
    case "IS":
      return nullComparison(node, comparisonField(node.left, ctx), "is_null");
    case "IS NOT":
      return nullComparison(
        node,
        comparisonField(node.left, ctx),
        "is_not_null",
      );
    case "IN":
      return listComparison(node, ctx, "in");
    case "NOT IN":
      return listComparison(node, ctx, "not_in");
    case "LIKE":
    case "NOT LIKE":
      return {
        field: comparisonField(node.left, ctx),
        op: operator === "LIKE" ? "like" : "not_like",
        value: walkLiteral(node.right, ctx),
      };
    default:
      throw refuse(
        `Operator '${echo(operator)}' is not supported.`,
        COMPARISON_HINT,
      );
  }
};

/**
 * Collapses a left-nested `AND`/`AND` chain into one n-ary IR node.
 *
 * The parser builds `a AND b AND c` as `AND(AND(a, b), c)`, so without this a
 * long conjunction would nest as deeply as it is long and hit the depth guard
 * that exists to bound *recursion*, not to bound how many things a caller may
 * filter on. Grouping is not lost: an `OR` inside an `AND` is a different
 * operator and stops the flattening.
 */
const flattenLogical = (node: SqlNode, operator: string): unknown[] => {
  const left = node.left;
  const nested =
    isRecord(left) &&
    kindOf(left) === "binary_expr" &&
    String(left.operator ?? "").toUpperCase() === operator;

  return nested
    ? [...flattenLogical(left, operator), node.right]
    : [node.left, node.right];
};

const walkPredicate = (
  value: unknown,
  ctx: WalkContext,
  depth: number,
): LwqlPredicate => {
  if (depth > MAX_PREDICATE_DEPTH) {
    throw refuse(
      "WHERE clause is nested too deeply.",
      `Flatten it to at most ${MAX_PREDICATE_DEPTH} levels.`,
    );
  }

  const node = asNode(value, "condition");
  switch (kindOf(node)) {
    case "binary_expr":
      return walkLogical(node, ctx, depth);
    case "unary_expr":
      return walkNegation(node, ctx, depth);
    case "function":
      return walkFunctionPredicate(node, ctx, depth);
    default:
      throw refuse(
        "Expected a condition.",
        "Write conditions as field = value, joined with AND / OR.",
      );
  }
};

const walkLogical = (
  node: SqlNode,
  ctx: WalkContext,
  depth: number,
): LwqlPredicate => {
  const operator = String(node.operator ?? "").toUpperCase();
  if (operator !== "AND" && operator !== "OR") {
    return walkComparison(node, ctx);
  }

  const terms = flattenLogical(node, operator).map((term) =>
    walkPredicate(term, ctx, depth + 1),
  );
  return operator === "AND" ? { and: terms } : { or: terms };
};

/** `NOT x` — one of the parser's two spellings for negation. */
const walkNegation = (
  node: SqlNode,
  ctx: WalkContext,
  depth: number,
): LwqlPredicate => {
  if (String(node.operator ?? "").toUpperCase() !== "NOT") {
    throw refuse(
      `Operator '${echo(String(node.operator))}' is not supported in WHERE.`,
      COMPARISON_HINT,
    );
  }
  return { not: walkPredicate(node.expr, ctx, depth + 1) };
};

/**
 * The parser spells a parenthesised `NOT (…)` as a function call, so this is
 * the only function the walker accepts in predicate position — `EXISTS`,
 * `sleep` and everything else land in the refusal below.
 */
const walkFunctionPredicate = (
  node: SqlNode,
  ctx: WalkContext,
  depth: number,
): LwqlPredicate => {
  const name = functionName(node).toUpperCase();
  const args = isRecord(node.args) ? node.args.value : undefined;

  if (name !== "NOT" || !Array.isArray(args) || args.length !== 1) {
    throw refuse(
      `'${echo(name)}' is not supported in WHERE.`,
      "Conditions compare a field to a value; only NOT, AND and OR combine them.",
    );
  }
  return { not: walkPredicate(args[0], ctx, depth + 1) };
};

// ---------------------------------------------------------------------------
// SELECT, GROUP BY, ORDER BY, LIMIT
// ---------------------------------------------------------------------------

/** Refuses the argument shapes an aggregate may not carry. */
const assertPlainCall = (node: SqlNode, args: SqlNode): void => {
  if (node.over != null) {
    throw refuse(
      "Window functions are not supported.",
      "Aggregate with GROUP BY instead, e.g. SELECT model, count(*) … GROUP BY model.",
    );
  }
  if (args.distinct != null || args.orderby != null || args.separator != null) {
    throw refuse(
      "DISTINCT and ORDER BY inside an aggregate are not supported.",
      "Aggregate the field on its own, e.g. count(trace_id).",
    );
  }
};

/** The field an aggregate is applied to: a catalogued column, or `*`. */
const aggregateTarget = (value: unknown, ctx: WalkContext): string => {
  const node = asNode(value, "aggregate argument");
  if (kindOf(node) === "star") return "*";
  if (kindOf(node) !== "column_ref") {
    throw refuse(
      "Aggregates take a single field.",
      "Write count(*), or an aggregate over one field, e.g. avg(cost_usd).",
    );
  }
  const field = columnName(node);
  return field === "*" ? "*" : catalogueField(field, ctx);
};

/** `count(*)`, `avg(cost_usd)` — the shapes the parser calls `aggr_func`. */
const walkAggregateCall = (
  node: SqlNode,
  ctx: WalkContext,
): LwqlSelectItem => {
  const args = asNode(node.args, "aggregate argument");
  assertPlainCall(node, args);

  const name = typeof node.name === "string" ? node.name : "";
  return { ...aggregate(name), field: aggregateTarget(args.expr, ctx) };
};

/** Any other call, e.g. `p95(duration_ms)` — allowlisted by name all the same. */
const walkFunctionCall = (node: SqlNode, ctx: WalkContext): LwqlSelectItem => {
  const args = asNode(node.args, "function argument");
  assertPlainCall(node, args);

  const values = args.value;
  if (!Array.isArray(values) || values.length !== 1) {
    throw refuse(
      `'${echo(functionName(node))}' takes exactly one field.`,
      "Write an aggregate over one field, e.g. p95(duration_ms).",
    );
  }
  return {
    ...aggregate(functionName(node)),
    field: aggregateTarget(values[0], ctx),
  };
};

/** A projected column: a catalogued field, or an allowlisted aggregate. */
const walkProjection = (value: unknown, ctx: WalkContext): LwqlSelectItem => {
  const node = asNode(value, "column");

  switch (kindOf(node)) {
    case "column_ref": {
      const field = columnName(node);
      if (field === "*") {
        throw refuse(
          "SELECT * is not supported.",
          "List the columns you want, e.g. SELECT trace_id, duration_ms.",
        );
      }
      return { field: catalogueField(field, ctx) };
    }
    case "aggr_func":
      return walkAggregateCall(node, ctx);
    case "function":
      return walkFunctionCall(node, ctx);
    default:
      throw refuse(
        "Only fields and aggregates may be selected.",
        "Write SELECT trace_id, or an aggregate such as count(*).",
      );
  }
};

const walkColumns = (value: unknown, ctx: WalkContext): LwqlSelectItem[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw refuse("SELECT requires at least one column.", GRAMMAR_HINT);
  }

  return value.map((entry) => {
    const item = asNode(entry, "column");
    const projected = walkProjection(item.expr, ctx);
    return item.as == null ? projected : { ...projected, as: aliasName(item.as) };
  });
};

const walkGroupBy = (value: unknown, ctx: WalkContext): string[] | undefined => {
  if (value == null) return undefined;

  const group = asNode(value, "GROUP BY clause");
  const modifiers = group.modifiers;
  if (Array.isArray(modifiers) && modifiers.length > 0) {
    throw refuse("GROUP BY modifiers are not supported.", GRAMMAR_HINT);
  }

  const columns = group.columns;
  if (!Array.isArray(columns)) {
    throw refuse("GROUP BY expects a list of fields.", GRAMMAR_HINT);
  }

  return columns.map((entry) => {
    const node = asNode(entry, "GROUP BY field");
    if (kindOf(node) !== "column_ref") {
      throw refuse(
        "GROUP BY takes field names.",
        "Group by a field, e.g. GROUP BY model.",
      );
    }
    return columnField(node, ctx);
  });
};

/**
 * An ORDER BY term.
 *
 * Ordering by an output alias is the common case (`count(*) AS n … ORDER BY n`),
 * so an alias is accepted here and resolved by the compiler; anything else must
 * be a catalogued field.
 */
const walkOrderTerm = (
  entry: unknown,
  ctx: WalkContext,
  aliases: ReadonlySet<string>,
): LwqlOrderBy => {
  const item = asNode(entry, "ORDER BY term");
  if (item.nulls != null) {
    throw refuse("NULLS FIRST / NULLS LAST is not supported.", GRAMMAR_HINT);
  }

  const direction = String(item.type ?? "ASC").toUpperCase();
  if (direction !== "ASC" && direction !== "DESC") {
    throw refuse(
      `Sort direction '${echo(direction)}' is not supported.`,
      "Order ascending with ASC or descending with DESC.",
    );
  }

  return {
    ...walkOrderTarget(item.expr, ctx, aliases),
    direction: direction === "DESC" ? "desc" : "asc",
  };
};

const walkOrderTarget = (
  value: unknown,
  ctx: WalkContext,
  aliases: ReadonlySet<string>,
): { field: string; fn?: string } => {
  const node = asNode(value, "ORDER BY term");

  if (kindOf(node) === "column_ref") {
    const name = columnName(node).toLowerCase();
    if (aliases.has(name)) return { field: name };
    if (getField(ctx.entity, name)) return { field: name };
    throw unknownFieldError(echo(name), ctx.entityName, [
      ...fieldNames(ctx.entity),
      ...aliases,
    ]);
  }

  const item = walkProjection(node, ctx);
  return { field: item.field, ...(item.fn ? { fn: item.fn } : {}) };
};

const walkOrderBy = (
  value: unknown,
  ctx: WalkContext,
  select: LwqlSelectItem[],
): LwqlOrderBy[] | undefined => {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw refuse("ORDER BY expects a list of fields.", GRAMMAR_HINT);
  }

  const aliases = outputAliases(select);
  return value.map((entry) => walkOrderTerm(entry, ctx, aliases));
};

/** Aliases the compiler will expose, so ORDER BY can name them. */
const outputAliases = (select: LwqlSelectItem[]): ReadonlySet<string> =>
  new Set(
    select.map(
      (item) =>
        item.as ??
        (item.fn
          ? `${item.fn}_${item.field === "*" ? "all" : item.field}`
          : item.field),
    ),
  );

const wholeNumber = (value: unknown, clause: string): number => {
  const node = asNode(value, `${clause} value`);
  const parsed = numberLiteral(node);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw refuse(
      `${clause} expects a whole number, found '${echo(String(node.value))}'.`,
      `Write ${clause} 100.`,
    );
  }
  return parsed;
};

/**
 * Reads `LIMIT n`, `OFFSET n` and `LIMIT n OFFSET m`.
 *
 * The parser reports both in one node, distinguished by a separator: `offset`
 * for the two-keyword forms and an empty string for a bare LIMIT. MySQL's
 * comma form (`LIMIT 5, 10`) arrives with a `,` separator and is refused —
 * reading it backwards would silently return the wrong page.
 */
const walkLimit = (value: unknown): { limit?: number; offset?: number } => {
  if (value == null) return {};

  const node = asNode(value, "LIMIT clause");
  const values = node.value;
  if (!Array.isArray(values) || values.length === 0) return {};

  const separator = typeof node.seperator === "string" ? node.seperator : "";
  if (separator === "" && values.length === 1) {
    return { limit: wholeNumber(values[0], "LIMIT") };
  }
  if (separator === "offset" && values.length === 1) {
    return { offset: wholeNumber(values[0], "OFFSET") };
  }
  if (separator === "offset" && values.length === 2) {
    return {
      limit: wholeNumber(values[0], "LIMIT"),
      offset: wholeNumber(values[1], "OFFSET"),
    };
  }

  throw refuse(
    "Unsupported LIMIT clause.",
    "Write LIMIT 100, or LIMIT 100 OFFSET 200.",
  );
};

// ---------------------------------------------------------------------------
// statement
// ---------------------------------------------------------------------------

/** Clause keys of a `select` node this front-end understands. */
const SUPPORTED_CLAUSES: ReadonlySet<string> = new Set([
  "type",
  "columns",
  "from",
  "where",
  "groupby",
  "orderby",
  "limit",
]);

/** How the parser spells "the query did not use this clause". */
const EMPTY_CLAUSE: Record<string, (value: SqlNode) => boolean> = {
  distinct: (value) => value.type == null,
  into: (value) => value.keyword == null,
};

const CLAUSE_REFUSALS: Record<string, { message: string; hint: string }> = {
  with: {
    message: "Common table expressions (WITH) are not supported.",
    hint: "Write a single SELECT over one entity.",
  },
  distinct: {
    message: "SELECT DISTINCT is not supported.",
    hint: "Use GROUP BY to collapse duplicate rows.",
  },
  having: {
    message: "HAVING is not supported.",
    hint: "Filter rows with WHERE before aggregating.",
  },
  window: {
    message: "Window functions are not supported.",
    hint: "Aggregate with GROUP BY instead.",
  },
  into: {
    message: "INTO is not supported.",
    hint: "LWQL returns rows to the caller; it cannot write anywhere.",
  },
  set_op: {
    message: "UNION, INTERSECT and EXCEPT are not supported.",
    hint: "Run one query per entity.",
  },
  _next: {
    message: "UNION, INTERSECT and EXCEPT are not supported.",
    hint: "Run one query per entity.",
  },
};

/**
 * Refuses every clause key that is not on the accepted list.
 *
 * Enumerating what is *supported* rather than what is banned is the point: a
 * `node-sql-parser` upgrade that adds a clause cannot quietly become part of
 * LWQL, it fails here until someone decides to support it.
 */
const assertOnlySupportedClauses = (stmt: SqlNode): void => {
  for (const [key, value] of Object.entries(stmt)) {
    if (SUPPORTED_CLAUSES.has(key) || value == null) continue;

    const isEmpty = EMPTY_CLAUSE[key];
    if (isEmpty && isRecord(value) && isEmpty(value)) continue;

    const known = CLAUSE_REFUSALS[key];
    throw known
      ? refuse(known.message, known.hint)
      : refuse(`'${echo(key)}' is not supported in LWQL.`, GRAMMAR_HINT);
  }
};

/** The single statement a query may contain. */
const singleStatement = (ast: unknown): SqlNode => {
  if (Array.isArray(ast)) {
    if (ast.length !== 1) {
      throw refuse(
        "Only one statement per query is allowed.",
        "Remove everything after the first ';'.",
      );
    }
    return asNode(ast[0], "statement");
  }
  return asNode(ast, "statement");
};

const assertSelect = (stmt: SqlNode): void => {
  const type = kindOf(stmt);
  if (type !== "select") {
    throw refuse(
      `Only SELECT queries are allowed; found '${echo(type || "an unknown statement")}'.`,
      "LWQL is read-only — start the query with SELECT.",
    );
  }
};

/**
 * Resolves the queried entity.
 *
 * Joins, subqueries, schema qualification and table aliases are each refused by
 * name rather than by a single "unsupported FROM": the caller needs to know
 * which one of them they hit.
 */
const walkFrom = (value: unknown, now: number): WalkContext => {
  if (!Array.isArray(value) || value.length === 0) {
    throw refuse("Every query needs a FROM clause.", GRAMMAR_HINT);
  }
  if (value.length > 1) {
    throw refuse(
      "Joins are not supported.",
      "Query one entity at a time, e.g. FROM traces.",
    );
  }

  const source = asNode(value[0], "FROM clause");
  assertPlainTable(source);

  const entityName =
    typeof source.table === "string" ? source.table.toLowerCase() : "";
  const entity = getEntity(entityName);
  if (!entity) {
    throw unknownEntityError(echo(entityName), ENTITY_NAMES);
  }
  return { entity, entityName, now };
};

const assertPlainTable = (source: SqlNode): void => {
  if (source.join != null || source.on != null || source.using != null) {
    throw refuse(
      "Joins are not supported.",
      "Query one entity at a time, e.g. FROM traces.",
    );
  }
  if (source.expr != null || source.ast != null) {
    throw refuse(
      "Subqueries are not supported.",
      "Query one entity at a time, e.g. FROM traces.",
    );
  }
  if (source.db != null || source.schema != null) {
    throw refuse(
      "Schema-qualified names are not supported.",
      "Write the entity name on its own, e.g. FROM traces.",
    );
  }
  if (source.as != null) {
    throw refuse(
      "Table aliases are not supported.",
      "Write FROM traces and refer to fields by name.",
    );
  }
};

/**
 * Walks a `node-sql-parser` AST into LWQL's IR.
 *
 * Every path out of here has passed a default-deny switch, and every name in
 * the result came from the catalogue.
 */
export const astToIr = (ast: unknown, now: number): LwqlQuery => {
  const stmt = singleStatement(ast);
  assertSelect(stmt);
  assertOnlySupportedClauses(stmt);

  const ctx = walkFrom(stmt.from, now);
  const select = walkColumns(stmt.columns, ctx);
  const where =
    stmt.where == null ? undefined : walkPredicate(stmt.where, ctx, 0);
  const groupBy = walkGroupBy(stmt.groupby, ctx);
  const orderBy = walkOrderBy(stmt.orderby, ctx, select);
  const { limit, offset } = walkLimit(stmt.limit);

  return {
    from: ctx.entityName,
    select,
    ...(where ? { where } : {}),
    ...(groupBy ? { group_by: groupBy } : {}),
    ...(orderBy ? { order_by: orderBy } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  };
};
