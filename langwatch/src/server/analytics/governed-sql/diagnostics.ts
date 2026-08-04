/**
 * Governed analytics SQL — the advisory diagnostics a result carries.
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
 *    {@link AcceptedGovernedSql.blocks}, the structure the validator's single
 *    walk recorded. Nothing here re-parses the SQL — a second parse is a second
 *    answer waiting to disagree with the first.
 *  - Result rules (`MISSING_TIME_BUCKETS`, `INCOMPLETE_COMPARISON_PERIOD`) read
 *    the typed columns and rows that came back.
 *  - `RESULT_TRUNCATED` reads the executor's own report that a response ceiling
 *    cut the answer short.
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
 * @see specs/analytics/governed-sql-api.feature
 */

import type { GovernedViewDefinition } from "./catalog/types";
import type { GovernedSqlColumn, GovernedSqlResultLimits } from "./executor";
import type {
  AcceptedGovernedSql,
  GovernedSqlQueryBlock,
} from "./validation/validate";

/**
 * Every note this API can attach to a result.
 *
 * A code is here because a caller would *do something different* on seeing it,
 * which is the same bar the violation codes are held to. The set is the four
 * rules issue #6480 scopes — fanout, truncation, comparison period, missing
 * buckets — plus the unfiltered-time-range rule, which is here because the
 * partition-pruning measurement recorded in `./views.ts` puts an eight-fold
 * read cost on exactly that shape.
 */
export const GOVERNED_SQL_DIAGNOSTIC_CODES = [
  /** A response ceiling cut the answer short. */
  "RESULT_TRUNCATED",
  /** A join repeats one dataset's rows once per row of another. */
  "POSSIBLE_FANOUT",
  /** A dataset was read with no predicate on the column that prunes it. */
  "UNBOUNDED_TIME_RANGE",
  /** A time-bucketed answer skips buckets inside the range it covers. */
  "MISSING_TIME_BUCKETS",
  /** A time-bucketed answer compares periods of unequal or unfinished coverage. */
  "INCOMPLETE_COMPARISON_PERIOD",
] as const;

export type GovernedSqlDiagnosticCode =
  (typeof GOVERNED_SQL_DIAGNOSTIC_CODES)[number];

/**
 * A structured note about a result that is correct but worth reading twice.
 *
 * Distinct from an error: the query ran and the answer is real.
 */
export interface GovernedSqlDiagnostic {
  readonly code: GovernedSqlDiagnosticCode;
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
export const GOVERNED_SQL_CLEAN_DIAGNOSTICS_MEANING =
  "An empty diagnostics list means no known issue was detected. It is not proof that the answer is the one you meant.";

/** Everything the rules read. */
export interface GovernedSqlDiagnosticsInput {
  /** What the validator's walk established about the submitted query. */
  readonly validation: AcceptedGovernedSql;
  /** The governed database every dataset name is qualified with. */
  readonly database: string;
  /** The catalog the query's tables are resolved against. */
  readonly views: readonly GovernedViewDefinition[];
  readonly columns: readonly GovernedSqlColumn[];
  readonly rows: readonly Record<string, unknown>[];
  /** Whether a response ceiling cut the result short. */
  readonly truncated: boolean;
  readonly limits: GovernedSqlResultLimits;
  /** Rows actually handed back, after the ceilings. */
  readonly rowsReturned: number;
  /**
   * The instant "has this bucket finished yet" is asked against.
   *
   * Injected rather than read from the clock so that the answer is a function
   * of its inputs — the same result at the same instant always produces the
   * same diagnostics.
   */
  readonly now: Date;
}

/**
 * Every diagnostic a finished query earns, in a stable order.
 *
 * Pure. Truncation first because it changes what the other rules are looking
 * at: a cut-off result can be missing the buckets they would have read.
 */
export function governedSqlDiagnostics(
  input: GovernedSqlDiagnosticsInput,
): readonly GovernedSqlDiagnostic[] {
  return [
    ...truncationDiagnostics(input),
    ...fanoutDiagnostics(input),
    ...unboundedTimeRangeDiagnostics(input),
    ...timeBucketDiagnostics(input),
  ];
}

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

function truncationDiagnostics({
  truncated,
  limits,
  rowsReturned,
}: GovernedSqlDiagnosticsInput): GovernedSqlDiagnostic[] {
  if (!truncated) return [];
  return [
    {
      code: "RESULT_TRUNCATED",
      message:
        "The result was cut off at this API's response ceiling. Aggregate further, or narrow the query, to see the whole answer.",
      meta: {
        maxRows: limits.maxRows,
        maxResultBytes: limits.maxResultBytes,
        rowsReturned,
      },
    },
  ];
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

/** One of a block's table references, resolved to the dataset it names. */
interface ResolvedTableReference {
  /** How a join condition would qualify it: its alias, or its bare name. */
  readonly qualifier: string;
  /** The name a caller writes, qualified with the governed database. */
  readonly datasetName: string;
  readonly view: GovernedViewDefinition;
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
}: GovernedSqlDiagnosticsInput): GovernedSqlDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: GovernedSqlDiagnostic[] = [];

