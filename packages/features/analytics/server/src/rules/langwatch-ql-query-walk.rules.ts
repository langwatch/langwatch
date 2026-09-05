/**
 * LangWatchQL analytics SQL — the default-deny walk, and the rule table it reads.
 *
 * ## The rule that makes it a gate rather than a filter
 *
 * The walk is an **allowlist over node kinds, and over each kind's fields**.
 * A node type {@link NODE_RULES} does not name is refused; so is a *field* the
 * rule for that node type does not name. Both matter. A kind-only allowlist
 * would let unrecognised syntax ride into an existing node — `INTO OUTFILE` is
 * a plain string literal hanging off a field of an otherwise ordinary SELECT —
 * and the walk would never look at it. So every field is either walked,
 * explicitly accepted as an inert scalar, restricted to an enumerated set of
 * values, or refused outright.
 *
 * The consequence is deliberate: when `@clickhouse/parser` learns syntax that
 * ClickHouse already supports, that syntax arrives here **refused**, and stays
 * refused until someone adds a rule for it. Capability is a review, never a
 * silent widening. The version is pinned exactly for the same reason
 * (`./langwatch-ql-parser.rules.ts`).
 *
 * ## What is allowed
 *
 * A single `SELECT`, optionally with `WITH`; aggregates and window functions;
 * CTEs, subqueries and `UNION` within the depth ceilings; joins; array, map and
 * JSON access; and bound parameters. Everything else — every write and every
 * DDL form, `SETTINGS` in any position, role changes, reserved schemas, output
 * redirection, and every table function — is refused.
 *
 * ## Functions are allowlisted by name, in a third list
 *
 * Kinds and fields are not enough on their own. Every function call *and every
 * operator* arrives as one `Function` node, so a walk that stops at the kind
 * admits `getSetting()`, `currentUser()`, `hostName()` and `version()` — none
 * of which reaches another tenant, and all of which publish more of the server
 * than this API means to. `./langwatch-ql-functions.rules.ts` is the name
 * allowlist and carries the rule that governs it: a function is listed because
 * a LangWatchQL question needs it, never because it looks harmless. It is
 * applied in two places, because a name reaches the walk in two shapes — a
 * `Function` node, and the bare `func_name` string of an `APPLY` transformer.
 *
 * ## Table functions
 *
 * Refused **positionally**: a `TableExpression` carrying a `table_function` is
 * a violation whatever the function is named. That is stronger than any
 * name-list pre-check, so this file deliberately keeps no list of its own — a
 * second list is a second thing to keep in sync, and this one would always be a
 * subset of "all of them".
 *
 * Be accurate about why, because the database layer's measured behaviour is not
 * uniform. `url`, `s3`, `remote`, `file` and `postgresql` are already refused
 * for the restricted identity by grants (error 497), and `merge()` is *not* a
 * bypass — it respects row policies. `numbers`, `values`, `view` and
 * `generateRandom` reach no stored data at all and the database permits them.
 * So this rule is not standing between a caller and a leak: it is here to keep
 * the reachable surface uniform and small, so that "which table functions are
 * safe today" never becomes a question anyone has to re-answer.
 *
 * @see specs/analytics/lwql-api.feature
 * @see dev/docs/adr/081-lwql-table-function-and-ssrf-policy.md
 */
import {
  isAllowedLangWatchQLFunction,
  isLangWatchQLAggregateFunction,
} from "./langwatch-ql-functions.rules";
import type { SqlAstNode, SqlSourcePosition } from "./langwatch-ql-parser.rules";
import { qualifyTableName } from "./langwatch-ql-policy.rules";
import {
  type BlockAccumulator,
  type FieldArgs,
  type FieldRule,
  type Frame,
  MAX_VIOLATIONS,
  METADATA_FIELDS,
  type NodeArgs,
  type NodeRule,
  UNRESOLVABLE_COLUMN_SETS,
  type WalkContext,
} from "./langwatch-ql-validation-shape.rules";
import {
  echoIdentifier,
  type LangWatchQLClause,
  type LangWatchQLViolationCode,
} from "./langwatch-ql-violations.rules";

/** The frame the outermost statement is walked in. */
export const ROOT_FRAME: Frame = {
  clause: "statement",
  isInSubquery: false,
  subqueryDepth: 0,
  nodeDepth: 0,
  ctes: [],
};

/** Appends a name the accumulator has not seen, preserving first-seen order. */
function addOnce(names: string[], name: string): void {
  if (!names.includes(name)) names.push(name);
}

// ---------------------------------------------------------------------------
// Small readers — every one of them treats a surprising shape as a refusal
// rather than a crash, because the input is a tree built from hostile text.
// ---------------------------------------------------------------------------

