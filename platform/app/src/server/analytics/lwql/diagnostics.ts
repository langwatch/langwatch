/**
 * LangWatchQL analytics SQL — the advisory diagnostics a result carries.
 *
 * A diagnostic is never a refusal. The validator owns rejection; by the time
 * this module runs the query has already executed and the answer is real. What
 * these say is that the answer is easy to *misread* — a measure counted once
 * per joined row, a chart with a hole in it, a bucket that has not finished
 * filling — and each one names the fact that made it fire so the caller can
 * decide rather than guess.
 *
 * ## One vocabulary, three sources
 *
 * Some rules read the *query's shape*, some read the *result*, and one reads
 * what the executor did to it — and all of them emit into the same list with
 * the same code space. That is deliberate: a consumer branches on `code` and
 * should never have to know which layer noticed.
 *
 *  - Query-shape rules (`POSSIBLE_FANOUT`, `UNBOUNDED_TIME_RANGE`) read
 *    {@link AcceptedLangWatchQL.blocks}, the structure the validator's single
 *    walk recorded. Nothing here re-parses the SQL — a second parse is a second
 *    answer waiting to disagree with the first.
 *  - Result rules (`MISSING_TIME_BUCKETS`, `INCOMPLETE_COMPARISON_PERIOD`) read
 *    the typed columns and rows that came back.
 *
 * ## Under-report rather than over-report
 *
 * Every rule below fires only on a fact it can point at. A join written in
 * `WHERE` instead of `ON` is invisible to the walk, so it gets no fanout
 * diagnostic; a filter written against a projection alias is not recognised as
 * a filter on the column behind it. Both are misses, and misses are the right
 * failure direction for an advisory: a warning that fires on healthy queries
 * gets ignored, and then it is not a warning at all.
 *
 * @see ./validation/validate.ts — the walk whose record the shape rules read
 * @see specs/lwql/api.feature
 */

import {
  type LangWatchQLViewDefinition,
  lwqlGrainColumns,
} from "./catalog/types";
import type { LangWatchQLColumn } from "./executor";
import type {
  AcceptedLangWatchQL,
  LangWatchQLQueryBlock,
} from "./validation/validate";

/**
 * Every note this API can attach to a result.
 *
 * A code is here because a caller would *do something different* on seeing it,
 * which is the same bar the violation codes are held to. The set is the
 * query-shape and result rules issue #6480 scopes — fanout, comparison period,
 * missing buckets — plus the unfiltered-time-range rule, which is here because
 * the partition-pruning measurement recorded in
 * `./provisioning/catalogStatements.ts` puts an eight-fold read cost on exactly
 * that shape.
 */
export const LWQL_DIAGNOSTIC_CODES = [
  /** The result carries rows from more than one project the key can read. */
  "MULTI_PROJECT_RESULT",
  /** A join repeats one dataset's rows once per row of another. */
  "POSSIBLE_FANOUT",
  /** A dataset was read with no predicate on the column that prunes it. */
  "UNBOUNDED_TIME_RANGE",
  /** A time-bucketed answer skips buckets inside the range it covers. */
  "MISSING_TIME_BUCKETS",
  /** A time-bucketed answer compares periods of unequal or unfinished coverage. */
  "INCOMPLETE_COMPARISON_PERIOD",
  /**
   * An app function's value was cut at the per-value ceiling.
   *
   * Its own code rather than `RESULT_TRUNCATED`, because the remedy is
   * different: nothing about the query is too big, one conversation or trace
   * is, and the fix is a tighter token budget on that call rather than a
   * narrower query.
   */
  "APP_FUNCTION_VALUE_TRUNCATED",
  /**
   * An app function's key named no trace or thread, so the column is null for
   * those rows.
   *
   * Worth saying out loud because null is otherwise ambiguous: a caller cannot
   * tell "this conversation is empty" from "this conversation id is not one we
   * hold" — which is what a mistyped id, or a row older than the retention
   * window, looks like.
   */
  "APP_FUNCTION_UNRESOLVED_KEYS",
  /**
   * Trailing rows were dropped because the hydrated values reached the
   * response's byte ceiling.
   *
   * A cut rather than a refusal, unlike the plain result ceiling: the rows that
   * survive are a prefix of the caller's own `ORDER BY`, so the answer is one
   * they can page past. Its own code because the remedy is a smaller token
   * budget per call, not a narrower query.
   */
  "APP_FUNCTION_RESULT_TRUNCATED",
] as const;

