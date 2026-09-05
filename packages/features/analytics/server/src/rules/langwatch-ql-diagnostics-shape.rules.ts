/**
 * Advisory result diagnostics — what a note can say, and what the rules read.
 *
 * The rules themselves are the `langwatch-ql-*-diagnostics` services.
 */
import type { LangWatchQLColumn } from "../services/langwatch-ql-executor.service";
import type { LangWatchQLResultLimits } from "../ports/langwatch-ql-executor.port";
import type { LangWatchQLViewDefinition } from "../services/langwatch-ql-catalog-shapes.service";
import type {
  AcceptedLangWatchQL,
  LangWatchQLQueryBlock,
} from "./langwatch-ql-validation-shape.rules";

/**
 * Every note this API can attach to a result. A code is here because a caller would *do
 * something different* on seeing it, which is the same bar the violation codes are held to.
 */
export const LWQL_DIAGNOSTIC_CODES = [
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

export type {
  LangWatchQLDiagnostic,
  LangWatchQLDiagnosticCode,
} from "@langwatch/analytics-contract";

/**
 * What an empty diagnostics list means, in the words the API publishes.
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
  /** Whether a response ceiling cut the result short. */
  readonly truncated: boolean;
  readonly limits: LangWatchQLResultLimits;
  /** Rows actually handed back, after the ceilings. */
  readonly rowsReturned: number;
  /**
   * The instant "has this bucket finished yet" is asked against. Injected rather than read from
   * the clock so that the answer is a function of its inputs — the same result at the same
   * instant always produces the same diagnostics.
   */
  readonly now: Date;
}

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

/** One of a block's table references, resolved to the dataset it names. */
export interface ResolvedTableReference {
  /** How a join condition would qualify it: its alias, or its bare name. */
  readonly qualifier: string;
  /** The name a caller writes, qualified with the LangWatchQL database. */
  readonly datasetName: string;
  readonly view: LangWatchQLViewDefinition;
}

/**
 * The block's table references, resolved against the catalog. A reference the catalog does not
 * know is dropped: it can only be a dataset this service was not given, and a rule that guessed
 * at its grain would be inventing the fact it reports.
 */
export function resolveTableReferences({
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
        `${database}.${candidate.name}`.toLowerCase() === reference.table.toLowerCase(),
    );
    if (!view) {
      continue;
    }

    resolved.push({
      qualifier: reference.alias ?? view.name.toLowerCase(),
      datasetName: `${database}.${view.name}`,
      view,
    });
  }

  return resolved;
}
