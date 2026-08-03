/**
 * Governed analytics SQL — the default-deny AST validator.
 *
 * The gateway's half of the isolation model. The database's half is already
 * proven and shipped in `../provisioning.ts`: a readonly identity, per-object
 * row policies, and a tenant capability the caller cannot forge. This validator
 * does not carry tenant isolation — it is defense in depth, and the reason it
 * exists is that a query which never reaches the database cannot exercise a bug
 * in the layer that would otherwise contain it.
 *
 * ## The rule that makes it a gate rather than a filter
 *
 * The walk is an **allowlist over node kinds, and over each kind's fields**.
 * A node type {@link NODE_RULES} does not name is refused; so is a *field* the
 * rule for that node type does not name. Both matter. A kind-only allowlist
 * would let new syntax ride into an existing node — `INTO OUTFILE` is a plain
 * string literal hanging off a field of an otherwise ordinary SELECT — and the
 * walk would never look at it. So every field is either walked, explicitly
 * accepted as an inert scalar, restricted to an enumerated set of values, or
 * refused outright. There is no fourth state, and no field can be listed
 * without deciding which one it is.
 *
 * The consequence is deliberate: when `@clickhouse/parser` learns syntax that
 * ClickHouse already supports, that syntax arrives here **refused**, and stays
 * refused until someone adds a rule for it. New capability is a review, never a
 * silent widening. The version is pinned exactly for the same reason
 * (`./parser.ts`).
 *
 * ## What is allowed
 *
 * A single `SELECT`, optionally with `WITH`; aggregates and window functions;
 * CTEs, subqueries and `UNION` within the depth ceilings; joins; array, map and
 * JSON access; and bound parameters. Everything else — every write and every
 * DDL form, `SETTINGS` in any position, role changes, reserved schemas, output
 * redirection, and every table function — is refused.
 *
 * ## Table functions
 *
 * Refused **positionally**: a `TableExpression` carrying a `table_function` is
 * a violation whatever the function is named. That is stronger than the
 * name-list pre-check `TABLE_FUNCTION_RE` in `src/server/ops/explain-core.ts`
 * applies to the ops EXPLAIN endpoint, so this file deliberately keeps no list
 * of its own — a second list is a second thing to keep in sync, and this one
 * would always be a subset of "all of them".
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
 * @see specs/analytics/governed-sql-api.feature
 * @see ../provisioning.ts — the database-layer isolation this backs up
 */

import {
  clickHouseSqlParser,
  type GovernedSqlParser,
  type SqlAstNode,
  type SqlSourcePosition,
} from "./parser";
import {
  type GovernedSqlPolicy,
  qualifyTableName,
  type ResolvedGovernedSqlPolicy,
  resolveGovernedSqlPolicy,
} from "./policy";
import {
  echoIdentifier,
  type GovernedSqlClause,
  type GovernedSqlViolation,
  type GovernedSqlViolationCode,
} from "./violations";

/** A bound parameter the query declares, e.g. `{since:DateTime}`. */
export interface GovernedSqlParameter {
  readonly name: string;
  /** The declared ClickHouse type, as the caller wrote it. */
  readonly type: string;
}

/** A query that passed the gate, with the facts the walk established. */
export interface AcceptedGovernedSql {
  readonly ok: true;
  /** Governed tables the query reads, qualified and lowercased. CTEs excluded. */
  readonly tables: readonly string[];
  /** Bound parameters the query declares, in first-seen order. */
  readonly parameters: readonly GovernedSqlParameter[];
}

/** A query that was refused, and every reason found before the walk stopped. */
export interface RejectedGovernedSql {
  readonly ok: false;
  /** Never empty. Capped at {@link MAX_VIOLATIONS}; a longer list is truncated. */
  readonly violations: readonly GovernedSqlViolation[];
}

export type GovernedSqlValidation = AcceptedGovernedSql | RejectedGovernedSql;

/**
 * How many reasons a single rejection reports.
 *
 * All of them, up to a cap: an agent fixing a query wants every problem at
 * once, not one per round trip. The cap is there because a pathological query
 * can violate the policy thousands of times and the list rides in a response
 * body.
 */
export const MAX_VIOLATIONS = 20;