function isNode(value: unknown): value is SqlAstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

export function positionOf(node: SqlAstNode): SqlSourcePosition | undefined {
  const start = (node as { location?: { start?: unknown } }).location?.start;
  if (typeof start !== "object" || start === null) return undefined;
  const { line, column } = start as { line?: unknown; column?: unknown };
  if (typeof line !== "number" || typeof column !== "number") return undefined;
  return { line, column };
}

function report({
  ctx,
  frame,
  code,
  message,
  node,
}: {
  ctx: WalkContext;
  frame: Frame;
  code: LangWatchQLViolationCode;
  message: string;
  node?: SqlAstNode;
}): void {
  if (ctx.violations.length >= MAX_VIOLATIONS) return;
  const at = node ? positionOf(node) : undefined;
  ctx.violations.push({
    code,
    clause: frame.isInSubquery ? "subquery" : frame.clause,
    message,
    ...(at ? { at } : {}),
  });
}

const UNSUPPORTED_SYNTAX_MESSAGE =
  "This query uses SQL this API does not support. Rewrite it as a plain read query over the analytics datasets.";

/**
 * The default-deny fallthrough.
 *
 * Names neither the node kind nor the field: those are the parser's vocabulary,
 * not the customer's, and a message that recites them tells an attacker which
 * internal representation the gate is built on while telling a customer
 * nothing. The source position is what makes it actionable.
 */
