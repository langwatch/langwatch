/**
 * LangWatchQL analytics SQL — the vocabulary the default-deny walk is written in.
 *
 * What an accepted query reports, what a refused one reports, and the frame and
 * accumulator types the walk carries down the tree. Types and constants only:
 * the walk itself is `./langwatch-ql-query-walk.rules`, and the entry point
 * that composes a parser with it is
 * `../services/langwatch-ql-validation.service.ts`.
 *
 * @see specs/analytics/lwql-api.feature
 */
import type { SqlAstNode } from "./langwatch-ql-parser.rules";
import type { ResolvedLangWatchQLPolicy } from "./langwatch-ql-policy.rules";
import type {
  LangWatchQLClause,
  LangWatchQLViolation,
  LangWatchQLViolationCode,
} from "./langwatch-ql-violations.rules";

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
 * Resolving a side to a dataset is the reader's job, and
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
   * Recorded because "this query has no predicate on the dataset's partitioning
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
export const METADATA_FIELDS: readonly string[] = [
  "type",
  "location",
  "parent",
  "leadingComments",
  "trailingComments",
];

/**
 * Column-set constructs whose members the walk cannot enumerate.
 *
 * Refused in a projection when the caller has restricted fields, because there
 * is no way to prove the expansion excludes them without the table's columns —
 * which this layer deliberately does not have. `COLUMNS(a, b)` is absent on
 * purpose: it names its columns, so they are checked like any other reference.
 */
export const UNRESOLVABLE_COLUMN_SETS: readonly string[] = [
  "Asterisk",
  "QualifiedAsterisk",
  "ColumnsRegexpMatcher",
  "QualifiedColumnsRegexpMatcher",
];

/**
 * A {@link LangWatchQLQueryBlock} while the walk is still filling it in.
 *
 * Mutable, and carried on the frame rather than looked up, so that whichever
 * node learns a fact writes it to the block it is lexically inside — which is
 * the only interpretation that stays right when blocks nest.
 */
export interface BlockAccumulator {
  readonly tables: LangWatchQLTableReference[];
  readonly joins: LangWatchQLJoinEdge[];
  readonly filteredColumns: string[];
  readonly groupByColumns: string[];
  hasGroupBy: boolean;
  isAggregated: boolean;
}

/** Where the walk currently is, and what it has learned on the way down. */
export interface Frame {
  readonly clause: LangWatchQLClause;
  /** Sticky: once inside a nested query, every violation reports `subquery`. */
  readonly isInSubquery: boolean;
  readonly subqueryDepth: number;
  readonly nodeDepth: number;
  /** CTE names visible here, lowercased. Not checked against the table policy. */
  readonly ctes: readonly string[];
  /** The `SELECT` block this node sits in. Absent above the outermost one. */
  readonly block?: BlockAccumulator;
}

/** Everything the walk accumulates. */
export interface WalkContext {
  readonly policy: ResolvedLangWatchQLPolicy;
  readonly violations: LangWatchQLViolation[];
  readonly tables: string[];
  readonly parameters: LangWatchQLParameter[];
  readonly blocks: BlockAccumulator[];
}

export interface NodeArgs {
  readonly node: SqlAstNode;
  readonly frame: Frame;
  readonly ctx: WalkContext;
}

export interface FieldArgs extends NodeArgs {
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
export type FieldRule =
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

export interface NodeRule {
  /** Every field this node kind may carry. Anything else is refused. */
  readonly fields: Readonly<Record<string, FieldRule>>;
  /**
   * Runs before the fields, and decides the frame they are walked in.
   * Returning `null` refuses the subtree without descending into it.
   */
  readonly enter?: (args: NodeArgs) => Frame | null;
}
