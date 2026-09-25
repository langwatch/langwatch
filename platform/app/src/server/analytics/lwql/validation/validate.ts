/**
 * LangWatchQL analytics SQL — the default-deny AST validator.
 *
 * The gateway's half of the isolation model. The database's half is already
 * proven and shipped in `../provisioning/accessModel.ts`: a readonly identity, per-object
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
 * ## Functions are allowlisted by name, in a third list
 *
 * Kinds and fields are not enough on their own. Every function call *and every
 * operator* arrives as one `Function` node, so a walk that stops at the kind
 * admits `getSetting()`, `currentUser()`, `hostName()` and `version()` — none
 * of which reaches another tenant, and all of which publish more of the server
 * than this API means to. `./functions.ts` is the name allowlist and carries
 * the rule that governs it: a function is listed because a LangWatchQL question
 * needs it, never because it looks harmless. It is applied in two places,
 * because a name reaches the walk in two shapes — a `Function` node, and the
 * bare `func_name` string of an `APPLY` column transformer.
 *
 * ## App functions are a fourth list, and their rule is positional
 *
 * `../appFunctions/catalog.ts` names the functions whose value the
 * *application* computes after the query. They are deliberately absent from
 * the allowlist above: they are admitted only as direct elements of the
 * outermost `SELECT` list, with an alias, and refused everywhere else. That is
 * a correctness rule rather than a policy one — the database holds each of them
 * as a projection UDF over its key, so `WHERE conversation(x) = 'y'` compares
 * the raw key and answers with the wrong rows and no error. The validator is
 * the only layer that can see the difference.
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
 * @see specs/lwql/api.feature
 * @see ../provisioning/accessModel.ts — the database-layer isolation this backs up
 */

import {
  type LangWatchQLAppFunctionDefinition,
  lwqlAppFunction,
  lwqlAppFunctionSignature,
} from "../appFunctions/catalog";
import { isEvalFunctionName } from "../appFunctions/evalCatalog";
import type {
  LangWatchQLAppFunctionCall,
  LangWatchQLAppFunctionOption,
  LangWatchQLAppFunctionSource,
} from "../appFunctions/plan";
import { LWQL_MAX_RESULT_ROWS } from "../limits";
import { readAppFunctionArguments } from "./appFunctionArguments";
import {
  isAllowedLangWatchQLFunction,
  isLangWatchQLAggregateFunction,
  LWQL_ALLOWED_FUNCTION_NAMES,
} from "./functions";
import {
  clickHouseSqlParser,
  type LangWatchQLParser,
  type SqlAstNode,
  type SqlSourcePosition,
} from "./parser";
import {
  type LangWatchQLPolicy,
  qualifyTableName,
  type ResolvedLangWatchQLPolicy,
  resolveLangWatchQLPolicy,
} from "./policy";
import {
  echoIdentifier,
  type LangWatchQLClause,
  type LangWatchQLViolation,
  type LangWatchQLViolationCode,
} from "./violations";

/** A bound parameter the query declares, e.g. `{since:DateTime}`. */
export interface LangWatchQLParameter {
  readonly name: string;
  /** The declared ClickHouse type, as the caller wrote it. */
  readonly type: string;
}

/** A LangWatchQL table as one query block named it. */
export interface LangWatchQLTableReference {
  /** Qualified and lowercased, the way {@link AcceptedLangWatchQL.tables} is. */
  readonly table: string;
  /** The alias the block gave it, lowercased. Absent when it was named directly. */
  readonly alias?: string;
}

/**
 * One equality a `JOIN` was written on, with each side exactly as the caller
 * wrote it — `t.TraceId`, not a resolved column.
 *
 * Resolving a side to a view is the reader's job, and
 * {@link LangWatchQLQueryBlock.tables} is what it takes to do it: the qualifier
 * is either an alias or a table name from that same list. The walk deliberately
 * does not do it here, because doing so would mean deciding what an ambiguous
 * or shadowed qualifier means — a judgement that belongs to whoever is asking,
 * not to the gate.
 */
export interface LangWatchQLJoinEdge {
  readonly left: string;
  readonly right: string;
}

/**
 * One `SELECT` block, and the structure the walk saw in it.
 *
 * Recorded because a diagnostic like `POSSIBLE_FANOUT` — aggregating at a
 * parent's grain after a one-to-many join — is a question about the shape of
 * the query, and the walk is the only pass that ever looks at the tree. Reading
 * it back out later would mean parsing the statement a second time, and a
 * second parse is a second answer waiting to disagree with the first.
 */
export interface LangWatchQLQueryBlock {
  /**
   * LangWatchQL tables this block reads, in first-seen order. CTE names are
   * excluded for the same reason they are excluded from
   * {@link AcceptedLangWatchQL.tables}: a `WITH` name is its own block.
   */
  readonly tables: readonly LangWatchQLTableReference[];
  /**
   * The equalities this block's joins were written on.
   *
   * Only the conjunctive ones whose two sides are both plain column
   * references: `ON a = b AND c = d` contributes two edges, while a side that
   * is a function call, a literal, or one arm of an `OR` contributes none. The
   * question these answer is which key columns were matched, and an equality
   * that may or may not hold is not one of them.
   */
  readonly joins: readonly LangWatchQLJoinEdge[];
  /**
   * Column names this block filters on, lowercased and stripped of any
   * qualifier — `WHERE t.OccurredAt >= …` contributes `occurredat`.
   *
   * Only `WHERE`, `PREWHERE` and `QUALIFY`, which are the positions that bound
   * what a read touches. A join condition is deliberately absent: it says which
   * rows line up, not which rows are read.
   *
   * Recorded because "this query has no predicate on the view's partitioning
   * column" is a question about the query's shape, and the walk is the only
   * pass that ever looks at the tree. It reads the name as written, so a filter
   * written against a *projection alias* (`SELECT toStartOfHour(t) AS b … WHERE
   * b > x`) contributes the alias rather than the column — a diagnostic reading
   * this can therefore under-count real predicates, never invent one.
   */
  readonly filteredColumns: readonly string[];
  /** Whether the block carries `GROUP BY`, in any of its spellings. */
  readonly hasGroupBy: boolean;
  /**
   * Names the block groups by, lowercased and stripped of any qualifier.
   *
   * Names, not expressions: `GROUP BY toStartOfHour(t)` groups by something the
   * result has no name for, and is absent here, while the ordinary
   * `SELECT toStartOfHour(t) AS bucket … GROUP BY bucket` contributes `bucket`
   * — which is also the result column's name, and is what lets a reader tell a
   * grouping key apart from an aggregate that happens to return a timestamp.
   */
  readonly groupByColumns: readonly string[];
  /**
   * Whether the block collapses rows with an aggregate.
   *
   * `false` for an aggregate used with `OVER`: a window function reads a frame
   * and returns one value per row, which is the opposite of collapsing. A block
   * with a join, no `hasGroupBy` and no `isAggregated` is the bare `SELECT` over a
   * fanout that a diagnostic wants to warn about.
   */
  readonly isAggregated: boolean;
}