function refuseUnrecognised({ ctx, frame, node }: NodeArgs): void {
  report({
    ctx,
    frame,
    code: "UNSUPPORTED_SYNTAX",
    message: UNSUPPORTED_SYNTAX_MESSAGE,
    node,
  });
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

const TOO_DEEP_MESSAGE = "This query nests too deeply. Flatten it and try again.";

/** The rule for a node kind, or `undefined` — which is the refusal. */
function ruleFor(type: string): NodeRule | undefined {
  return Object.hasOwn(NODE_RULES, type) ? NODE_RULES[type] : undefined;
}

export function walkNode(node: SqlAstNode, frame: Frame, ctx: WalkContext): void {
  if (ctx.violations.length >= MAX_VIOLATIONS) return;

  const here: Frame = { ...frame, nodeDepth: frame.nodeDepth + 1 };
  if (here.nodeDepth > ctx.policy.limits.maxNodeDepth) {
    report({
      ctx,
      frame,
      code: "NESTING_TOO_DEEP",
      message: TOO_DEEP_MESSAGE,
      node,
    });
    return;
  }

  const rule = ruleFor(node.type);
  if (!rule) {
    refuseUnrecognised({ node, frame: here, ctx });
    return;
  }

  const childFrame = rule.enter ? rule.enter({ node, frame: here, ctx }) : here;
  if (childFrame) walkFields({ rule, node, frame: childFrame, ctx });
}

/** Every field the node carries, each against the rule that names it — or none. */
function walkFields({ rule, node, frame, ctx }: NodeArgs & { rule: NodeRule }): void {
  for (const [field, value] of Object.entries(node)) {
    if (METADATA_FIELDS.includes(field) || value === undefined) continue;
    const fieldRule = Object.hasOwn(rule.fields, field) ? rule.fields[field] : undefined;
    if (fieldRule) applyFieldRule({ rule: fieldRule, value, node, frame, ctx });
    else refuseUnrecognised({ node, frame, ctx });
  }
}

function applyFieldRule({ rule, value, node, frame, ctx }: FieldArgs & { rule: FieldRule }): void {
  switch (rule.kind) {
    case "scalar":
      return;
    case "enum":
      return checkEnumValue({ values: rule.values, value, node, frame, ctx });
    case "refuse":
      return report({
        ctx,
        frame,
        code: rule.code,
        message: rule.message,
        node,
      });
    case "identifierRef":
      return checkIdentifierRef({ value, node, frame, ctx });
    case "node":
      return walkChildNode({ clause: rule.clause, value, node, frame, ctx });
    case "nodes":
      return walkChildNodes({ clause: rule.clause, value, node, frame, ctx });
    case "custom":
      return rule.walk({ value, node, frame, ctx });
  }
}

function checkEnumValue({
  values,
  value,
  node,
  frame,
  ctx,
}: FieldArgs & { values: readonly string[] }): void {
  if (typeof value === "string" && values.includes(value)) return;
  refuseUnrecognised({ node, frame, ctx });
}

/**
 * A table or alias qualifier. Its shape is checked; its name is not a column
 * reference, so the content gate deliberately does not apply to it.
 */
function checkIdentifierRef({ value, node, frame, ctx }: FieldArgs): void {
  if (isNode(value) && value.type === "Identifier" && typeof value.name === "string") {
    return;
  }
  refuseUnrecognised({ node, frame, ctx });
}

function walkChildNode({
  clause,
  value,
  node,
  frame,
  ctx,
}: FieldArgs & { clause?: LangWatchQLClause }): void {
  if (!isNode(value)) {
    refuseUnrecognised({ node, frame, ctx });
    return;
  }
  walkNode(value, clause ? { ...frame, clause } : frame, ctx);
}

function walkChildNodes({
  clause,
  value,
  node,
  frame,
  ctx,
}: FieldArgs & { clause?: LangWatchQLClause }): void {
  if (!Array.isArray(value)) {
    refuseUnrecognised({ node, frame, ctx });
    return;
  }
  const childFrame = clause ? { ...frame, clause } : frame;
  for (const element of value) {
    walkChildNode({ value: element, node, frame: childFrame, ctx });
  }
}

// ---------------------------------------------------------------------------
// Custom field walkers
// ---------------------------------------------------------------------------

/** The columns a caller may not reference, matched on the reference's last segment. */
function gateColumnReference({
  name,
  ctx,
  frame,
  node,
}: {
  name: string;
  ctx: WalkContext;
  frame: Frame;
  node: SqlAstNode;
}): void {
  const leaf = name.split(".").at(-1)?.trim().toLowerCase() ?? "";
  if (!ctx.policy.gatedColumns.has(leaf)) return;
  report({
    ctx,
    frame,
    code: "GATED_COLUMN",
    message: `The field "${echoIdentifier(name)}" is not available to you. Remove it from the query.`,
    node,
  });
}

/**
 * A projection list. Each direct element is checked for an unresolvable column
 * set before it is walked.
 *
 * The check is on the *direct* elements on purpose: `count(*)` puts an
 * `Asterisk` inside a function's arguments, where it names a row count rather
 * than a column set and reveals nothing.
 */
function walkProjection({ value, node, frame, ctx }: FieldArgs): void {
  if (!Array.isArray(value)) {
    refuseUnrecognised({ node, frame, ctx });
    return;
  }
  const projection: Frame = { ...frame, clause: "projection" };
  for (const element of value) {
    if (!isNode(element)) {
      refuseUnrecognised({ node, frame: projection, ctx });
      continue;
    }
    if (ctx.policy.gatedColumns.size > 0 && UNRESOLVABLE_COLUMN_SETS.includes(element.type)) {
      report({
        ctx,
        frame: projection,
        code: "WILDCARD_NOT_ALLOWED",
        message:
          "List the fields you need by name — a wildcard cannot be used here, because some fields are not available to you.",
        node: element,
      });
      continue;
    }
    walkNode(element, projection, ctx);
  }
}

/**
 * `LIMIT n BY cols [OFFSET m]` — an anonymous object rather than a node, so it
 * gets its own field allowlist instead of a rule-table entry.
 */
function walkLimitBy({ value, node, frame, ctx }: FieldArgs): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuseUnrecognised({ node, frame, ctx });
    return;
  }
  const limit: Frame = { ...frame, clause: "limit" };
  for (const [field, inner] of Object.entries(value)) {
    walkLimitByField({ field, value: inner, node, frame: limit, ctx });
  }
}

function walkLimitByField({ field, value, node, frame, ctx }: FieldArgs & { field: string }): void {
  if (value === undefined) return;
  if (field === "length" || field === "offset") {
    walkChildNode({ value, node, frame, ctx });
    return;
  }
  if (field === "by") {
    walkChildNodes({ value, node, frame, ctx });
    return;
  }
  refuseUnrecognised({ node, frame, ctx });
}

/** `INTERPOLATE (col AS expr)` — the interpolated column is a bare string. */
function walkInterpolatedColumn({ value, node, frame, ctx }: FieldArgs): void {
  if (typeof value !== "string") {
    refuseUnrecognised({ node, frame, ctx });
    return;
  }
  gateColumnReference({ name: value, ctx, frame, node });
}

// ---------------------------------------------------------------------------
// `enter` hooks — what a node decides before its fields are walked: the frame
// its children see, whether it is refused outright, and what it contributes to
// the block it sits in.
// ---------------------------------------------------------------------------

/**
 * Opens this SELECT's block and brings its CTE names into scope, before
 * anything else is walked.
 */
