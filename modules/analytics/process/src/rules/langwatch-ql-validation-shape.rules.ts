import type {
  LangWatchQLAppFunctionCall,
  LangWatchQLClause,
  SqlSourcePosition,
  LangWatchQLViolation,
  LangWatchQLViolationCode,
} from "@langwatch/analytics-contract";

/**
 * LangWatchQL analytics SQL — the vocabulary the default-deny walk is written in.
 * @see specs/lwql/api.feature
 */
import type { SqlAstNode } from "./langwatch-ql-parser.rules.ts";
import type { ResolvedLangWatchQLPolicy } from "./langwatch-ql-policy.rules.ts";

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
 * One equality a `JOIN` was written on, with each side exactly as the caller wrote it —
 * `t.TraceId`, not a resolved column.
 */
export interface LangWatchQLJoinEdge {
  readonly left: string;
  readonly right: string;
}

/**
 * One `SELECT` block, and the structure the walk saw in it. Recorded because a diagnostic like
 * `POSSIBLE_FANOUT` — aggregating at a parent's grain after a one-to-many join — is a question
 * about the shape of the query, and the walk is the only pass that ever looks at the tree.
 */
export interface LangWatchQLQueryBlock {
  /**
   * LangWatchQL tables this block reads, in first-seen order. CTE names are
   * excluded for the same reason they are excluded from
   * {@link AcceptedLangWatchQL.tables}: a `WITH` name is its own block.
   */
  readonly tables: readonly LangWatchQLTableReference[];
  /**
   * The equalities this block's joins were written on. Only the conjunctive ones whose two
   * sides are both plain column references: `ON a = b AND c = d` contributes two edges, while a
   * side that is a function call, a literal, or one arm of an `OR` contributes none.
   */
  readonly joins: readonly LangWatchQLJoinEdge[];
  /**
   * Column names this block filters on, lowercased and stripped of any qualifier — `WHERE
   * t.OccurredAt >= …` contributes `occurredat`. Only `WHERE`, `PREWHERE` and `QUALIFY`, which
   * are the positions that bound what a read touches.
   */
  readonly filteredColumns: readonly string[];
  /** Whether the block carries `GROUP BY`, in any of its spellings. */
  readonly hasGroupBy: boolean;
  /**
   * Names the block groups by, lowercased and stripped of any qualifier.
   */
  readonly groupByColumns: readonly string[];
  /**
   * Whether the block collapses rows with an aggregate. `false` for an aggregate used with
   * `OVER`: a window function reads a frame and returns one value per row, which is the
   * opposite of collapsing.
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
   * The app-function calls the projection made, in projection order — the
   * hydration plan. Empty for a statement that called none, which leaves the
   * hydration stage free for every query that existed before app functions.
   */
  readonly appFunctions: readonly LangWatchQLAppFunctionCall[];
  /**
   * Whether the service appends the default `LIMIT`: a single top-level `SELECT` naming no
   * `LIMIT` (an `OFFSET` alone does not bound it). Always `false` for a `UNION`, whose every
   * branch already names its own `LIMIT` or was refused (`LIMIT_REQUIRED_PER_BRANCH`).
   */
  readonly appendRowLimit: boolean;
  /** Where that statement's `OFFSET` sits, so the default `LIMIT` goes before it. */
  readonly appendRowLimitBeforeOffset?: SqlSourcePosition;
}

/** A query that was refused, and every reason found before the walk stopped. */
export interface RejectedLangWatchQL {
  readonly ok: false;
  /** Never empty. Capped at {@link MAX_VIOLATIONS}; a longer list is truncated. */
  readonly violations: readonly LangWatchQLViolation[];
}

export type LangWatchQLValidation = AcceptedLangWatchQL | RejectedLangWatchQL;

/**
 * How many reasons a single rejection reports. All of them, up to a cap: an agent fixing a
 * query wants every problem at once, not one per round trip.
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
 * Column-set constructs whose members the walk cannot enumerate, refused wherever they appear
 * while the caller has restricted fields: nothing proves the expansion excludes one without the
 * table's columns. The one exemption is the star of a bare `count(*)`, a row count.
 */
export const UNRESOLVABLE_COLUMN_SETS: readonly string[] = [
  "Asterisk",
  "QualifiedAsterisk",
  "ColumnsRegexpMatcher",
  "QualifiedColumnsRegexpMatcher",
];

/**
 * A {@link LangWatchQLQueryBlock} while the walk is still filling it in.
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
  /**
   * Set on the children of the root `SelectWithUnionQuery` holding exactly one
   * `SELECT`, cleared below. A `UNION` clears it: two branches would put two
   * meanings in one column, and hydration works per column.
   */
  readonly isRootSelect?: boolean;
  /**
   * Set on the frame of the one `SELECT` whose projection may call an app
   * function. Read by the projection walk and by nothing else.
   */
  readonly isOutermostSelect?: boolean;
  /**
   * Set only on the frame a bare `count(*)` walks its `arguments` in, so that one star passes;
   * never on the call's window definition or parameters, and reset on every nested call.
   */
  readonly isBareCountStarArgument?: boolean;
}

/** What a top-level `SELECT` declared about how many rows it returns. */
export interface TopLevelLimit {
  /** Whether it named its own `LIMIT`; an `OFFSET` alone does not bound a row count. */
  readonly hasLimit: boolean;
  readonly hasOffset: boolean;
  /** The `LIMIT` row count when it is a plain non-negative integer literal. */
  readonly staticRows?: number;
  readonly at?: SqlSourcePosition;
  readonly offsetAt?: SqlSourcePosition;
}

/** Everything the walk accumulates. */
export interface WalkContext {
  readonly policy: ResolvedLangWatchQLPolicy;
  readonly violations: LangWatchQLViolation[];
  readonly tables: string[];
  readonly parameters: LangWatchQLParameter[];
  readonly blocks: BlockAccumulator[];
  /** The hydration plan, in projection order. Only admitted calls are here. */
  readonly appFunctions: LangWatchQLAppFunctionCall[];
  /** One entry per top-level `SELECT`; a subquery's limit bounds a read, not the response. */
  readonly topLevelLimits: TopLevelLimit[];
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