export type LangWatchQLDiagnosticCode = (typeof LWQL_DIAGNOSTIC_CODES)[number];

/**
 * A structured note about a result that is correct but worth reading twice.
 *
 * Distinct from an error: the query ran and the answer is real.
 */
export interface LangWatchQLDiagnostic {
  readonly code: LangWatchQLDiagnosticCode;
  /** Customer-safe sentence naming what to check. Never an internal name. */
  readonly message: string;
  /**
   * The facts behind the note, for a consumer that renders or reasons over it.
   *
   * A client contract rather than a scratchpad: every key here is one a caller
   * can act on — which dataset, which columns, how many buckets are missing.
   */
  readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * What an empty diagnostics list means, in the words the API publishes.
 *
 * Stated once, here, and reused by the endpoint's own documentation, because
 * the distinction it draws is the entire point of the feature: "we found
 * nothing" and "this is right" are different claims and only the first one is
 * ours to make.
 */
export const LWQL_CLEAN_DIAGNOSTICS_MEANING =
  "An empty diagnostics list means no known issue was detected. It is not proof that the answer is the one you meant.";

/** Everything the rules read. */
export interface LangWatchQLDiagnosticsInput {
  /** What the validator's walk established about the submitted query. */
  readonly validation: AcceptedLangWatchQL;
  /** The LangWatchQL database every dataset name is qualified with. */
  readonly database: string;
  /** The catalog the query's tables are resolved against. */
  readonly views: readonly LangWatchQLViewDefinition[];
  readonly columns: readonly LangWatchQLColumn[];
  readonly rows: readonly Record<string, unknown>[];
  /**
   * The instant "has this bucket finished yet" is asked against.
   *
   * Injected rather than read from the clock so that the answer is a function
   * of its inputs — the same result at the same instant always produces the
   * same diagnostics.
   */
  readonly now: Date;
  /**
   * What the app-function hydration stage did, when the statement called one.
   *
   * Absent for every statement that called none, which is how a query that
   * existed before this feature earns exactly the diagnostics it earned before.
   */
  readonly appFunctions?: LangWatchQLAppFunctionDiagnosticsInput;
}

/** The hydration stage's own report, as the rules below read it. */
export interface LangWatchQLAppFunctionDiagnosticsInput {
  /** Whether the hydrated-bytes ceiling cut trailing rows off the result. */
  readonly isTruncatedByBytes: boolean;
  /** The ceiling that cut it, so the caller can size the next request against it. */
  readonly maxHydratedBytes: number;
  /** Rows handed back after the cut. */
  readonly rowsReturned: number;
  readonly valueTruncations: readonly {
    readonly column: string;
    readonly function: string;
    readonly values: number;
  }[];
  readonly unresolvedKeys: readonly {
    readonly column: string;
    readonly function: string;
    readonly keys: number;
  }[];
}

/**
 * Every diagnostic a finished query earns, in a stable order.
 *
 * Pure.
 */
export function lwqlDiagnostics(
  input: LangWatchQLDiagnosticsInput,
): readonly LangWatchQLDiagnostic[] {
  return [
    ...multiProjectDiagnostics(input),
    ...appFunctionDiagnostics(input),
    ...fanoutDiagnostics(input),
    ...unboundedTimeRangeDiagnostics(input),
    ...timeBucketDiagnostics(input),
  ];
}

// ---------------------------------------------------------------------------
// Multi-project result
// ---------------------------------------------------------------------------

/** The project-identifier column, matched however the caller cased it. */
const PROJECT_ID_COLUMN = "tenantid";

/**
 * Notes when a result draws rows from more than one project.
 *
 * A key that can read several projects gets the union of their rows unless the
 * query narrows to one, and a caller who did not mean to aggregate across
 * projects would misread the total. The count is computed from the rows already
 * returned — no second query — and only when the caller selected the project
 * column: without it the projects are not in the result to count, and guessing
 * would mean inventing the fact the diagnostic reports.
 *
 * Fires only for a count above one: a single-project result is the ordinary
 * case and says nothing worth reading twice.
 */
function multiProjectDiagnostics({
  columns,
  rows,
}: LangWatchQLDiagnosticsInput): LangWatchQLDiagnostic[] {
  const column = columns.find(
    (candidate) => candidate.name.trim().toLowerCase() === PROJECT_ID_COLUMN,
  );
  if (!column) return [];

  const projects = new Set(rows.map((row) => row[column.name]));
  if (projects.size <= 1) return [];

  return [
    {
      code: "MULTI_PROJECT_RESULT",
      message:
        `This result draws rows from ${projects.size} projects this key can read. ` +
        `If you meant one, filter on ${column.name} — for example ` +
        `WHERE ${column.name} = '<project id>'.`,
      meta: {
        /** How many distinct projects contributed rows to this result. */
        projectCount: projects.size,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// App functions
// ---------------------------------------------------------------------------

/**
 * What the hydration stage has to say about the values it put in the result.
 *
 * One diagnostic per condition rather than per column: a statement projecting
 * three functions whose keys all went unresolved is one fact about the query,
 * and three entries saying it would push the rest of the list out of a
 * consumer's view for no extra information. The columns ride in `meta`.
 */
function appFunctionDiagnostics({
  appFunctions,
}: LangWatchQLDiagnosticsInput): LangWatchQLDiagnostic[] {
  if (!appFunctions) return [];
  const diagnostics: LangWatchQLDiagnostic[] = [];

  if (appFunctions.valueTruncations.length > 0) {
    diagnostics.push({
      code: "APP_FUNCTION_VALUE_TRUNCATED",
      message:
        "Some values were cut because a single conversation or trace was larger than one value may be. Ask for a smaller token budget to choose what is kept.",
      meta: { columns: appFunctions.valueTruncations },
    });
  }

  if (appFunctions.isTruncatedByBytes) {
    diagnostics.push({
      code: "APP_FUNCTION_RESULT_TRUNCATED",
      message:
        "Trailing rows were dropped because the extracted values reached this API's response ceiling. Ask for a smaller token budget per call, or narrow the query, to see the whole answer.",
      meta: {
        maxHydratedBytes: appFunctions.maxHydratedBytes,
        rowsReturned: appFunctions.rowsReturned,
      },
    });
  }

  if (appFunctions.unresolvedKeys.length > 0) {
    diagnostics.push({
      code: "APP_FUNCTION_UNRESOLVED_KEYS",
      message:
        "Some rows are null because their conversation or trace id matched nothing. Check the ids, and that the rows are inside the retention window.",
      meta: { columns: appFunctions.unresolvedKeys },
    });
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Fanout
// ---------------------------------------------------------------------------

/**
 * Key columns a join never has to spell out.
 *
 * The row policy resolves one tenant for the whole query, so both sides of
 * every join are already the same tenant's rows whether or not the caller
 * wrote the equality. Treating it as matched is what keeps an ordinary
 * `ON child.TraceId = parent.TraceId` from reporting the parent as fanning out
 * the child, which it does not.
 */
const IMPLICITLY_MATCHED_KEY_COLUMNS: ReadonlySet<string> = new Set([
  "tenantid",
]);

/** One of a block's table references, resolved to the view it names. */
interface ResolvedTableReference {
  /** How a join condition would qualify it: its alias, or its bare name. */
  readonly qualifier: string;
  /** The name a caller writes, qualified with the LangWatchQL database. */
  readonly viewName: string;
  readonly view: LangWatchQLViewDefinition;
}

/** The equalities recorded between one pair of a block's table references. */
interface JoinedPair {
  readonly left: ResolvedTableReference;
  readonly right: ResolvedTableReference;
  /** Columns of `left` the join matched, lowercased. */
  readonly leftColumns: Set<string>;
  /** Columns of `right` the join matched, lowercased. */
  readonly rightColumns: Set<string>;
}

function fanoutDiagnostics({
  validation,
  database,
  views,
}: LangWatchQLDiagnosticsInput): LangWatchQLDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: LangWatchQLDiagnostic[] = [];

  for (const block of validation.blocks) {
    for (const pair of joinedPairs({ block, database, views })) {
      diagnostics.push(...fanoutForPair({ pair, block, seen }));
    }
  }
  return diagnostics;
}

/**
 * The fan-out diagnostics one joined pair earns, in both directions.
 *
 * Both, because a join under-matched on either side multiplies the *other*
 * side's rows, and which side a reader cares about is not knowable here. The
 * `seen` set is shared across the whole query so the same dataset pairing is
 * reported once however many blocks join it.
 */
function fanoutForPair({
  pair,
  block,
  seen,
}: {
  pair: JoinedPair;
  block: LangWatchQLQueryBlock;
  seen: Set<string>;
}): LangWatchQLDiagnostic[] {
  const diagnostics: LangWatchQLDiagnostic[] = [];
  for (const [multiplied, multiplier, matched] of [
    [pair.left, pair.right, pair.rightColumns],
    [pair.right, pair.left, pair.leftColumns],
  ] as const) {
    const unmatched = unmatchedGrainColumns(multiplier.view, matched);
    if (unmatched.length === 0) continue;

    const key = `${multiplied.viewName}<-${multiplier.viewName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    diagnostics.push(
      fanoutDiagnostic({ multiplied, multiplier, unmatched, block, pair }),
    );
  }
  return diagnostics;
}

/**
 * The grain columns a join left unmatched — the reason one row can meet many.
 *
 * A dataset's grain is the identity of one of its rows: match every column of
 * it and one row answers, match fewer and the rest of them multiply.
 *
 * Read from {@link lwqlGrainColumns} rather than from the source's sort
 * key, because the two are not always the same list and the difference is a
 * false alarm rather than a finding. `evaluation_metrics` is sorted
 * `(TenantId, OccurredAt, EvaluationId)` for range scans and declares a grain
 * of `(TenantId, EvaluationId)`, which its `in-tuple` dedup delivers, so a join
 * on that grain would otherwise be reported as fanning out on `OccurredAt` —
 * the diagnostic contradicting the schema, on the join it told the caller to
 * write.
 */
function unmatchedGrainColumns(
  view: LangWatchQLViewDefinition,
  matched: ReadonlySet<string>,
): readonly string[] {
  return lwqlGrainColumns(view).filter((column) => {
    const lowered = column.toLowerCase();
    return (
      !matched.has(lowered) && !IMPLICITLY_MATCHED_KEY_COLUMNS.has(lowered)
    );
  });
}

function fanoutDiagnostic({
  multiplied,
  multiplier,
  unmatched,
  block,
  pair,
}: {
  multiplied: ResolvedTableReference;
  multiplier: ResolvedTableReference;
  unmatched: readonly string[];
  block: LangWatchQLQueryBlock;
  pair: JoinedPair;
}): LangWatchQLDiagnostic {
  const isRowCollapsing = block.hasGroupBy || block.isAggregated;
  return {
    code: "POSSIBLE_FANOUT",
    message:
      `The join repeats each row of ${multiplied.viewName} once per matching row of ` +
      `${multiplier.viewName}, because it does not match ${multiplier.viewName} on ` +
      `${unmatched.join(", ")}. ` +
      (isRowCollapsing
        ? `Any aggregate over a ${multiplied.viewName} measure therefore counts that measure ` +
          `once per matching row. Aggregate ${multiplied.viewName} to its own grain first, ` +
          `then join.`
        : `Its rows are therefore repeated in the result. Aggregate ${multiplier.viewName} to ` +
          `${multiplied.viewName}'s grain first, then join.`),
    meta: {
      /** The view whose rows are repeated. */
      view: multiplied.viewName,
      /** The view each of those rows is repeated for. */
      multipliedByView: multiplier.viewName,
      /**
       * The repeated dataset's measures: the columns where the repetition
       * changes the number rather than only the row count.
       */
      affectedColumns: measureColumns(multiplied.view),
      /** Grain columns of the multiplying dataset the join did not match. */
      unmatchedGrainColumns: unmatched,
      /** Columns the join matched, on either side. */
      joinedOn: [
        ...new Set([...pair.leftColumns, ...pair.rightColumns]),
      ].sort(),
      /** Whether the block collapses rows, which decides what is at risk. */
      aggregated: isRowCollapsing,
    },
  };
}

/**
 * The columns whose values are measured in something.
 *
 * These are the ones a fanout silently changes: repeating a row doubles a
 * duration or a cost that is then summed, while repeating an identifier only
 * repeats it. The catalog's `unit` is what says which is which.
 */
function measureColumns(view: LangWatchQLViewDefinition): readonly string[] {
  return view.columns
    .filter((column) => column.unit !== undefined)
    .map((column) => column.name);
}

/**
 * Every pair of a block's datasets that a join condition tied together, with
 * the columns it tied them on.
 *
 * Pairs with no recorded equality are absent rather than reported as an
 * unbounded join: the walk records only the equalities written in `ON` or
 * `USING`, so a join expressed in `WHERE` would otherwise look like a cross
 * product it is not.
 */
function joinedPairs({
  block,
  database,
  views,
}: {
  block: LangWatchQLQueryBlock;
  database: string;
  views: readonly LangWatchQLViewDefinition[];
}): JoinedPair[] {
  const references = resolveTableReferences({ block, database, views });
  if (references.length < 2) return [];

  const byQualifier = new Map<string, number>();
  references.forEach((reference, index) => {
    if (!byQualifier.has(reference.qualifier)) {
      byQualifier.set(reference.qualifier, index);
    }
  });

  const pairs = new Map<string, JoinedPair>();
  const pairFor = (leftIndex: number, rightIndex: number): JoinedPair => {
    const [low, high] =
      leftIndex < rightIndex
        ? [leftIndex, rightIndex]
        : [rightIndex, leftIndex];
    const key = `${low}:${high}`;
    const existing = pairs.get(key);
    if (existing) return existing;
    const created: JoinedPair = {
      left: references[low]!,
      right: references[high]!,
      leftColumns: new Set<string>(),
      rightColumns: new Set<string>(),
    };
    pairs.set(key, created);
    return created;
  };

  for (const edge of block.joins) {
    const left = readJoinSide(edge.left);
    const right = readJoinSide(edge.right);

    if (left.qualifier === undefined && right.qualifier === undefined) {
      applyUnqualifiedEquality({
        left,
        right,
        referenceCount: references.length,
        pairFor,
      });
      continue;
    }

    applyQualifiedEquality({ left, right, byQualifier, pairFor });
  }

  return [...pairs.values()];
}

/** One side of a join equality, resolved into its qualifier and column. */
type JoinSide = ReturnType<typeof readJoinSide>;
/** Looks up (creating on first use) the pair two reference indexes describe. */
type PairLookup = (leftIndex: number, rightIndex: number) => JoinedPair;

/**
 * Records an equality neither side qualified — `USING (col)`, or a bare
 * `ON a = a`.
 *
 * With no qualifier there is nothing to say which two datasets the equality
 * belongs to, so it matches the column for *every* pair the block reads. A
 * differing column on each side names nothing at all and is dropped.
 */
function applyUnqualifiedEquality({
  left,
  right,
  referenceCount,
  pairFor,
}: {
  left: JoinSide;
  right: JoinSide;
  referenceCount: number;
  pairFor: PairLookup;
}): void {
  if (left.column !== right.column) return;
  for (let index = 0; index < referenceCount; index += 1) {
    for (let other = index + 1; other < referenceCount; other += 1) {
      const pair = pairFor(index, other);
      pair.leftColumns.add(left.column);
      pair.rightColumns.add(right.column);
    }
  }
}

/**
 * Records an equality that named at least one side's table.
 *
 * A qualifier the block never introduced, or both sides resolving to the same
 * reference, matches no pair of datasets and is dropped — a self-equality is
 * not a join key.
 */
function applyQualifiedEquality({
  left,
  right,
  byQualifier,
  pairFor,
}: {
  left: JoinSide;
  right: JoinSide;
  byQualifier: ReadonlyMap<string, number>;
  pairFor: PairLookup;
}): void {
  const leftIndex =
    left.qualifier === undefined ? undefined : byQualifier.get(left.qualifier);
  const rightIndex =
    right.qualifier === undefined
      ? undefined
      : byQualifier.get(right.qualifier);
  if (leftIndex === undefined || rightIndex === undefined) return;
  if (leftIndex === rightIndex) return;

  const pair = pairFor(leftIndex, rightIndex);
  const leftIsLow = leftIndex < rightIndex;
  (leftIsLow ? pair.leftColumns : pair.rightColumns).add(left.column);
  (leftIsLow ? pair.rightColumns : pair.leftColumns).add(right.column);
}

/** One side of a join equality, split into the qualifier and the column. */
function readJoinSide(side: string): {
  qualifier: string | undefined;
  column: string;
} {
  const segments = side.trim().toLowerCase().split(".");
  const column = segments.at(-1) ?? "";
  return {
    qualifier: segments.length > 1 ? segments.at(-2) : undefined,
    column,
  };
}

/**
 * The block's table references, resolved against the catalog.
 *
 * A reference the catalog does not know is dropped: it can only be a dataset
 * this service was not given, and a rule that guessed at its grain would be
 * inventing the fact it reports.
 */
function resolveTableReferences({
  block,
  database,
  views,
}: {
  block: LangWatchQLQueryBlock;
  database: string;
  views: readonly LangWatchQLViewDefinition[];
}): ResolvedTableReference[] {
  const resolved: ResolvedTableReference[] = [];
  for (const reference of block.tables) {
    const view = views.find(
      (candidate) =>
        `${database}.${candidate.name}`.toLowerCase() ===
        reference.table.toLowerCase(),
    );
    if (!view) continue;
    resolved.push({
      qualifier: reference.alias ?? view.name.toLowerCase(),
      viewName: `${database}.${view.name}`,
      view,
    });
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Unbounded time range
// ---------------------------------------------------------------------------

function unboundedTimeRangeDiagnostics({
  validation,
  database,
  views,
}: LangWatchQLDiagnosticsInput): LangWatchQLDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: LangWatchQLDiagnostic[] = [];

  for (const block of validation.blocks) {
    const filtered = new Set(block.filteredColumns);
    for (const reference of resolveTableReferences({
      block,
      database,
      views,
    })) {
      const { timeColumn } = reference.view;
      if (filtered.has(timeColumn.toLowerCase())) continue;
      if (seen.has(reference.viewName)) continue;
      seen.add(reference.viewName);

      diagnostics.push({
        code: "UNBOUNDED_TIME_RANGE",
        message:
          `${reference.viewName} was read with no condition on ${timeColumn}, so the read ` +
          `covers the whole history this project has rather than a window of it. Add a range ` +
          `on ${timeColumn} to bound the scan.`,
        meta: {
          view: reference.viewName,
          /** Filter on this column to bound the read. */
          timeColumn,
        },
      });
    }
  }
  return diagnostics;
}

// ---------------------------------------------------------------------------
// Time buckets
// ---------------------------------------------------------------------------

/**
 * Buckets needed before a gap can be told from the spacing.
 *
 * Two buckets one hour apart are indistinguishable from two hourly buckets
 * with an hour missing between them, so the gap rule needs a third.
 */
const MIN_BUCKETS_FOR_GAP_DETECTION = 3;

/**
 * How far a spacing may drift from a whole multiple of the bucket width, per
 * bucket the spacing covers, and still count as aligned.
 *
 * A calendar bucket is not a fixed number of milliseconds — months differ by
 * up to three days and a daylight-saving day by an hour — so a tolerance
 * proportional to the width is what keeps `toStartOfMonth` from reporting
 * itself as misaligned.
 *
 * Per bucket, because the drift accumulates with the gap: `width` is the
 * *shortest* spacing observed, so every longer bucket the gap spans adds its
 * own difference. A budget fixed at one bucket's worth would hold for a gap of
 * one and fail for a gap of three.
 */
const BUCKET_ALIGNMENT_TOLERANCE = 0.15;

function timeBucketDiagnostics(
  input: LangWatchQLDiagnosticsInput,
): LangWatchQLDiagnostic[] {
  const axis = timeBucketAxis(input);
  if (!axis) return [];

  const { column, buckets } = axis;
  const width = Math.min(
    ...buckets.slice(1).map((value, index) => value - buckets[index]!),
  );
  if (!Number.isFinite(width) || width <= 0) return [];

  return [
    ...comparisonPeriodDiagnostics({ column, buckets, width, now: input.now }),
    ...missingBucketDiagnostics({ column, buckets, width }),
  ];
}

/**
 * The result's time axis, or nothing when the query has none.
 *
 * Three conditions, all required, and each of them is what keeps the rules off
 * a query they have nothing to say about:
 *
 *  - exactly one temporal column came back, so "the time axis" is unambiguous;
 *  - the query *grouped by that column's name*, so its values really are one
 *    bucket per row. Without this the rules would read an aggregate that
 *    happens to return a timestamp — `argMin(SpanName, StartTime)` beside
 *    `min(StartTime)`, grouped by trace — as a series, and report the ordinary
 *    spacing between unrelated traces as missing buckets;
 *  - at least two buckets came back, so there is a spacing to reason about.
 */
function timeBucketAxis({
  validation,
  columns,
  rows,
}: LangWatchQLDiagnosticsInput): { column: string; buckets: number[] } | null {
  const temporal = columns.filter((column) => isTemporalType(column.type));
  const [column] = temporal;
  if (temporal.length !== 1 || !column) return null;

  const grouped = new Set(
    validation.blocks.flatMap((block) => block.groupByColumns),
  );
  if (!grouped.has(column.name.trim().toLowerCase())) return null;

  const buckets = [
    ...new Set(
      rows
        .map((row) => parseClickHouseTimestamp(row[column.name]))
        .filter((value): value is number => value !== null),
    ),
  ].sort((left, right) => left - right);

  return buckets.length >= 2 ? { column: column.name, buckets } : null;
}

function comparisonPeriodDiagnostics({
  column,
  buckets,
  width,
  now,
}: {
  column: string;
  buckets: readonly number[];
  width: number;
  now: Date;
}): LangWatchQLDiagnostic[] {
  const misaligned = buckets
    .slice(1)
    .map((value, index) => value - buckets[index]!)
    .filter((gap) => !isWholeMultiple(gap, width));
  const newest = buckets.at(-1)!;
  const unfinished = newest + width > now.getTime();

  if (misaligned.length === 0 && !unfinished) return [];

  return [
    {
      code: "INCOMPLETE_COMPARISON_PERIOD",
      message: unfinished
        ? `The newest ${column} period has not finished yet, so it holds less data than the ones ` +
          `before it. Comparing it with an earlier period compares unequal spans of time — end ` +
          `the range at the last completed period instead.`
        : `The ${column} periods are not all the same length, so comparing them compares unequal ` +
          `spans of time. Bucket the range into equal periods, or compare only periods of the ` +
          `same length.`,
      meta: {
        timeColumn: column,
        /** Why the periods do not compare: one is still filling, or they differ in length. */
        reason: unfinished ? "unfinished_newest_period" : "unequal_periods",
        /** The period length the rest of the result is bucketed at, in milliseconds. */
        periodMs: width,
        /** Start of the newest period, as the result reported it. */
        newestPeriodStart: new Date(newest).toISOString(),
        /** How many gaps between periods are not a whole number of periods. */
        unevenPeriodCount: misaligned.length,
      },
    },
  ];
}

function missingBucketDiagnostics({
  column,
  buckets,
  width,
}: {
  column: string;
  buckets: readonly number[];
  width: number;
}): LangWatchQLDiagnostic[] {
  if (buckets.length < MIN_BUCKETS_FOR_GAP_DETECTION) return [];

  let missing = 0;
  const gapsAfter: string[] = [];
  buckets.slice(1).forEach((value, index) => {
    const previous = buckets[index]!;
    const gap = value - previous;
    if (!isWholeMultiple(gap, width)) return;
    const skipped = Math.round(gap / width) - 1;
    if (skipped <= 0) return;
    missing += skipped;
    gapsAfter.push(new Date(previous).toISOString());
  });
  if (missing === 0) return [];

  return [
    {
      code: "MISSING_TIME_BUCKETS",
      message:
        `${missing} ${column} bucket${missing === 1 ? "" : "s"} inside the range have no rows, ` +
        `so the answer has holes rather than zeros. A bucket with no matching row is absent from ` +
        `a grouped result — fill the gaps on your side if the series has to be continuous.`,
      meta: {
        timeColumn: column,
        /** How many bucket positions inside the range carry no row. */
        missingBucketCount: missing,
        /** The bucket width the gaps are counted against, in milliseconds. */
        bucketMs: width,
        /** The buckets a gap follows, so a consumer can find the holes. */
        gapsAfter,
      },
    },
  ];
}

/** Whether `value` is a whole number of `unit`s, within the calendar tolerance. */
function isWholeMultiple(value: number, unit: number): boolean {
  const multiple = value / unit;
  const nearest = Math.round(multiple);
  // Scaled by the buckets the gap covers, not fixed: a three-month hole drifts
  // roughly three times as far from a whole multiple of the shortest month as
  // a one-month step does. Judged against a fixed budget it reads as "these
  // periods are unequal lengths" while the truth is "two months are missing" —
  // and `missingBucketDiagnostics` skips the same gap, so the count of absent
  // buckets comes back zero.
  return (
    Math.abs(multiple - nearest) <=
    BUCKET_ALIGNMENT_TOLERANCE * Math.max(1, nearest)
  );
}

// ---------------------------------------------------------------------------
// Reading the server's temporal values
// ---------------------------------------------------------------------------

/** Wrappers that carry a temporal type without changing that it is one. */
const TYPE_WRAPPER = /^(?:Nullable|LowCardinality)\((.*)\)$/;

/** How many wrappers are unwrapped before giving up. `Nullable(LowCardinality(…))`. */
const MAX_TYPE_WRAPPERS = 3;

/** Whether a ClickHouse type names a point in time. */
function isTemporalType(type: string): boolean {
  let inner = type.trim();
  for (let pass = 0; pass < MAX_TYPE_WRAPPERS; pass += 1) {
    const match = TYPE_WRAPPER.exec(inner);
    if (!match?.[1]) break;
    inner = match[1].trim();
  }
  return /^Date(?:32)?$/.test(inner) || /^DateTime(?:64)?\b/.test(inner);
}

/** `2026-02-20`, `2026-02-20 12:00:00`, `2026-02-20 12:00:00.000`. */
const CLICKHOUSE_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?))?$/;

/**
 * A temporal value as milliseconds, or `null` for anything else.
 *
 * Read as UTC rather than through `new Date(string)`, which interprets a
 * space-separated timestamp in the *server process's* zone — so the same
 * result would produce different diagnostics on two deployments.
 */
function parseClickHouseTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = CLICKHOUSE_TIMESTAMP.exec(value.trim());
  if (!match?.[1]) return null;
  const parsed = Date.parse(`${match[1]}T${match[2] ?? "00:00:00"}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}