function enterSelectQuery({ node, frame, ctx }: NodeArgs): Frame {
  const block: BlockAccumulator = {
    tables: [],
    joins: [],
    filteredColumns: [],
    groupByColumns: [],
    hasGroupBy:
      (Array.isArray(node.group_by) && node.group_by.length > 0) || node.group_by_all === true,
    isAggregated: false,
  };
  ctx.blocks.push(block);

  if (!Array.isArray(node.with)) return { ...frame, block };
  const ctes = [...frame.ctes];
  for (const item of node.with) {
    if (isNode(item) && item.type === "WithElement" && typeof item.name === "string") {
      addOnce(ctes, item.name.trim().toLowerCase());
    }
  }
  return { ...frame, ctes, block };
}

/** Descends one query level, or refuses when that would pass the ceiling. */
function enterSubquery({ node, frame, ctx }: NodeArgs): Frame | null {
  const subqueryDepth = frame.subqueryDepth + 1;
  if (subqueryDepth > ctx.policy.limits.maxSubqueryDepth) {
    report({
      ctx,
      frame,
      code: "NESTING_TOO_DEEP",
      message:
        "This query nests subqueries or common table expressions too deeply. Flatten it and try again.",
      node,
    });
    return null;
  }
  return { ...frame, subqueryDepth, isInSubquery: true, clause: "subquery" };
}

/** A table reference written out in literal names, which is the only kind allowed. */
interface LiteralTableReference {
  readonly name: string;
  readonly database?: string;
  readonly alias?: string;
}

/**
 * Reads a table reference, or reports `null` for one whose parts are not
 * literal names.
 *
 * Any part may be a bound parameter in identifier position (`{db:Identifier}.t`,
 * `FROM {which:Identifier}`), and a table chosen at bind time is a table the
 * allowlist cannot see — which would mean the allowlist was not one.
 */
function readTableReference(node: SqlAstNode): LiteralTableReference | null {
  const { name, database, alias } = node;
  if (typeof name !== "string") return null;
  if (database !== undefined && typeof database !== "string") return null;
  if (alias !== undefined && typeof alias !== "string") return null;
  return {
    name,
    ...(database === undefined ? {} : { database }),
    ...(alias === undefined ? {} : { alias }),
  };
}

/** Checks a table reference against the reserved schemas, then the catalog. */
function enterTableIdentifier({ node, frame, ctx }: NodeArgs): Frame | null {
  const reference = readTableReference(node);
  if (!reference) {
    report({
      ctx,
      frame,
      code: "TABLE_NOT_ALLOWED",
      message: "Name the dataset directly — a table cannot be chosen by a bound parameter.",
      node,
    });
    return null;
  }

  const database = reference.database?.trim().toLowerCase();
  if (database !== undefined && ctx.policy.reservedDatabases.has(database)) {
    report({
      ctx,
      frame,
      code: "SCHEMA_NOT_ALLOWED",
      message:
        "Server metadata is not readable through this API. Query the analytics datasets instead.",
      node,
    });
    return null;
  }

  // A `WITH` name resolves to its own subquery, which is validated on its own
  // terms; it is not a table reference and never was.
  if (database === undefined && frame.ctes.includes(reference.name.trim().toLowerCase())) {
    return frame;
  }

  const qualified = qualifyTableName({
    table: reference.name,
    database: reference.database,
    defaultDatabase: ctx.policy.defaultDatabase,
  });
  if (!ctx.policy.allowedTables.has(qualified)) {
    const written = reference.database ? `${reference.database}.${reference.name}` : reference.name;
    report({
      ctx,
      frame,
      code: "TABLE_NOT_ALLOWED",
      message: `The dataset "${echoIdentifier(written)}" is not available to you. Use one of the datasets from the schema endpoint.`,
      node,
    });
    return null;
  }
  addOnce(ctx.tables, qualified);
  frame.block?.tables.push({
    table: qualified,
    ...(reference.alias ? { alias: reference.alias.trim().toLowerCase() } : {}),
  });
  return frame;
}

/**
 * How many nodes the join-key scan will look at before giving up.
 *
 * The scan runs inside {@link enterTableJoin}, which is *before* the walk's own
 * depth ceiling has descended into the `ON` expression, so it cannot borrow
 * that ceiling. A join condition big enough to reach this bound is one no
 * diagnostic would say anything useful about anyway, and the query itself is
 * still validated by the walk that follows.
 */
const MAX_JOIN_KEY_SCAN_NODES = 200;

/** The name a side of a join equality was written with, or `null` if it is not a plain reference. */
function joinSideName(value: unknown): string | null {
  if (!isNode(value) || value.type !== "Identifier") return null;
  return typeof value.name === "string" ? value.name : null;
}

/**
 * The equality pairs a `JOIN` was written on.
 *
 * Descends `AND` only. An equality reached through an `OR`, a `NOT`, or any
 * other function is not a key the join is guaranteed to have matched on, and
 * recording it would tell a diagnostic that two datasets line up on a column
 * when they may not.
 */