/** Fields every node may carry that say nothing about what the query does. */
const METADATA_FIELDS: ReadonlySet<string> = new Set([
  "type",
  "location",
  "parent",
  "leadingComments",
  "trailingComments",
]);

/**
 * Column-set constructs whose members the walk cannot enumerate.
 *
 * Refused in a projection when the caller has restricted fields, because there
 * is no way to prove the expansion excludes them without the table's columns —
 * which this layer deliberately does not have. `COLUMNS(a, b)` is absent on
 * purpose: it names its columns, so they are checked like any other reference.
 */
const UNRESOLVABLE_COLUMN_SETS: ReadonlySet<string> = new Set([
  "Asterisk",
  "QualifiedAsterisk",
  "ColumnsRegexpMatcher",
  "QualifiedColumnsRegexpMatcher",
]);

/** Where the walk currently is, and what it has learned on the way down. */
interface Frame {
  readonly clause: GovernedSqlClause;
  /** Sticky: once inside a nested query, every violation reports `subquery`. */
  readonly inSubquery: boolean;
  readonly subqueryDepth: number;
  readonly nodeDepth: number;
  /** CTE names visible here, lowercased. Not checked against the table policy. */
  readonly ctes: ReadonlySet<string>;
}

/** Everything the walk accumulates. */
interface WalkContext {
  readonly policy: ResolvedGovernedSqlPolicy;
  readonly violations: GovernedSqlViolation[];
  readonly tables: Set<string>;
  readonly parameters: Map<string, string>;
}

interface NodeArgs {
  readonly node: SqlAstNode;
  readonly frame: Frame;
  readonly ctx: WalkContext;
}

interface FieldArgs extends NodeArgs {
  readonly value: unknown;
}

/**
 * What the walk does with one field of one node kind.
 *
 * The four non-walking kinds are the whole point: a field cannot be listed
 * without saying whether its contents are inspected (`node` / `nodes` /
 * `custom`), inert (`scalar`), constrained to known values (`enum`), or fatal
 * (`refuse`). Anything not listed at all is refused by {@link walkNode}.
 */
type FieldRule =
  | { readonly kind: "node"; readonly clause?: GovernedSqlClause }
  | { readonly kind: "nodes"; readonly clause?: GovernedSqlClause }
  /** An `Identifier` naming a table or alias, not a column: never gate-checked. */
  | { readonly kind: "identifierRef" }
  | { readonly kind: "scalar" }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | {
      readonly kind: "refuse";
      readonly code: GovernedSqlViolationCode;
      readonly message: string;
    }
  | { readonly kind: "custom"; readonly walk: (args: FieldArgs) => void };

