/**
 * The fanout rule: a join that multiplies rows, so a measure is counted more
 * than once in an answer that reads as one row per thing.
 */
import type { LangWatchQLDiagnostic } from "@langwatch/analytics-contract";

import {
  type LangWatchQLDiagnosticsInput,
  type ResolvedTableReference,
  resolveTableReferences,
} from "../rules/langwatch-ql-diagnostics-shape.rules";
import type { LangWatchQLQueryBlock } from "../rules/langwatch-ql-validation-shape.rules";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLViewDefinition,
} from "./langwatch-ql-catalog-shapes.service";

const catalogShapes = LangWatchQLCatalogShapesService.create();

/**
 * Key columns a join never has to spell out.
 *
 * The row policy resolves one tenant for the whole query, so both sides of
 * every join are already the same tenant's rows whether or not the caller
 * wrote the equality. Treating it as matched is what keeps an ordinary
 * `ON child.TraceId = parent.TraceId` from reporting the parent as fanning out
 * the child, which it does not.
 */
const IMPLICITLY_MATCHED_KEY_COLUMNS: ReadonlySet<string> = new Set(["tenantid"]);

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
    if (unmatched.length === 0) {
      continue;
    }

    const key = `${multiplied.datasetName}<-${multiplier.datasetName}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    diagnostics.push(fanoutDiagnostic({ multiplied, multiplier, unmatched, block, pair }));
  }

  return diagnostics;
}

/**
 * The grain columns a join left unmatched — the reason one row can meet many.
 *
 * A dataset's grain is the identity of one of its rows: match every column of
 * it and one row answers, match fewer and the rest of them multiply.
 *
 * Read from {@link LangWatchQLCatalogShapesService.grainColumns} rather than from the source's sort
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
  return catalogShapes.grainColumns(view).filter((column) => {
    const lowered = column.toLowerCase();

    return !matched.has(lowered) && !IMPLICITLY_MATCHED_KEY_COLUMNS.has(lowered);
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
      `The join repeats each row of ${multiplied.datasetName} once per matching row of ` +
      `${multiplier.datasetName}, because it does not match ${multiplier.datasetName} on ` +
      `${unmatched.join(", ")}. ` +
      (isRowCollapsing
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
      joinedOn: [...new Set([...pair.leftColumns, ...pair.rightColumns])].sort(),
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
  return view.columns.filter((column) => column.unit !== undefined).map((column) => column.name);
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
  if (references.length < 2) {
    return [];
  }

  const byQualifier = new Map<string, number>();
  references.forEach((reference, index) => {
    if (!byQualifier.has(reference.qualifier)) {
      byQualifier.set(reference.qualifier, index);
    }
  });

  const pairs = new Map<string, JoinedPair>();
  const pairFor = (leftIndex: number, rightIndex: number): JoinedPair => {
    const [low, high] = leftIndex < rightIndex ? [leftIndex, rightIndex] : [rightIndex, leftIndex];
    const key = `${low}:${high}`;
    const existing = pairs.get(key);
    if (existing) {
      return existing;
    }

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
  if (left.column !== right.column) {
    return;
  }

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
  const leftIndex = left.qualifier === undefined ? undefined : byQualifier.get(left.qualifier);
  const rightIndex = right.qualifier === undefined ? undefined : byQualifier.get(right.qualifier);
  if (leftIndex === undefined || rightIndex === undefined) {
    return;
  }

  if (leftIndex === rightIndex) {
    return;
  }

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

/** Reports where a join multiplies the rows a measure is read from. */
export class LangWatchQLFanoutDiagnosticsService {
  static create(): LangWatchQLFanoutDiagnosticsService {
    return new LangWatchQLFanoutDiagnosticsService();
  }

  private constructor() {}

  diagnose(input: LangWatchQLDiagnosticsInput): readonly LangWatchQLDiagnostic[] {
    return fanoutDiagnostics(input);
  }
}