function collectJoinEdges({ node, block }: { node: SqlAstNode; block: BlockAccumulator }): void {
  collectUsingEdges({ using: node.using, block });
  collectOnEdges({ on: node.on, block });
}

/**
 * Records the pairs a `USING (col)` clause implies.
 *
 * `USING` matches the same name on both sides, which is exactly the pair an
 * `ON` would have spelled out.
 */
function collectUsingEdges({ using, block }: { using: unknown; block: BlockAccumulator }): void {
  if (!Array.isArray(using)) return;
  for (const element of using) {
    const name = joinSideName(element);
    if (name !== null) block.joins.push({ left: name, right: name });
  }
}

/**
 * Records the equality pairs reachable from an `ON` condition through `AND`.
 *
 * Bounded by {@link MAX_JOIN_KEY_SCAN_NODES}: the condition is caller-written,
 * so the descent needs a ceiling that does not depend on it being reasonable.
 */
function collectOnEdges({ on, block }: { on: unknown; block: BlockAccumulator }): void {
  const pending: unknown[] = [on];
  let visited = 0;
  while (pending.length > 0 && visited < MAX_JOIN_KEY_SCAN_NODES) {
    visited += 1;
    const current = pending.pop();

    const conjuncts = conjunctArguments(current);
    if (conjuncts !== null) {
      pending.push(...conjuncts);
      continue;
    }

    const edge = readEqualityEdge(current);
    if (edge !== null) block.joins.push(edge);
  }
}

/** The operands of an `AND`, or `null` for any other node. */
function conjunctArguments(node: unknown): unknown[] | null {
  if (!isNode(node) || node.type !== "Function") return null;
  if (node.name !== "and" || !Array.isArray(node.arguments)) return null;
  return node.arguments;
}

/**
 * The join edge an `a = b` node names, or `null` for anything else.
 *
 * Both sides have to resolve to a name: an equality against an expression is
 * not a key two datasets line up on, and recording half of one would claim a
 * match that was never written.
 */
function readEqualityEdge(node: unknown): { left: string; right: string } | null {
  if (!isNode(node) || node.type !== "Function") return null;
  if (node.name !== "equals" || !Array.isArray(node.arguments)) return null;
  if (node.arguments.length !== 2) return null;
  const left = joinSideName(node.arguments[0]);
  const right = joinSideName(node.arguments[1]);
  return left !== null && right !== null ? { left, right } : null;
}

/** Records the join's key pairs, then lets the walk validate the condition itself. */
function enterTableJoin({ node, frame }: NodeArgs): Frame {
  if (frame.block) collectJoinEdges({ node, block: frame.block });
  return frame;
}

/**
 * Applies the function allowlist, and notes an aggregate for the block.
 *
 * Reports and keeps descending rather than cutting the subtree off, so that a
 * caller who used a refused function *and* a restricted field hears about both
 * in one round trip.
 */
function enterFunction({ node, frame, ctx }: NodeArgs): Frame | null {
  const { name } = node;
  if (typeof name !== "string") {
    refuseUnrecognised({ node, frame, ctx });
    return null;
  }
  if (!isAllowedLangWatchQLFunction(name)) {
    reportRefusedFunction({ name, node, frame, ctx });
    return frame;
  }
  if (frame.block && isLangWatchQLAggregateFunction(name) && !isWindowCall(node)) {
    frame.block.isAggregated = true;
  }
  return frame;
}

/** Whether this call is a window function rather than a row-collapsing aggregate. */
function isWindowCall(node: SqlAstNode): boolean {
  return (
    node.kind === "WINDOW_FUNCTION" ||
    node.is_window_function === true ||
    node.window_definition !== undefined ||
    node.window_name !== undefined
  );
}

function reportRefusedFunction({
  name,
  node,
  frame,
  ctx,
}: {
  name: string;
  node: SqlAstNode;
  frame: Frame;
  ctx: WalkContext;
}): void {
  report({
    ctx,
    frame,
    code: "FUNCTION_NOT_ALLOWED",
    message: `The function "${echoIdentifier(name)}" cannot be used here. Rewrite the expression using the functions this API supports.`,
    node,
  });
}

/**
 * `APPLY(f)` on a column set names its function as a bare string rather than as
 * a call, so the allowlist has to be applied here too — the one place a
 * function reaches the walk without a `Function` node around it.
 */
function walkApplyFunctionName({ value, node, frame, ctx }: FieldArgs): void {
  if (typeof value !== "string") {
    refuseUnrecognised({ node, frame, ctx });
    return;
  }
  if (isAllowedLangWatchQLFunction(value)) return;
  reportRefusedFunction({ name: value, node, frame, ctx });
}