/** A query that passed the gate, with the facts the walk established. */
export interface AcceptedLangWatchQL {
  readonly ok: true;
  /** LangWatchQL tables the query reads, qualified and lowercased. CTEs excluded. */
  readonly tables: readonly string[];
  /** Bound parameters the query declares, in first-seen order. */
  readonly parameters: readonly LangWatchQLParameter[];
  /**
   * One entry per `SELECT` block, in the order the walk met them — the
   * outermost query first, then what it contains.
   */
  readonly blocks: readonly LangWatchQLQueryBlock[];
  /**
   * Whether the service should append the default `LIMIT` before executing.
   *
   * `true` for a single top-level `SELECT` that names no `LIMIT` of its own —
   * an `OFFSET` alone does not count as bounding, since `OFFSET 5` with no
   * `LIMIT` still returns every remaining row. Always `false` for a `UNION`:
   * each branch runs and returns independently, so a `LIMIT` appended once to
   * the whole statement cannot bound a branch that lacks one — every branch of
   * an accepted `UNION` already names its own bounded `LIMIT`, or the
   * statement was refused (`LIMIT_REQUIRED_PER_BRANCH`). A too-high `LIMIT` is
   * refused before it gets here (`LIMIT_TOO_HIGH`).
   */
  readonly appendRowLimit: boolean;
  /**
   * Where the appended default `LIMIT` must be inserted, when the statement
   * this bounds also names an `OFFSET`.
   *
   * ClickHouse only accepts `LIMIT n OFFSET m` in that order, so a caller who
   * wrote `SELECT … OFFSET 5` with no `LIMIT` needs the default inserted
   * before its `OFFSET`, not appended after it. Present only alongside
   * `appendRowLimit: true`, and only when that statement also has an `OFFSET`.
   */
  readonly appendRowLimitBeforeOffset?: SqlSourcePosition;
  /**
   * The app-function calls the outermost projection makes, in the order they
   * appear — the hydration plan.
   *
   * Empty for every statement that calls none, which is what makes the
   * hydration stage free for the queries that existed before app functions.
   * Recorded by this walk rather than re-read later for the reason ADR-083
   * gives about the diagnostics: a second parse is a second answer waiting to
   * disagree with the first, and here the two answers would be what a column
   * means.
   */
  readonly appFunctions: readonly LangWatchQLAppFunctionCall[];
}

/** A query that was refused, and every reason found before the walk stopped. */
export interface RejectedLangWatchQL {
  readonly ok: false;
  /** Never empty. Capped at {@link MAX_VIOLATIONS}; a longer list is truncated. */
  readonly violations: readonly LangWatchQLViolation[];
}

export type LangWatchQLValidation = AcceptedLangWatchQL | RejectedLangWatchQL;

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
 * Refused *wherever they appear* when the caller has restricted fields — not
 * only as a direct projection element — because there is no way to prove the
 * expansion excludes a withheld field without the table's columns, which this
 * layer deliberately does not have. Wrapping one in a function or burying it in
 * a clause (`toString(COLUMNS('…'))`, `tuple(*)`, `WHERE COLUMNS('…') = 1`)
 * changes nothing about that, so the refusal is attached to the node kind (see
 * {@link enterColumnSet}) rather than to the projection list. `COLUMNS(a, b)`
 * is absent on purpose: it names its columns, so they are checked like any other
 * reference — but only when every member parses as an identifier; a member
 * written as a string literal names nothing the walk can check, so
 * {@link enterColumnListMatcher} refuses that shape the same way. The one
 * exemption is a bare `count(*)`, resolved in
 * {@link walkFunctionArguments}, where the star is a row count and names no
 * column — and only for that call's own `arguments`, never its window
 * definition.
 */
const UNRESOLVABLE_COLUMN_SETS: ReadonlySet<string> = new Set([
  "Asterisk",
  "QualifiedAsterisk",
  "ColumnsRegexpMatcher",
  "QualifiedColumnsRegexpMatcher",
]);

/**
 * A {@link LangWatchQLQueryBlock} while the walk is still filling it in.
 *
 * Mutable, and carried on the frame rather than looked up, so that whichever
 * node learns a fact writes it to the block it is lexically inside — which is
 * the only interpretation that stays right when blocks nest.
 */
interface BlockAccumulator {
  readonly tables: LangWatchQLTableReference[];
  readonly joins: LangWatchQLJoinEdge[];
  readonly filteredColumns: Set<string>;
  readonly groupByColumns: Set<string>;
  hasGroupBy: boolean;
  isAggregated: boolean;
}

/** Where the walk currently is, and what it has learned on the way down. */
interface Frame {
  readonly clause: LangWatchQLClause;
  /** Sticky: once inside a nested query, every violation reports `subquery`. */
  readonly isInSubquery: boolean;
  readonly subqueryDepth: number;
  readonly nodeDepth: number;
  /** CTE names visible here, lowercased. Not checked against the table policy. */
  readonly ctes: ReadonlySet<string>;
  /** The `SELECT` block this node sits in. Absent above the outermost one. */
  readonly block?: BlockAccumulator;
  /**
   * Set on the children of the root `SelectWithUnionQuery` when it holds
   * exactly one `SELECT`, and cleared everywhere below.
   *
   * A `UNION` deliberately clears it. Two branches projecting the same output
   * column would put two different meanings in it — one branch's keys and the
   * other branch's plain values — and hydration works per column, so it could
   * not tell them apart.
   */
  readonly isRootSelect?: boolean;
  /**
   * Set on the frame of the one `SELECT` whose projection may call an app
   * function. Read by {@link walkProjection} and by nothing else.
   */
  readonly isOutermostSelect?: boolean;
  /**
   * Set on the frame a bare `count(*)` walks its `arguments` field in — via
   * {@link walkFunctionArguments} — and only that frame, so the one exempt
   * `Asterisk` (a row count, not a column set) passes while every other star
   * is refused. It does not reach the same call's `window_definition` or
   * `parameters`, which are walked under the frame {@link enterFunction}
   * returns instead, so `count(*) OVER (PARTITION BY COLUMNS('…'))` still
   * refuses the matcher in the window definition. {@link enterFunction} also
   * resets it `false` on every call, so it can never leak into a nested one
   * such as `count(tuple(*))`.
   */
  readonly isBareCountStarArgument?: boolean;
}

/** What a top-level `SELECT` declared about how many rows it returns. */
interface TopLevelLimit {
  /**
   * Whether it named its own `LIMIT` — the only clause that bounds a row
   * count. `OFFSET` alone does not: `SELECT … OFFSET 5` with no `LIMIT` is
   * still unbounded, so `OFFSET` is tracked separately below rather than
   * folded into this flag.
   */
  readonly hasLimit: boolean;
  /** Whether it named an `OFFSET`, so the default `LIMIT` is inserted before it, not after. */
  readonly hasOffset: boolean;
  /** The `LIMIT` row count when it is a plain non-negative integer literal, else `null`. */
  readonly staticRows: number | null;
  /** Where the `LIMIT` sits, for the refusal that names a too-high one. */
  readonly at?: SqlSourcePosition;
  /** Where the `OFFSET` sits, so an appended default `LIMIT` can be inserted before it. */
  readonly offsetAt?: SqlSourcePosition;
}