interface NodeRule {
  /** Every field this node kind may carry. Anything else is refused. */
  readonly fields: Readonly<Record<string, FieldRule>>;
  /**
   * Runs before the fields, and decides the frame they are walked in.
   * Returning `null` refuses the subtree without descending into it.
   */
  readonly enter?: (args: NodeArgs) => Frame | null;
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

function positionOf(node: SqlAstNode): SqlSourcePosition | undefined {
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
  code: GovernedSqlViolationCode;
  message: string;
  node?: SqlAstNode;
}): void {
  if (ctx.violations.length >= MAX_VIOLATIONS) return;
  const at = node ? positionOf(node) : undefined;
  ctx.violations.push({
    code,
    clause: frame.inSubquery ? "subquery" : frame.clause,
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

const TOO_DEEP_MESSAGE =
  "This query nests too deeply. Flatten it and try again.";

/** The rule for a node kind, or `undefined` — which is the refusal. */
function ruleFor(type: string): NodeRule | undefined {
  return Object.hasOwn(NODE_RULES, type) ? NODE_RULES[type] : undefined;
}

function walkNode(node: SqlAstNode, frame: Frame, ctx: WalkContext): void {
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
function walkFields({
  rule,
  node,
  frame,
  ctx,
}: NodeArgs & { rule: NodeRule }): void {
  for (const [field, value] of Object.entries(node)) {
    if (METADATA_FIELDS.has(field) || value === undefined) continue;
    const fieldRule = Object.hasOwn(rule.fields, field)
      ? rule.fields[field]
      : undefined;
    if (fieldRule) applyFieldRule({ rule: fieldRule, value, node, frame, ctx });
    else refuseUnrecognised({ node, frame, ctx });
  }
}

function applyFieldRule({
  rule,
  value,
  node,
  frame,
  ctx,
}: FieldArgs & { rule: FieldRule }): void {
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
  if (
    isNode(value) &&
    value.type === "Identifier" &&
    typeof value.name === "string"
  ) {
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
}: FieldArgs & { clause?: GovernedSqlClause }): void {
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
}: FieldArgs & { clause?: GovernedSqlClause }): void {
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
    if (
      ctx.policy.gatedColumns.size > 0 &&
      UNRESOLVABLE_COLUMN_SETS.has(element.type)
    ) {
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

function walkLimitByField({
  field,
  value,
  node,
  frame,
  ctx,
}: FieldArgs & { field: string }): void {
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
// `enter` hooks — the three places the frame changes
// ---------------------------------------------------------------------------

/** Brings this SELECT's CTE names into scope before anything else is walked. */
function enterSelectQuery({ node, frame }: NodeArgs): Frame {
  if (!Array.isArray(node.with)) return frame;
  const ctes = new Set(frame.ctes);
  for (const item of node.with) {
    if (
      isNode(item) &&
      item.type === "WithElement" &&
      typeof item.name === "string"
    ) {
      ctes.add(item.name.trim().toLowerCase());
    }
  }
  return { ...frame, ctes };
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
  return { ...frame, subqueryDepth, inSubquery: true, clause: "subquery" };
}

/** A table reference written out in literal names, which is the only kind allowed. */
interface LiteralTableReference {
  readonly name: string;
  readonly database?: string;
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
  return database === undefined ? { name } : { name, database };
}

/** Checks a table reference against the reserved schemas, then the catalog. */
function enterTableIdentifier({ node, frame, ctx }: NodeArgs): Frame | null {
  const reference = readTableReference(node);
  if (!reference) {
    report({
      ctx,
      frame,
      code: "TABLE_NOT_ALLOWED",
      message:
        "Name the dataset directly — a table cannot be chosen by a bound parameter.",
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
  if (
    database === undefined &&
    frame.ctes.has(reference.name.trim().toLowerCase())
  ) {
    return frame;
  }

  const qualified = qualifyTableName({
    table: reference.name,
    database: reference.database,
    defaultDatabase: ctx.policy.defaultDatabase,
  });
  if (!ctx.policy.allowedTables.has(qualified)) {
    const written = reference.database
      ? `${reference.database}.${reference.name}`
      : reference.name;
    report({
      ctx,
      frame,
      code: "TABLE_NOT_ALLOWED",
      message: `The dataset "${echoIdentifier(written)}" is not available to you. Use one of the datasets from the schema endpoint.`,
      node,
    });
    return null;
  }
  ctx.tables.add(qualified);
  return frame;
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
  if (nameParts !== undefined) {
    if (
      !Array.isArray(nameParts) ||
      nameParts.some((part) => typeof part !== "string")
    ) {
      report({
        ctx,
        frame,
        code: "GATED_COLUMN",
        message:
          "Name the field directly — a field cannot be chosen by a bound parameter.",
        node,
      });
      return null;
    }
  }
  gateColumnReference({ name, ctx, frame, node });
  return frame;
}

/** Records a bound parameter. Parameters are values, and always permitted. */
function enterQueryParameter({ node, frame, ctx }: NodeArgs): Frame | null {
  const { name, param_type: paramType } = node;
  if (typeof name !== "string" || typeof paramType !== "string") {
    refuseUnrecognised({ node, frame, ctx });
    return null;
  }
  if (!ctx.parameters.has(name)) ctx.parameters.set(name, paramType);
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
  message:
    "FORMAT and INTO OUTFILE cannot be used here. The API decides how results are returned.",
};

/**
 * Every node kind the walk recognises, and every field each of them may carry.
 *
 * Read this table as the policy: it is the complete statement of what a
 * governed query may contain. Nothing outside it is reachable.
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
    fields: {
      // PASTE is absent deliberately: it joins by row position rather than by
      // key, which is not a shape the governed schema's joins are defined for.
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
      func_name: SCALAR,
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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ValidateGovernedSqlInput extends GovernedSqlPolicy {
  /** The SQL exactly as the caller submitted it. Never rewritten. */
  readonly sql: string;
  /**
   * The front end. Defaults to the shipped ClickHouse parser; injected only by
   * tests that need to drive the walk with a tree the grammar cannot produce.
   */
  readonly parser?: GovernedSqlParser;
}

/**
 * Decides whether a submitted query may be executed against the governed
 * analytics schema.
 *
 * Never throws for a rejection — a refused query is an outcome, not an
 * exception, and the caller decides how to surface it (`./errors.ts` turns a
 * rejection into the handled error the REST boundary serialises). It also never
 * rewrites the SQL: the statement the executor sends is the statement that
 * arrived.
 *
 * @example
 * ```ts
 * const result = validateGovernedSql({
 *   sql: "SELECT count() FROM traces",
 *   allowedTables: ["analytics.traces"],
 *   gatedColumns: ["body"],
 *   defaultDatabase: "analytics",
 * });
 * if (!result.ok) throw governedSqlValidationError(result);
 * ```
 */
export function validateGovernedSql({
  sql,
  parser = clickHouseSqlParser,
  ...policy
}: ValidateGovernedSqlInput): GovernedSqlValidation {
  const screened = screenSubmission(parser, sql);
  if ("ok" in screened) return screened;

  const ctx = createWalkContext(resolveGovernedSqlPolicy(policy));
  walkNode(screened.statement, ROOT_FRAME, ctx);

  if (ctx.violations.length > 0)
    return { ok: false, violations: ctx.violations };
  return {
    ok: true,
    tables: [...ctx.tables],
    parameters: [...ctx.parameters].map(([name, type]) => ({ name, type })),
  };
}

const NO_CTES: ReadonlySet<string> = new Set<string>();

const ROOT_FRAME: Frame = {
  clause: "statement",
  inSubquery: false,
  subqueryDepth: 0,
  nodeDepth: 0,
  ctes: NO_CTES,
};

/** A rejection carrying one statement-level reason. */
function statementRejection({
  code,
  message,
  at,
}: {
  code: GovernedSqlViolationCode;
  message: string;
  at?: SqlSourcePosition;
}): RejectedGovernedSql {
  return {
    ok: false,
    violations: [{ code, clause: "statement", message, ...(at ? { at } : {}) }],
  };
}

/**
 * Everything decided before the walk: that the text parses, that it is exactly
 * one statement, and that the statement is a read query.
 *
 * Returns the statement to walk, or the rejection that replaces it.
 */
function screenSubmission(
  parser: GovernedSqlParser,
  sql: string,
): { statement: SqlAstNode } | RejectedGovernedSql {
  const parsed = parseOrRefuse(parser, sql);
  if (!parsed.ok) {
    return statementRejection({
      code: "PARSE_FAILED",
      message:
        "This is not valid ClickHouse SQL. Check the syntax and try again.",
      at: parsed.at,
    });
  }
  if (parsed.statements.length > 1) {
    return statementRejection({
      code: "MULTIPLE_STATEMENTS",
      message:
        "Only one statement can be submitted at a time. Send a single SELECT statement.",
    });
  }
  const statement = parsed.statements[0];
  if (statement === undefined) {
    return statementRejection({
      code: "EMPTY_QUERY",
      message: "No query was submitted. Send a single SELECT statement.",
    });
  }
  if (statement.type !== "SelectWithUnionQuery") {
    return statementRejection({
      code: "STATEMENT_NOT_ALLOWED",
      message:
        "Only a single SELECT statement, optionally with a WITH clause, can be submitted here.",
      at: positionOf(statement),
    });
  }
  return { statement };
}

function parseOrRefuse(
  parser: GovernedSqlParser,
  sql: string,
): ReturnType<GovernedSqlParser["parse"]> {
  try {
    return parser.parse(sql);
  } catch {
    return { ok: false };
  }
}

function createWalkContext(policy: ResolvedGovernedSqlPolicy): WalkContext {
  return {
    policy,
    violations: [],
    tables: new Set<string>(),
    parameters: new Map<string, string>(),
  };
}