/** Applies the content gate to a column reference. */
function enterIdentifier({ node, frame, ctx }: NodeArgs): Frame | null {
  const { name, name_parts: nameParts } = node;
  if (typeof name !== "string") {
    refuseUnrecognised({ node, frame, ctx });
    return null;
  }
  // Compound names hold their segments here, and a segment may be a bound
  // parameter in identifier position rather than a string — which would let a
  // caller name a field the gate never sees.
  if (
    nameParts !== undefined &&
    (!Array.isArray(nameParts) || nameParts.some((part) => typeof part !== "string"))
  ) {
    report({
      ctx,
      frame,
      code: "GATED_COLUMN",
      message: "Name the field directly — a field cannot be chosen by a bound parameter.",
      node,
    });
    return null;
  }
  gateColumnReference({ name, ctx, frame, node });
  noteColumnPosition({ name, frame });
  return frame;
}

/**
 * Records a column named in a filter or grouping position on the block it sits
 * in.
 *
 * The leaf segment only: what a diagnostic asks is "was this dataset's time
 * column filtered", and `t.OccurredAt`, `OccurredAt` and
 * `analytics.traces.OccurredAt` are all the same answer to it.
 */
function noteColumnPosition({ name, frame }: { name: string; frame: Frame }): void {
  const { block, clause } = frame;
  if (!block) return;
  if (clause !== "filter" && clause !== "group") return;
  const leaf = name.split(".").at(-1)?.trim().toLowerCase();
  if (!leaf) return;
  if (clause === "filter") addOnce(block.filteredColumns, leaf);
  else addOnce(block.groupByColumns, leaf);
}

/**
 * Records a bound parameter. Parameters are *values*, and values are permitted
 * — but an `Identifier`-typed one is not a value, and is refused.
 *
 * The rest of this file decides what a query may name by reading names out of
 * the parse: {@link gateColumnReference} matches a column reference against the
 * caller's withheld set, and {@link readTableReference} refuses a table whose
 * name is not literal, "because a table chosen at bind time is a table the
 * allowlist cannot see — which would mean the allowlist was not one."
 *
 * That argument is not specific to tables. A column chosen at bind time is a
 * column the *gate* cannot see: `SELECT {c:Identifier}` carries no column
 * reference through the walk at all, so ClickHouse substitutes the name after
 * every check has already passed. Measured against a caller whose data-privacy
 * policy withholds captured content, that returned the withheld value — the
 * literal spelling of the same query is refused with `GATED_COLUMN`.
 *
 * So the refusal is total rather than a gate-check on the bound value: the
 * substitution happens in the database, after this validator has finished, and
 * a check here would be reasoning about a string that the parse does not
 * commit to. Callers write column names literally; the schema endpoint is what
 * tells them which names exist.
 */
function enterQueryParameter({ node, frame, ctx }: NodeArgs): Frame | null {
  const { name, param_type: paramType } = node;
  if (typeof name !== "string" || typeof paramType !== "string") {
    refuseUnrecognised({ node, frame, ctx });
    return null;
  }
  if (paramType.trim().toLowerCase() === "identifier") {
    report({
      ctx,
      frame,
      code: "UNSUPPORTED_SYNTAX",
      message:
        `The parameter "${echoIdentifier(name)}" binds an identifier, which cannot be used here. ` +
        "Write the table or column name directly in the query.",
      node,
    });
    return null;
  }
  if (!ctx.parameters.some((parameter) => parameter.name === name)) {
    ctx.parameters.push({ name, type: paramType });
  }
  return frame;
}

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

const SCALAR: FieldRule = { kind: "scalar" };

const SETTINGS_CLAUSE_MESSAGE =
  "A SETTINGS clause cannot be used here. Remove it — execution settings are fixed by the API.";

const REFUSE_SETTINGS: FieldRule = {
  kind: "refuse",
  code: "SETTINGS_CLAUSE",
  message: SETTINGS_CLAUSE_MESSAGE,
};
const REFUSE_OUTPUT: FieldRule = {
  kind: "refuse",
  code: "OUTPUT_CLAUSE",
  message: "FORMAT and INTO OUTFILE cannot be used here. The API decides how results are returned.",
};

/**
 * Every node kind the walk recognises, and every field each of them may carry.
 *
 * Read this table as the policy: it is the complete statement of what a
 * LangWatchQL query may contain. Nothing outside it is reachable.
 */