/** Everything the walk accumulates. */
interface WalkContext {
  readonly policy: ResolvedLangWatchQLPolicy;
  readonly violations: LangWatchQLViolation[];
  readonly tables: Set<string>;
  readonly parameters: Map<string, string>;
  readonly blocks: BlockAccumulator[];
  /**
   * One entry per top-level `SELECT` (a bare query, or each branch of a
   * `UNION`). Subquery limits are excluded — they bound an inner read, not the
   * response — so this is what decides the appended default `LIMIT` and the
   * `LIMIT_TOO_HIGH` refusal.
   */
  readonly topLevelLimits: TopLevelLimit[];
  /** The hydration plan, in projection order. Only admitted calls are here. */
  readonly appFunctions: LangWatchQLAppFunctionCall[];
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
  | { readonly kind: "node"; readonly clause?: LangWatchQLClause }
  | { readonly kind: "nodes"; readonly clause?: LangWatchQLClause }
  /** An `Identifier` naming a table or alias, not a column: never gate-checked. */
  | { readonly kind: "identifierRef" }
  | { readonly kind: "scalar" }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | {
      readonly kind: "refuse";
      readonly code: LangWatchQLViolationCode;
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

/**
 * The floor every violation code clears: a corrective sentence, keyed on the
 * code alone. A code with a sharper, context-derived field (`allowedFunctions`,
 * `availableViews`, `view`/`availableColumns`) still carries this — the
 * sharper field is the better answer, `hint` is what a caller falls back to
 * when it only reads one field, and what every other code has instead of a
 * sharper one.
 *
 * `Record` over the full union rather than a partial map: a code added to
 * {@link LWQL_VIOLATION_CODES} without an entry here fails the build, not a
 * customer's refusal.
 */
const DEFAULT_VIOLATION_HINTS: Record<LangWatchQLViolationCode, string> = {
  EMPTY_QUERY: "Submit a single SELECT statement.",
  PARSE_FAILED:
    "Check the SQL against standard ClickHouse SELECT syntax and try again.",
  MULTIPLE_STATEMENTS: "Submit exactly one SELECT statement per request.",
  STATEMENT_NOT_ALLOWED:
    "Rewrite the request as a single SELECT (or WITH … SELECT) statement.",
  SETTINGS_CLAUSE:
    "Remove the SETTINGS clause — result limits are applied automatically.",
  OUTPUT_CLAUSE:
    "Remove the output/format clause — this API controls the response format.",
  SCHEMA_NOT_ALLOWED:
    "Query one of the analytics views listed by GET /api/v1/query/schema instead.",
  TABLE_NOT_ALLOWED:
    "Use one of the views named in this violation's availableViews, or listed by GET /api/v1/query/schema.",
  TABLE_FUNCTION:
    "Read from one of the analytics views listed by GET /api/v1/query/schema instead of a table function.",
  FUNCTION_NOT_ALLOWED:
    "Rewrite the expression using one of the functions named in this violation's allowedFunctions.",
  LIMIT_TOO_HIGH: `Lower the LIMIT to ${LWQL_MAX_RESULT_ROWS.toLocaleString(
    "en-US",
  )} rows or fewer, and page the rest with LIMIT/OFFSET and an ORDER BY.`,
  LIMIT_REQUIRED_PER_BRANCH: `Add a LIMIT of ${LWQL_MAX_RESULT_ROWS.toLocaleString(
    "en-US",
  )} rows or fewer to every branch of the UNION.`,
  GATED_COLUMN:
    "Remove the field, or use one of the columns named in this violation's availableColumns.",
  WILDCARD_NOT_ALLOWED:
    "List the fields you need by name instead of using a wildcard.",
  NESTING_TOO_DEEP:
    "Flatten the query — reduce subquery, CTE, or expression nesting.",
  UNSUPPORTED_SYNTAX:
    "Rewrite the query as a plain read query over the analytics views.",
  APP_FUNCTION_POSITION:
    "Call the function as an aliased entry of the top-level SELECT list, and filter or group on the key column instead.",
  APP_FUNCTION_ALIAS_REQUIRED:
    "Give the call an alias, for example conversation(ConversationId) AS transcript.",
  APP_FUNCTION_ARGUMENT:
    "Match the signature listed for this function by GET /api/v1/query/schema.",
  APP_FUNCTION_GATED:
    "Remove the call, or use a key that holds the permissions this function names.",
  APP_FUNCTION_NAME_CASE:
    "Write the function name exactly as GET /api/v1/query/schema spells it.",
};

/** The sharper fields a call site can attach on top of the {@link DEFAULT_VIOLATION_HINTS} floor. */
type ViolationExtra = Partial<
  Pick<
    LangWatchQLViolation,
    "availableViews" | "view" | "availableColumns" | "maxRows"
  >
>;

function report({
  ctx,
  frame,
  code,
  message,
  node,
  extra,
}: {
  ctx: WalkContext;
  frame: Frame;
  code: LangWatchQLViolationCode;
  message: string;
  node?: SqlAstNode;
  extra?: ViolationExtra;
}): void {
  if (ctx.violations.length >= MAX_VIOLATIONS) return;
  const at = node ? positionOf(node) : undefined;
  ctx.violations.push({
    code,
    clause: frame.isInSubquery ? "subquery" : frame.clause,
    message,
    hint: DEFAULT_VIOLATION_HINTS[code],
    ...(at ? { at } : {}),
    // The allowlist rides on exactly the one code that means "you called
    // something off it", derived from the code here rather than passed in — so
    // it cannot be attached to another code, nor forgotten on this one.
    ...(code === "FUNCTION_NOT_ALLOWED"
      ? { allowedFunctions: LWQL_ALLOWED_FUNCTION_NAMES }
      : {}),
    ...extra,
  });
}

const UNSUPPORTED_SYNTAX_MESSAGE =
  "This query uses SQL this API does not support. Rewrite it as a plain read query over the analytics views.";

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

/**
 * `from` first, everything else in the order the parser wrote it.
 *
 * The parser's own field order is `select` before `from` — a `SelectQuery`
 * node lists its projection first — so walking fields as written would check
 * a column reference in the projection before the block has recorded which
 * table it was read from. A gated-column refusal wants that table (to name
 * its view and columns; see `resolveGatedColumnView`), so `from` has to
 * be walked, and its table recorded on the block, before any other field of
 * the same `SELECT` is. `Array.prototype.sort` is stable, so this reorders
 * nothing else.
 */
function fieldsInWalkOrder(node: SqlAstNode): [string, unknown][] {
  return Object.entries(node).sort(([left], [right]) => {
    if (left === "from") return right === "from" ? 0 : -1;
    if (right === "from") return 1;
    return 0;
  });
}

/** Every field the node carries, each against the rule that names it — or none. */
function walkFields({
  rule,
  node,
  frame,
  ctx,
}: NodeArgs & { rule: NodeRule }): void {
  for (const [field, value] of fieldsInWalkOrder(node)) {
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

/**
 * Which view a gated reference's columns should be listed against, when the
 * walk can tell.
 *
 * The qualifier is the segment just before the gated one — `t` in `t.body`,
 * `traces` in `traces.body.null` — and resolves through the block's
 * alias/table list. With no qualifier (`body`, `body.null`), or one that names
 * nothing in scope, the view resolves only when the block reads exactly one
 * table — with two tables in scope the name is ambiguous between them, and
 * guessing would risk naming the wrong view's columns.
 *
 * The columns listed are the ones the caller may actually use: the gated
 * names are subtracted, so a refusal never echoes a withheld field back as a
 * suggestion.
 */
function resolveGatedColumnView({
  segments,
  gatedIndex,
  frame,
  ctx,
}: {
  segments: readonly string[];
  gatedIndex: number;
  frame: Frame;
  ctx: WalkContext;
}): ViolationExtra {
  const tables = frame.block?.tables ?? [];
  const qualifier =
    gatedIndex > 0 ? segments[gatedIndex - 1]?.trim().toLowerCase() : undefined;
  const byQualifier = qualifier
    ? tables.find(
        (entry) =>
          entry.alias === qualifier ||
          entry.table.split(".").at(-1) === qualifier,
      )
    : undefined;
  const matched = byQualifier ?? (tables.length === 1 ? tables[0] : undefined);
  if (!matched) return {};
  const availableColumns = ctx.policy.viewColumns
    .get(matched.table)
    ?.filter(
      (column) => !ctx.policy.gatedColumns.has(column.trim().toLowerCase()),
    );
  return {
    view: matched.table,
    ...(availableColumns ? { availableColumns } : {}),
  };
}

/**
 * The columns a caller may not reference, matched against *every* segment of a
 * dotted name.
 *
 * A qualified path can reach a gated field through a segment that is not the
 * last one: `body.null` and `traces.body.null` both read the withheld `body`
 * and then a subfield of it, so matching only the leaf would wave them through.
 * The segments come from `name_parts` when the parse split them out, and from
 * splitting `name` on `.` otherwise.
 */
function gateColumnReference({
  name,
  nameParts,
  ctx,
  frame,
  node,
}: {
  name: string;
  nameParts?: readonly string[];
  ctx: WalkContext;
  frame: Frame;
  node: SqlAstNode;
}): void {
  const segments = nameParts ?? name.split(".");
  const gatedIndex = segments.findIndex((segment) =>
    ctx.policy.gatedColumns.has(segment.trim().toLowerCase()),
  );
  if (gatedIndex === -1) return;
  report({
    ctx,
    frame,
    code: "GATED_COLUMN",
    message: `The field "${echoIdentifier(name)}" is not available to you. Remove it from the query.`,
    node,
    extra: resolveGatedColumnView({ segments, gatedIndex, frame, ctx }),
  });
}

/**
 * A projection list, walked like any other node list except for one
 * interception: a direct element that calls an app function.
 *
 * That position is the only one an app function is allowed in, so it is
 * recognised here rather than by the ordinary function walk — which is what
 * lets {@link enterFunction} refuse the name unconditionally wherever else it
 * turns up. Everything else, wildcards included, goes through the same
 * `walkChildNode` every other list uses.
 */
function walkProjection({ value, node, frame, ctx }: FieldArgs): void {
  if (!Array.isArray(value)) {
    refuseUnrecognised({ node, frame, ctx });
    return;
  }
  const projection: Frame = { ...frame, clause: "projection" };
  for (const element of value) {
    const appFunction = isNode(element)
      ? directAppFunctionCall(element)
      : undefined;
    if (appFunction) {
      walkAppFunctionCall({
        node: element,
        definition: appFunction,
        frame: projection,
        ctx,
      });
      continue;
    }
    walkChildNode({ value: element, node, frame: projection, ctx });
  }
}

/** The catalog entry a direct projection element calls, or `undefined`. */
function directAppFunctionCall(
  element: SqlAstNode,
): LangWatchQLAppFunctionDefinition | undefined {
  if (element.type !== "Function") return undefined;
  if (typeof element.name !== "string") return undefined;
  return lwqlAppFunction(element.name);
}

// ---------------------------------------------------------------------------
// App functions
//
// The one rule here that is about correctness rather than policy: an app
// function may appear only as a direct element of the outermost projection.
// ClickHouse holds each one as a projection UDF over its key, so it will
// happily evaluate `WHERE conversation(ConversationId) = 'x'` and compare the
// raw conversation id, answering with the wrong rows and no error at all.
// Measured on 25.8, in `WHERE`, `GROUP BY`, `ORDER BY`, a join condition, a
// CTE, a subquery and inside `arrayMap`. Nothing downstream can detect it, so
// the refusal has to happen here.
// ---------------------------------------------------------------------------

const APP_FUNCTION_POSITION_PLACE =
  "can only be used in the top-level SELECT list of a single SELECT statement, with an alias.";

/**
 * What to do instead, which depends on what the function returns.
 *
 * An extraction function hands back a value the caller can project and then
 * filter, group or sort on. An eval function does not: its answer is decided
 * after the query has run, so there is no column in the same statement to put
 * in a WHERE. Telling the caller to "filter on a plain column instead" sends
 * them looking for a column that cannot exist, so they are pointed at the two
 * things that do work.
 */
const APP_FUNCTION_POSITION_EXTRACTION_ADVICE =
  "Project it there and filter, group or sort on a plain column instead.";

const APP_FUNCTION_POSITION_EVAL_ADVICE =
  "Its answer is decided after the query runs, so there is no column in this statement to filter on. " +
  "To keep only the matches, filter the rows it returns, " +
  "or run the statement as an Instant Eval and read `instant-eval results <run-id> --matched`.";

function appFunctionPositionMessage(name: string): string {
  const advice = isEvalFunctionName(name)
    ? APP_FUNCTION_POSITION_EVAL_ADVICE
    : APP_FUNCTION_POSITION_EXTRACTION_ADVICE;
  return `The function "${echoIdentifier(name)}" ${APP_FUNCTION_POSITION_PLACE} ${advice}`;
}

function reportAppFunctionPosition({
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
    code: "APP_FUNCTION_POSITION",
    message: appFunctionPositionMessage(name),
    node,
  });
}

/**
 * Whether the call was written in ClickHouse's parametric form,
 * `f(params)(args)`: the parser keeps the first list under `parameters` and
 * the second under `arguments`.
 */
function isParametricCall(node: SqlAstNode): boolean {
  return Array.isArray(node.parameters);
}

/**
 * An app function is a lambda with one argument list. The parametric form
 * would pass validation on its `arguments` alone and then reach ClickHouse,
 * which has no parametric UDF of that name to run, so it is refused here where
 * the refusal can name the function.
 */
function reportParametricAppFunctionCall({
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
    code: "APP_FUNCTION_ARGUMENT",
    message: `The function "${echoIdentifier(name)}" takes one list of arguments, not a parameter list followed by one: write it as ${name}(...) rather than ${name}(...)(...).`,
    node,
  });
}

/**
 * One app-function call in the projection: every rule that governs it, then the
 * plan entry.
 *
 * Reports and keeps going wherever it can, like the rest of the walk, so a
 * caller who wrote a call in the wrong place *and* referenced a restricted
 * field hears about both in one round trip. The plan entry is recorded only
 * when every rule passed — a refused query has no plan, and a half-recorded one
 * would be a plan for a statement that never runs.
 */
function walkAppFunctionCall({
  node,
  definition,
  frame,
  ctx,
}: {
  node: SqlAstNode;
  definition: LangWatchQLAppFunctionDefinition;
  frame: Frame;
  ctx: WalkContext;
}): void {
  if (isParametricCall(node)) {
    reportParametricAppFunctionCall({
      name: definition.name,
      node,
      frame,
      ctx,
    });
    return;
  }

  const args = Array.isArray(node.arguments) ? node.arguments : [];
  const source = walkAppFunctionArguments({
    node,
    definition,
    args,
    frame,
    ctx,
  });

  if (frame.isOutermostSelect !== true) {
    reportAppFunctionPosition({ name: definition.name, node, frame, ctx });
    return;
  }

  const column = admitAppFunctionCall({ node, definition, frame, ctx });
  if (column === null) return;

  const options = readAppFunctionOptions({
    definition,
    args,
    node,
    frame,
    ctx,
  });
  if (options === null) return;

  // A nested call that was itself refused leaves no plan: the statement is
  // already rejected, and half a plan is a plan for a query that never runs.
  if (source !== null && source.source === null) return;

  ctx.appFunctions.push({
    column,
    function: definition.name,
    options,
    ...(source?.source ? { source: source.source } : {}),
  });
}

/**
 * Walks a call's arguments, and reads the nested extraction out of the first
 * one where there is one.
 *
 * The arguments are walked whatever else fails, so a gated column or a refused
 * function inside the key is reported too. The frame drops `isOutermostSelect`,
 * which is what refuses a nested app function everywhere except the one place
 * nesting is allowed: the key of an eval function, read here before the
 * ordinary walk can get to it and refuse it.
 */
function walkAppFunctionArguments({
  node,
  definition,
  args,
  frame,
  ctx,
}: {
  node: SqlAstNode;
  definition: LangWatchQLAppFunctionDefinition;
  args: readonly unknown[];
  frame: Frame;
  ctx: WalkContext;
}): { readonly source: LangWatchQLAppFunctionSource | null } | null {
  const inside: Frame = { ...frame, isOutermostSelect: false };
  const source =
    definition.kind === "eval"
      ? readNestedSource({ key: args[0], frame: inside, ctx })
      : null;
  for (const [index, argument] of args.entries()) {
    if (source !== null && index === 0) continue;
    walkChildNode({ value: argument, node, frame: inside, ctx });
  }
  return source;
}

/**
 * Whether a nested call has the shape a source may take at all: one argument
 * list, and an extraction rather than another eval. Reports the refusal when
 * it does not.
 */
function isNestedCallAdmitted({
  nested,
  key,
  frame,
  ctx,
}: {
  nested: LangWatchQLAppFunctionDefinition;
  key: SqlAstNode;
  frame: Frame;
  ctx: WalkContext;
}): boolean {
  if (isParametricCall(key)) {
    reportParametricAppFunctionCall({
      name: nested.name,
      node: key,
      frame,
      ctx,
    });
    return false;
  }
  if (nested.kind !== "extraction") {
    reportAppFunctionPosition({ name: nested.name, node: key, frame, ctx });
    return false;
  }
  return true;
}

/**
 * The extraction call an eval function reads its text from, when it has one.
 *
 * `null` means the key is not an app-function call at all, so the ordinary walk
 * should handle it — a column, a `concat`, anything the policy already admits.
 * A returned object means this module has dealt with the key, whether or not it
 * admitted it, so the caller must not walk it a second time and report
 * everything twice.
 *
 * Only one level, and only an extraction function. Deeper nesting has nowhere
 * to run: hydration reads one key out of the column and computes one value from
 * it, so a second extraction inside the first would have no key of its own. An
 * eval inside an eval is worse than unsupported — it would ask the classifier
 * about a probability.
 */
function readNestedSource({
  key,
  frame,
  ctx,
}: {
  key: unknown;
  frame: Frame;
  ctx: WalkContext;
}): { readonly source: LangWatchQLAppFunctionSource | null } | null {
  if (!isNode(key) || key.type !== "Function") return null;
  if (typeof key.name !== "string") return null;
  const nested = lwqlAppFunction(key.name);
  if (!nested) return null;
  if (!isNestedCallAdmitted({ nested, key, frame, ctx })) {
    return { source: null };
  }

  // Its own arguments, under a frame that is still not the outermost select,
  // so anything nested inside *it* is refused by the ordinary function walk.
  const args = Array.isArray(key.arguments) ? key.arguments : [];
  for (const argument of args) {
    walkChildNode({ value: argument, node: key, frame, ctx });
  }

  if (key.name.trim() !== nested.name) {
    report({
      ctx,
      frame,
      code: "APP_FUNCTION_NAME_CASE",
      message: `Write "${echoIdentifier(key.name.trim())}" as "${nested.name}": the query runs exactly as written, and the database matches this function's name letter for letter.`,
      node: key,
    });
    return { source: null };
  }

  if (!holdsAppFunctionGates({ definition: nested, ctx })) {
    report({
      ctx,
      frame,
      code: "APP_FUNCTION_GATED",
      message: `The function "${echoIdentifier(nested.name)}" is not available to you. It needs the ${nested.gates.join(" and ")} permission; ask an administrator for it, or remove the call.`,
      node: key,
    });
    return { source: null };
  }

  const options = readAppFunctionOptions({
    definition: nested,
    args,
    node: key,
    frame,
    ctx,
  });
  if (options === null) return { source: null };
  return { source: { function: nested.name, options } };
}

/**
 * The three rules a call in the right place still has to pass, and the output
 * column it earns by passing them.
 *
 * `null` means one of them failed and was reported. Spelling comes first: the
 * query reaches the database verbatim and ClickHouse resolves a SQL UDF by its
 * exact name, so admitting a mis-cased call would build a plan for a statement
 * that cannot run.
 */
function admitAppFunctionCall({
  node,
  definition,
  frame,
  ctx,
}: {
  node: SqlAstNode;
  definition: LangWatchQLAppFunctionDefinition;
  frame: Frame;
  ctx: WalkContext;
}): string | null {
  const refuse = (code: LangWatchQLViolationCode, message: string): null => {
    report({ ctx, frame, code, message, node });
    return null;
  };

  const written = typeof node.name === "string" ? node.name.trim() : "";
  if (written !== definition.name) {
    return refuse(
      "APP_FUNCTION_NAME_CASE",
      `Write "${echoIdentifier(written)}" as "${definition.name}": the query runs exactly as written, and the database matches this function's name letter for letter.`,
    );
  }

  const column = aliasOf(node);
  if (column === null) {
    return refuse(
      "APP_FUNCTION_ALIAS_REQUIRED",
      `The function "${echoIdentifier(definition.name)}" needs an alias: write it as "${lwqlAppFunctionSignature(definition)} AS my_column".`,
    );
  }

  if (!holdsAppFunctionGates({ definition, ctx })) {
    return refuse(
      "APP_FUNCTION_GATED",
      `The function "${echoIdentifier(definition.name)}" is not available to you. It needs the ${definition.gates.join(" and ")} permission; ask an administrator for it, or remove the call.`,
    );
  }

  if (definition.kind === "eval" && !ctx.policy.instantEvalsEnabled) {
    return refuse(
      "APP_FUNCTION_GATED",
      `The function "${echoIdentifier(definition.name)}" is not available to you. A judgement is charged to one project, so it needs Instant Evals switched on for a key that reads a single project; ask an administrator to enable them, use a project key, or remove the call.`,
    );
  }

  return column;
}

/** The alias a projection element was written with, or `null`. */
function aliasOf(node: SqlAstNode): string | null {
  const { alias } = node;
  if (typeof alias !== "string") return null;
  const trimmed = alias.trim();
  return trimmed === "" ? null : trimmed;
}

/** Whether the caller holds every permission this function requires. */
function holdsAppFunctionGates({
  definition,
  ctx,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  ctx: WalkContext;
}): boolean {
  return definition.gates.every((gate) => ctx.policy.heldPermissions.has(gate));
}

/**
 * The literal option values, or `null` when the arguments do not match the
 * signature.
 *
 * The rules themselves live in `./appFunctionArguments.ts`, which is pure and
 * has no opinion about how a refusal is reported; this is the half that reports
 * one. Arity is exact and there is one signature per function, because a
 * ClickHouse SQL UDF is a lambda with a fixed parameter list and calling one
 * with any other count is `BAD_ARGUMENTS` — so "which overload did they mean"
 * is never a question the validator has to answer.
 */
function readAppFunctionOptions({
  definition,
  args,
  node,
  frame,
  ctx,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  args: readonly unknown[];
  node: SqlAstNode;
  frame: Frame;
  ctx: WalkContext;
}): LangWatchQLAppFunctionOption[] | null {
  const outcome = readAppFunctionArguments({ definition, args });
  if (outcome.ok) return outcome.options;
  report({
    ctx,
    frame,
    code: "APP_FUNCTION_ARGUMENT",
    message: outcome.message,
    node,
  });
  return null;
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
// `enter` hooks — what a node decides before its fields are walked: the frame
// its children see, whether it is refused outright, and what it contributes to
// the block it sits in.
// ---------------------------------------------------------------------------

/**
 * Opens this SELECT's block and brings its CTE names into scope, before
 * anything else is walked.
 */
/**
 * Marks the one `SELECT` whose projection may call an app function.
 *
 * Only when the root union holds exactly one of them: see
 * {@link Frame.isRootSelect} for why a `UNION` disqualifies both branches.
 * Returning a frame with `isRootSelect` cleared is what stops anything nested
 * inside from re-qualifying itself.
 */
function enterSelectWithUnionQuery({ node, frame }: NodeArgs): Frame {
  const isRoot =
    frame.clause === "statement" &&
    frame.subqueryDepth === 0 &&
    frame.block === undefined;
  const single = Array.isArray(node.selects) && node.selects.length === 1;
  return { ...frame, isRootSelect: isRoot && single };
}

/**
 * The row count a `LIMIT` names, when it is a plain non-negative integer
 * literal — the only shape whose value is knowable before execution.
 *
 * A `LIMIT` that is an expression or a bound parameter reads back `null`: its
 * value is decided at run time, so it is neither refused as too high nor
 * counted as absent. The byte ceiling still bounds what such a query returns.
 */
function readStaticLimitRows(limit: unknown): number | null {
  if (!isNode(limit) || limit.type !== "Literal") return null;
  const { value } = limit;
  const rows =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(rows) && rows >= 0 ? rows : null;
}

/**
 * Records how a top-level `SELECT` bounds its own result, so the entry point can
 * decide the appended default `LIMIT` and refuse a too-high one. A `SELECT`
 * inside a subquery bounds an inner read, not the response, and is skipped.
 */
function recordTopLevelLimit({ node, frame, ctx }: NodeArgs): void {
  if (frame.isInSubquery) return;
  const limitNode = node.limit;
  const offsetNode = node.offset;
  const at = isNode(limitNode) ? positionOf(limitNode) : undefined;
  const offsetAt = isNode(offsetNode) ? positionOf(offsetNode) : undefined;
  ctx.topLevelLimits.push({
    hasLimit: limitNode !== undefined,
    hasOffset: offsetNode !== undefined,
    staticRows: readStaticLimitRows(limitNode),
    ...(at ? { at } : {}),
    ...(offsetAt ? { offsetAt } : {}),
  });
}

function enterSelectQuery({ node, frame, ctx }: NodeArgs): Frame {
  recordTopLevelLimit({ node, frame, ctx });
  const isOutermostSelect = frame.isRootSelect === true;
  const block: BlockAccumulator = {
    tables: [],
    joins: [],
    filteredColumns: new Set<string>(),
    groupByColumns: new Set<string>(),
    hasGroupBy:
      (Array.isArray(node.group_by) && node.group_by.length > 0) ||
      node.group_by_all === true,
    isAggregated: false,
  };
  ctx.blocks.push(block);

  // `isRootSelect` is spent here: it marked this SELECT as the outermost one,
  // and clearing it is what stops a nested SELECT — a subquery, a CTE's body —
  // from claiming the same standing.
  const here = { ...frame, block, isOutermostSelect, isRootSelect: false };
  if (!Array.isArray(node.with)) return here;
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
  return { ...here, ctes };
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
      message:
        "Name the view directly — a table cannot be chosen by a bound parameter.",
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
        "Server metadata is not readable through this API. Query the analytics views instead.",
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
      message: `The view "${echoIdentifier(written)}" is not available to you. Use one of the views from the schema endpoint.`,
      node,
      extra: { availableViews: ctx.policy.availableViews },
    });
    return null;
  }
  ctx.tables.add(qualified);
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
 * recording it would tell a diagnostic that two views line up on a column
 * when they may not.
 */
function collectJoinEdges({
  node,
  block,
}: {
  node: SqlAstNode;
  block: BlockAccumulator;
}): void {
  collectUsingEdges({ using: node.using, block });
  collectOnEdges({ on: node.on, block });
}

/**
 * Records the pairs a `USING (col)` clause implies.
 *
 * `USING` matches the same name on both sides, which is exactly the pair an
 * `ON` would have spelled out.
 */
function collectUsingEdges({
  using,
  block,
}: {
  using: unknown;
  block: BlockAccumulator;
}): void {
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
function collectOnEdges({
  on,
  block,
}: {
  on: unknown;
  block: BlockAccumulator;
}): void {
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
 * not a key two views line up on, and recording half of one would claim a
 * match that was never written.
 */
function readEqualityEdge(
  node: unknown,
): { left: string; right: string } | null {
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
  // Reset on every call so an outer isBareCountStarArgument can never leak into this
  // one's fields. The exemption itself is set back on, narrowly, only for the
  // `arguments` field by {@link walkFunctionArguments} — never here, and never
  // for `window_definition` or `parameters`.
  const childFrame: Frame = { ...frame, isBareCountStarArgument: false };
  // Reaching `enterFunction` at all means this call is not a direct element of
  // the outermost projection: `walkProjection` intercepts those before the
  // ordinary walk sees them. So an app-function name here is always a position
  // violation, and saying so is what keeps the refusal actionable — the
  // allowlist check below would otherwise report a catalogued function as
  // "not allowed", sending the caller to look for a name the schema lists.
  const appFunction = lwqlAppFunction(name);
  if (appFunction) {
    reportAppFunctionPosition({ name: appFunction.name, node, frame, ctx });
    return childFrame;
  }
  if (!isAllowedLangWatchQLFunction(name)) {
    reportRefusedFunction({ name, node, frame, ctx });
    return childFrame;
  }
  if (
    childFrame.block &&
    isLangWatchQLAggregateFunction(name) &&
    !isWindowCall(node)
  ) {
    childFrame.block.isAggregated = true;
  }
  return childFrame;
}

/**
 * A `Function` node's `arguments` field, walked with the bare-`count(*)`
 * exemption scoped to exactly this field.
 *
 * The exemption cannot live on the frame {@link enterFunction} returns for the
 * whole node, because that same frame also reaches `window_definition` and
 * `parameters` — and `count(*) OVER (PARTITION BY COLUMNS('…'))` must still
 * refuse the matcher in the window definition. Computing it here, from the
 * `Function` node passed in as `node`, keeps it off every other field.
 */
function walkFunctionArguments({ value, node, frame, ctx }: FieldArgs): void {
  walkChildNodes({
    value,
    node,
    frame: { ...frame, isBareCountStarArgument: isBareCountStar(node) },
    ctx,
  });
}

/**
 * Whether this call is a bare `count(*)`: the one place a star is a row count
 * rather than a column set, and so stays exempt from {@link enterColumnSet}.
 *
 * `count(DISTINCT *)` is deliberately excluded — the parser gives it a distinct
 * function name (`countDistinct`) — as is `count(t.*)` (a `QualifiedAsterisk`),
 * `count(* EXCEPT (…))` (an `Asterisk` carrying transformers), `count(*, x)`
 * (two arguments) and any other aggregate over a star.
 */
function isBareCountStar(node: SqlAstNode): boolean {
  const { name, arguments: args } = node;
  if (typeof name !== "string" || name.toLowerCase() !== "count") return false;
  if (!Array.isArray(args) || args.length !== 1) return false;
  const arg = args[0];
  return (
    isNode(arg) &&
    arg.type === "Asterisk" &&
    arg.transformers === undefined &&
    arg.expression === undefined
  );
}

const WILDCARD_NOT_ALLOWED_MESSAGE =
  "List the fields you need by name — a wildcard cannot be used here, because some fields are not available to you.";

/**
 * Refuses an unresolvable column set — a wildcard or a regexp `COLUMNS()`
 * matcher — for a caller with restricted fields, and returns `null` so the
 * subtree is not walked.
 *
 * Attached to each of the four {@link UNRESOLVABLE_COLUMN_SETS} node kinds, so
 * the refusal holds in every position rather than only the projection. With no
 * restricted fields there is nothing to withhold and the node is walked
 * normally; the sole exemption is the `Asterisk` of a bare `count(*)`, which
 * {@link walkFunctionArguments} marks on the frame.
 */
function enterColumnSet({ node, frame, ctx }: NodeArgs): Frame | null {
  if (!UNRESOLVABLE_COLUMN_SETS.has(node.type)) return frame;
  if (ctx.policy.gatedColumns.size === 0) return frame;
  if (frame.isBareCountStarArgument === true) return frame;
  report({
    ctx,
    frame,
    code: "WILDCARD_NOT_ALLOWED",
    message: WILDCARD_NOT_ALLOWED_MESSAGE,
    node,
  });
  return null;
}

/**
 * A `COLUMNS(a, b)` / `t.COLUMNS(a, b)` list matcher: walked normally when
 * every member is an identifier, so each is gated like any other reference;
 * refused like a wildcard when any member is not.
 *
 * The parser accepts `COLUMNS('a', 'b')` and emits the members as literals,
 * which {@link gateColumnReference} never sees. ClickHouse itself rejects that
 * spelling today, but the gate does not lean on that: a member the walk cannot
 * check is treated as a column set it cannot enumerate.
 */
function enterColumnListMatcher({ node, frame, ctx }: NodeArgs): Frame | null {
  if (ctx.policy.gatedColumns.size === 0) return frame;
  const members = node.columns;
  const isEveryMemberNamed =
    Array.isArray(members) &&
    members.every((member) => isNode(member) && member.type === "Identifier");
  if (isEveryMemberNamed) return frame;
  report({
    ctx,
    frame,
    code: "WILDCARD_NOT_ALLOWED",
    message: WILDCARD_NOT_ALLOWED_MESSAGE,
    node,
  });
  return null;
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
    message: `The function "${echoIdentifier(name)}" cannot be used here. Rewrite the expression using one of the supported functions, listed under \`functions\` on GET /api/v1/query/schema and carried on this violation as \`allowedFunctions\`.`,
    node,
    // The complete list travels with the refusal — see {@link report}, which
    // attaches it structurally to this code so the caller (usually an agent
    // with no UI) recovers without a second round trip to the schema.
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
  const appFunction = lwqlAppFunction(value);
  if (appFunction) {
    reportAppFunctionPosition({ name: appFunction.name, node, frame, ctx });
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
  gateColumnReference({ name, nameParts, ctx, frame, node });
  noteColumnPosition({ name, frame });
  return frame;
}

/**
 * Records a column named in a filter or grouping position on the block it sits
 * in.
 *
 * The leaf segment only: what a diagnostic asks is "was this view's time
 * column filtered", and `t.OccurredAt`, `OccurredAt` and
 * `analytics.traces.OccurredAt` are all the same answer to it.
 */
function noteColumnPosition({
  name,
  frame,
}: {
  name: string;
  frame: Frame;
}): void {
  const { block, clause } = frame;
  if (!block) return;
  if (clause !== "filter" && clause !== "group") return;
  const leaf = name.split(".").at(-1)?.trim().toLowerCase();
  if (!leaf) return;
  if (clause === "filter") block.filteredColumns.add(leaf);
  else block.groupByColumns.add(leaf);
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
 * LangWatchQL query may contain. Nothing outside it is reachable.
 */
const NODE_RULES: Readonly<Record<string, NodeRule>> = {
  // ---- query structure ----
  SelectWithUnionQuery: {
    enter: enterSelectWithUnionQuery,
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
          "Table functions cannot be used here. Read from the analytics views listed by the schema endpoint.",
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
      arguments: { kind: "custom", walk: walkFunctionArguments },
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
    enter: enterColumnSet,
    fields: {
      transformers: { kind: "nodes" },
      expression: { kind: "node" },
    },
  },
  QualifiedAsterisk: {
    enter: enterColumnSet,
    fields: {
      qualifier: { kind: "identifierRef" },
      columns: { kind: "nodes" },
      transformers: { kind: "nodes" },
    },
  },
  ColumnsRegexpMatcher: {
    enter: enterColumnSet,
    fields: { pattern: SCALAR, transformers: { kind: "nodes" } },
  },
  ColumnsListMatcher: {
    enter: enterColumnListMatcher,
    fields: { columns: { kind: "nodes" }, transformers: { kind: "nodes" } },
  },
  QualifiedColumnsRegexpMatcher: {
    enter: enterColumnSet,
    fields: {
      pattern: SCALAR,
      qualifier: { kind: "identifierRef" },
      transformers: { kind: "node" },
    },
  },
  QualifiedColumnsListMatcher: {
    enter: enterColumnListMatcher,
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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ValidateLangWatchQLInput extends LangWatchQLPolicy {
  /** The SQL exactly as the caller submitted it. Never rewritten. */
  readonly sql: string;
  /**
   * The front end. Defaults to the shipped ClickHouse parser; injected only by
   * tests that need to drive the walk with a tree the grammar cannot produce.
   */
  readonly parser?: LangWatchQLParser;
}

/**
 * Decides whether a submitted query may be executed against the LangWatchQL
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
 * const result = validateLangWatchQL({
 *   sql: "SELECT count() FROM traces",
 *   allowedTables: ["analytics.traces"],
 *   gatedColumns: ["body"],
 *   defaultDatabase: "analytics",
 * });
 * if (!result.ok) throw lwqlValidationError(result);
 * ```
 */
export function validateLangWatchQL({
  sql,
  parser = clickHouseSqlParser,
  ...policy
}: ValidateLangWatchQLInput): LangWatchQLValidation {
  const screened = screenSubmission(parser, sql);
  if ("ok" in screened) return screened;

  const ctx = createWalkContext(resolveLangWatchQLPolicy(policy));
  walkNode(screened.statement, ROOT_FRAME, ctx);
  reportTooHighLimits(ctx);
  reportMissingBranchLimits(ctx);

  if (ctx.violations.length > 0)
    return { ok: false, violations: ctx.violations };

  // A single top-level SELECT is unbounded — and gets the default appended —
  // when it names no LIMIT of its own. OFFSET alone does not bound it: `SELECT
  // … OFFSET 5` with no LIMIT still returns every row from 5 on, so it is
  // still unbounded here, and the default LIMIT is inserted before that
  // OFFSET rather than after (ClickHouse requires `LIMIT n OFFSET m` order).
  // A UNION (more than one top-level branch) is never appended-to here: each
  // branch runs and returns independently, so `reportMissingBranchLimits`
  // above already refused any statement where a branch lacks its own LIMIT,
  // and every accepted UNION is bounded branch-by-branch already.
  const [singleBranch] =
    ctx.topLevelLimits.length === 1 ? ctx.topLevelLimits : [];
  const appendRowLimit = singleBranch !== undefined && !singleBranch.hasLimit;

  return {
    ok: true,
    tables: [...ctx.tables],
    parameters: [...ctx.parameters].map(([name, type]) => ({ name, type })),
    blocks: ctx.blocks.map((block) => ({
      tables: [...block.tables],
      joins: [...block.joins],
      filteredColumns: [...block.filteredColumns],
      groupByColumns: [...block.groupByColumns],
      hasGroupBy: block.hasGroupBy,
      isAggregated: block.isAggregated,
    })),
    appendRowLimit,
    ...(appendRowLimit && singleBranch?.hasOffset && singleBranch.offsetAt
      ? { appendRowLimitBeforeOffset: singleBranch.offsetAt }
      : {}),
    appFunctions: [...ctx.appFunctions],
  };
}

/**
 * Refuses a statement whose own top-level `LIMIT` asks for more than the row
 * cap. A dynamic `LIMIT` (an expression or a bound parameter) is not refused —
 * its value is not knowable here, and the byte ceiling still bounds the result.
 */
function reportTooHighLimits(ctx: WalkContext): void {
  for (const limit of ctx.topLevelLimits) {
    if (ctx.violations.length >= MAX_VIOLATIONS) return;
    if (limit.staticRows === null || limit.staticRows <= LWQL_MAX_RESULT_ROWS)
      continue;
    ctx.violations.push({
      code: "LIMIT_TOO_HIGH",
      clause: "limit",
      message:
        `The LIMIT of ${limit.staticRows.toLocaleString("en-US")} rows is above the maximum of ` +
        `${LWQL_MAX_RESULT_ROWS.toLocaleString("en-US")} rows this API returns per request. ` +
        `Lower it and page the rest with LIMIT/OFFSET and an ORDER BY.`,
      hint: DEFAULT_VIOLATION_HINTS.LIMIT_TOO_HIGH,
      maxRows: LWQL_MAX_RESULT_ROWS,
      ...(limit.at ? { at: limit.at } : {}),
    });
  }
}

/**
 * Refuses a `UNION` (more than one top-level branch) where any branch names no
 * `LIMIT` of its own.
 *
 * Each branch of a `UNION` runs and returns independently — the default
 * `LIMIT` this API appends to an unbounded single `SELECT` cannot bound one
 * branch of many without bounding all of them, and rewriting every branch's
 * text from here would mean reasoning about each branch's own trailing
 * `OFFSET` with no printer to verify the result stays valid SQL. Refusing and
 * naming the gap is the safe alternative: the caller adds a `LIMIT` to the
 * branch itself. A single `SELECT` (no `UNION`) is unaffected — that case is
 * still bounded by the appended default.
 */
function reportMissingBranchLimits(ctx: WalkContext): void {
  if (ctx.topLevelLimits.length <= 1) return;
  for (const limit of ctx.topLevelLimits) {
    if (ctx.violations.length >= MAX_VIOLATIONS) return;
    if (limit.hasLimit) continue;
    ctx.violations.push({
      code: "LIMIT_REQUIRED_PER_BRANCH",
      clause: "limit",
      message:
        "This UNION has a branch with no LIMIT of its own. Each branch runs and " +
        `returns independently, so every branch needs its own LIMIT of ${LWQL_MAX_RESULT_ROWS.toLocaleString(
          "en-US",
        )} rows or fewer.`,
      hint: DEFAULT_VIOLATION_HINTS.LIMIT_REQUIRED_PER_BRANCH,
      maxRows: LWQL_MAX_RESULT_ROWS,
      ...(limit.at ? { at: limit.at } : {}),
    });
  }
}

const NO_CTES: ReadonlySet<string> = new Set<string>();

const ROOT_FRAME: Frame = {
  clause: "statement",
  isInSubquery: false,
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
  code: LangWatchQLViolationCode;
  message: string;
  at?: SqlSourcePosition;
}): RejectedLangWatchQL {
  return {
    ok: false,
    violations: [
      {
        code,
        clause: "statement",
        message,
        hint: DEFAULT_VIOLATION_HINTS[code],
        ...(at ? { at } : {}),
      },
    ],
  };
}

/**
 * Everything decided before the walk: that the text parses, that it is exactly
 * one statement, and that the statement is a read query.
 *
 * Returns the statement to walk, or the rejection that replaces it.
 */
function screenSubmission(
  parser: LangWatchQLParser,
  sql: string,
): { statement: SqlAstNode } | RejectedLangWatchQL {
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
  parser: LangWatchQLParser,
  sql: string,
): ReturnType<LangWatchQLParser["parse"]> {
  try {
    return parser.parse(sql);
  } catch {
    return { ok: false };
  }
}

function createWalkContext(policy: ResolvedLangWatchQLPolicy): WalkContext {
  return {
    policy,
    violations: [],
    tables: new Set<string>(),
    parameters: new Map<string, string>(),
    blocks: [],
    topLevelLimits: [],
    appFunctions: [],
  };
}