  for (const block of validation.blocks) {
    for (const pair of joinedPairs({ block, database, views })) {
      for (const [multiplied, multiplier, matched] of [
        [pair.left, pair.right, pair.rightColumns],
        [pair.right, pair.left, pair.leftColumns],
      ] as const) {
        const unmatched = unmatchedGrainColumns(multiplier.view, matched);
        if (unmatched.length === 0) continue;

        const key = `${multiplied.datasetName}<-${multiplier.datasetName}`;
        if (seen.has(key)) continue;
        seen.add(key);

        diagnostics.push(
          fanoutDiagnostic({ multiplied, multiplier, unmatched, block, pair }),
        );
      }
    }
  }
  return diagnostics;
}

/**
 * The grain columns a join left unmatched — the reason one row can meet many.
 *
 * A dataset's grain is its deduplication key: match every column of it and one
 * row answers, match fewer and the rest of them multiply.
 */
function unmatchedGrainColumns(
  view: GovernedViewDefinition,
  matched: ReadonlySet<string>,
): readonly string[] {
  return view.dedup.keyColumns.filter((column) => {
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
  block: GovernedSqlQueryBlock;
  pair: JoinedPair;
}): GovernedSqlDiagnostic {
  const collapses = block.groupBy || block.aggregated;
  return {
    code: "POSSIBLE_FANOUT",
    message:
      `The join repeats each row of ${multiplied.datasetName} once per matching row of ` +
      `${multiplier.datasetName}, because it does not match ${multiplier.datasetName} on ` +
      `${unmatched.join(", ")}. ` +
      (collapses
        ? `Any aggregate over a ${multiplied.datasetName} measure therefore counts that measure ` +
          `once per matching row. Aggregate ${multiplied.datasetName} to its own grain first, ` +
          `then join.`
        : `Its rows are therefore repeated in the result. Aggregate ${multiplier.datasetName} to ` +
          `${multiplied.datasetName}'s grain first, then join.`),
    meta: {
      /** The dataset whose rows are repeated. */
      dataset: multiplied.datasetName,
      /** The dataset each of those rows is repeated for. */
      multipliedBy: multiplier.datasetName,
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
      aggregated: collapses,
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
function measureColumns(view: GovernedViewDefinition): readonly string[] {
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
  block: GovernedSqlQueryBlock;
  database: string;
  views: readonly GovernedViewDefinition[];
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
      leftIndex < rightIndex ? [leftIndex, rightIndex] : [rightIndex, leftIndex];
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
      // `USING (col)` and a bare `ON a = a`: the same column on every side, so
      // it is matched for every dataset the block reads.
      if (left.column !== right.column) continue;
      for (let index = 0; index < references.length; index += 1) {
        for (let other = index + 1; other < references.length; other += 1) {
          const pair = pairFor(index, other);
          pair.leftColumns.add(left.column);
          pair.rightColumns.add(right.column);
        }
      }
      continue;
    }

    const leftIndex =
      left.qualifier === undefined
        ? undefined
        : byQualifier.get(left.qualifier);
    const rightIndex =
      right.qualifier === undefined
        ? undefined
        : byQualifier.get(right.qualifier);
    if (leftIndex === undefined || rightIndex === undefined) continue;
    if (leftIndex === rightIndex) continue;

    const pair = pairFor(leftIndex, rightIndex);
    const leftIsLow = leftIndex < rightIndex;
    (leftIsLow ? pair.leftColumns : pair.rightColumns).add(left.column);
    (leftIsLow ? pair.rightColumns : pair.leftColumns).add(right.column);
  }

  return [...pairs.values()];
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
  block: GovernedSqlQueryBlock;
  database: string;
  views: readonly GovernedViewDefinition[];
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
      datasetName: `${database}.${view.name}`,
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
}: GovernedSqlDiagnosticsInput): GovernedSqlDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: GovernedSqlDiagnostic[] = [];

  for (const block of validation.blocks) {
    const filtered = new Set(block.filteredColumns);
    for (const reference of resolveTableReferences({
      block,
      database,
      views,
    })) {
      const { timeColumn } = reference.view;
      if (filtered.has(timeColumn.toLowerCase())) continue;
      if (seen.has(reference.datasetName)) continue;
      seen.add(reference.datasetName);

      diagnostics.push({
        code: "UNBOUNDED_TIME_RANGE",
        message:
          `${reference.datasetName} was read with no condition on ${timeColumn}, so the read ` +
          `covers the whole history this project has rather than a window of it. Add a range ` +
          `on ${timeColumn} to bound the scan.`,
        meta: {
          dataset: reference.datasetName,
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
 * How far a spacing may drift from a whole multiple of the bucket width and
 * still count as aligned.
 *
 * A calendar bucket is not a fixed number of milliseconds — months differ by
 * up to three days and a daylight-saving day by an hour — so a tolerance
 * proportional to the width is what keeps `toStartOfMonth` from reporting
 * itself as misaligned.
 */
const BUCKET_ALIGNMENT_TOLERANCE = 0.15;

function timeBucketDiagnostics(
  input: GovernedSqlDiagnosticsInput,
): GovernedSqlDiagnostic[] {
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
}: GovernedSqlDiagnosticsInput): { column: string; buckets: number[] } | null {
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
}): GovernedSqlDiagnostic[] {
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
}): GovernedSqlDiagnostic[] {
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
  return Math.abs(multiple - Math.round(multiple)) <= BUCKET_ALIGNMENT_TOLERANCE;
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