const NODE_RULES: Readonly<Record<string, NodeRule>> = {
  // ---- query structure ----
  SelectWithUnionQuery: {
    fields: {
      selects: { kind: "nodes" },
      // Both modes are read-only set operations, and the row policy applies to
      // each branch identically. Listed by value so a third mode fails closed.
      union_mode: { kind: "enum", values: ["UNION_ALL", "UNION_DISTINCT"] },
      settings: REFUSE_SETTINGS,
      format: REFUSE_OUTPUT,
      out_file: REFUSE_OUTPUT,
      outfile_truncate: REFUSE_OUTPUT,
      settings_before_format: REFUSE_OUTPUT,
    },
  },
  SelectQuery: {
    enter: enterSelectQuery,
    fields: {
      with: { kind: "nodes", clause: "with" },
      recursive_with: SCALAR,
      distinct: SCALAR,
      select: { kind: "custom", walk: walkProjection },
      from: { kind: "node", clause: "from" },
      prewhere: { kind: "node", clause: "filter" },
      where: { kind: "node", clause: "filter" },
      group_by: { kind: "nodes", clause: "group" },
      group_by_all: SCALAR,
      group_by_with_totals: SCALAR,
      group_by_with_rollup: SCALAR,
      group_by_with_cube: SCALAR,
      group_by_with_grouping_sets: SCALAR,
      having: { kind: "node", clause: "having" },
      window: { kind: "nodes", clause: "window" },
      qualify: { kind: "node", clause: "filter" },
      order_by: { kind: "nodes", clause: "order" },
      order_by_all: SCALAR,
      interpolate: { kind: "nodes", clause: "order" },
      limit_by: { kind: "custom", walk: walkLimitBy },
      limit: { kind: "node", clause: "limit" },
      offset: { kind: "node", clause: "limit" },
      limit_with_ties: SCALAR,
      settings: REFUSE_SETTINGS,
    },
  },
  Subquery: {
    enter: enterSubquery,
    fields: { query: { kind: "node" }, alias: SCALAR },
  },
  WithElement: {
    fields: {
      name: SCALAR,
      subquery: { kind: "node" },
      aliases: { kind: "node" },
    },
  },

  // ---- FROM ----
  TablesInSelectQuery: { fields: { children: { kind: "nodes" } } },
  TablesInSelectQueryElement: {
    fields: {
      table_expression: { kind: "node" },
      table_join: { kind: "node", clause: "join" },
      array_join: { kind: "node", clause: "from" },
    },
  },
  TableExpression: {
    fields: {
      database_and_table_name: { kind: "node" },
      table_function: {
        kind: "refuse",
        code: "TABLE_FUNCTION",
        message:
          "Table functions cannot be used here. Read from the analytics datasets listed by the schema endpoint.",
      },
      subquery: { kind: "node" },
      final: SCALAR,
      sample_size: { kind: "node" },
      sample_offset: { kind: "node" },
      column_aliases: { kind: "node" },
    },
  },
  TableIdentifier: {
    enter: enterTableIdentifier,
    fields: { name: SCALAR, database: SCALAR, alias: SCALAR },
  },
  TableJoin: {
    enter: enterTableJoin,
    fields: {
      // PASTE is absent deliberately: it joins by row position rather than by
      // key, which is not a shape the LangWatchQL schema's joins are defined for.
      kind: {
        kind: "enum",
        values: ["INNER", "LEFT", "RIGHT", "FULL", "CROSS", "COMMA"],
      },
      strictness: {
        kind: "enum",
        values: ["ANY", "ALL", "ASOF", "SEMI", "ANTI"],
      },
      locality: { kind: "enum", values: ["GLOBAL"] },
      using: { kind: "nodes", clause: "join" },
      on: { kind: "node", clause: "join" },
    },
  },
  ArrayJoin: {
    fields: {
      kind: { kind: "enum", values: ["INNER", "LEFT"] },
      expressions: { kind: "nodes", clause: "from" },
    },
  },
  SampleRatio: { fields: { numerator: SCALAR, denominator: SCALAR } },

  // ---- ordering, windows, grouping ----
  OrderByElement: {
    fields: {
      expression: { kind: "node" },
      direction: { kind: "enum", values: ["ASC", "DESC"] },
      collation: { kind: "node" },
      nulls_first: SCALAR,
      with_fill: SCALAR,
      fill_from: { kind: "node" },
      fill_to: { kind: "node" },
      fill_step: { kind: "node" },
      fill_staleness: { kind: "node" },
    },
  },
  InterpolateElement: {
    fields: {
      column: { kind: "custom", walk: walkInterpolatedColumn },
      expr: { kind: "node" },
    },
  },
  WindowListElement: {
    fields: { name: SCALAR, definition: { kind: "node", clause: "window" } },
  },
  WindowDefinition: {
    fields: {
      parent_window_name: SCALAR,
      partition_by: { kind: "nodes", clause: "window" },
      order_by: { kind: "nodes", clause: "window" },
      frame_type: { kind: "enum", values: ["ROWS", "RANGE", "GROUPS"] },
      frame_begin: { kind: "node", clause: "window" },
      frame_end: { kind: "node", clause: "window" },
    },
  },
  // Frame bounds are inline `{ type }` objects rather than named AST nodes,
  // but they reach the walk the same way and so need rules the same way.
  Unbounded: { fields: { preceding: SCALAR } },
  Current: { fields: { preceding: SCALAR } },
  Offset: { fields: { preceding: SCALAR, offset: { kind: "node" } } },

  // ---- expressions ----
  Identifier: {
    enter: enterIdentifier,
    fields: { name: SCALAR, name_parts: SCALAR, alias: SCALAR },
  },
  Literal: {
    fields: {
      value_type: SCALAR,
      value: SCALAR,
      alias: SCALAR,
      nonfinite: SCALAR,
    },
  },
  Function: {
    // On `enter` rather than as a rule for the `name` field, because a field
    // rule only fires when the field is present: a `Function` node that
    // arrived without a name would walk straight past a name check hung there.
    enter: enterFunction,
    fields: {
      name: SCALAR,
      arguments: { kind: "nodes" },
      parameters: { kind: "nodes" },
      is_operator: SCALAR,
      is_lambda_function: SCALAR,
      is_window_function: SCALAR,
      // The other FunctionKind values (TABLE_ENGINE, CODEC, …) only occur in
      // DDL, which never reaches this walk; listing them would be listing
      // syntax we refuse at the statement.
      kind: {
        kind: "enum",
        values: ["LAMBDA_FUNCTION", "WINDOW_FUNCTION"],
      },
      window_definition: { kind: "node", clause: "window" },
      window_name: SCALAR,
      nulls_action: {
        kind: "enum",
        values: ["RESPECT NULLS", "IGNORE NULLS"],
      },
      alias: SCALAR,
      no_parens: SCALAR,
    },
  },
  QueryParameter: {
    enter: enterQueryParameter,
    fields: { name: SCALAR, param_type: SCALAR, alias: SCALAR },
  },
  ExpressionList: { fields: { children: { kind: "nodes" } } },

  // ---- column sets ----
  Asterisk: {
    fields: {
      transformers: { kind: "nodes" },
      expression: { kind: "node" },
    },
  },
  QualifiedAsterisk: {
    fields: {
      qualifier: { kind: "identifierRef" },
      columns: { kind: "nodes" },
      transformers: { kind: "nodes" },
    },
  },
  ColumnsRegexpMatcher: {
    fields: { pattern: SCALAR, transformers: { kind: "nodes" } },
  },
  ColumnsListMatcher: {
    fields: { columns: { kind: "nodes" }, transformers: { kind: "nodes" } },
  },
  QualifiedColumnsRegexpMatcher: {
    fields: {
      pattern: SCALAR,
      qualifier: { kind: "identifierRef" },
      transformers: { kind: "node" },
    },
  },
  QualifiedColumnsListMatcher: {
    fields: {
      qualifier: { kind: "identifierRef" },
      columns: { kind: "nodes" },
      transformers: { kind: "node" },
    },
  },
  ColumnsTransformerList: { fields: { children: { kind: "nodes" } } },
  ColumnsApplyTransformer: {
    fields: {
      func_name: { kind: "custom", walk: walkApplyFunctionName },
      parameters: { kind: "node" },
      lambda: { kind: "node" },
      lambda_arg: SCALAR,
    },
  },
  ColumnsExceptTransformer: {
    fields: {
      is_strict: SCALAR,
      columns: { kind: "nodes" },
      pattern: SCALAR,
    },
  },
  ColumnsReplaceTransformer: {
    fields: { is_strict: SCALAR, replacements: { kind: "nodes" } },
  },
  "ColumnsReplaceTransformer::Replacement": {
    // `name` is the output column the replacement is bound to, not a read of
    // the underlying field, so the content gate does not apply to it.
    fields: { name: SCALAR, expression: { kind: "node" } },
  },

  // ---- recognised so the refusal is specific ----
  Settings: {
    // Listed rather than left to the fallthrough so that a smuggled SETTINGS
    // clause says so, wherever it appears — including inside a function call,
    // where ClickHouse accepts `f(x SETTINGS k = v)`.
    enter: ({ node, frame, ctx }) => {
      report({
        ctx,
        frame,
        code: "SETTINGS_CLAUSE",
        message: SETTINGS_CLAUSE_MESSAGE,
        node,
      });
      return null;
    },
    fields: {},
  },
};
